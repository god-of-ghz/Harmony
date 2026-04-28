import React, { useState, useEffect } from 'react';
import type { MenuItem } from '../../store/contextMenuStore';
import { useContextMenuStore } from '../../store/contextMenuStore';
import { Permission, useAppStore } from '../../store/appStore';
import type { RoleData } from '../../store/appStore';
import { apiFetch } from '../../utils/apiFetch';
import { copyToClipboard, leaveGuild, deleteGuild, openGuildSettings, insertMention, deleteChannel, markChannelAsRead, copyMessageLink } from './contextActions';
import type { ResolvedUserContext } from '../../types/UserTarget';
import { QuickReactBar } from './QuickReactBar';

/**
 * Post-process a menu item list to remove consecutive, leading, and trailing separators.
 * This ensures that when conditional sections are empty, we don't get ugly
 * double-separator lines in the context menu.
 */
const cleanSeparators = (items: MenuItem[]): MenuItem[] => {
    const result: MenuItem[] = [];
    for (const item of items) {
        if (item.separator) {
            // Skip if this would be a leading separator or a consecutive separator
            if (result.length === 0 || result[result.length - 1].separator) {
                continue;
            }
        }
        result.push(item);
    }
    // Remove trailing separator
    while (result.length > 0 && result[result.length - 1].separator) {
        result.pop();
    }
    return result;
};

interface GuildMenuContext {
    guildId: string;
    guildName: string;
    currentPermissions: number;
    isOwner: boolean;
    token: string;
    /** Optional callback to refresh the guild list after leave/delete */
    onRefresh?: () => void;
}

/**
 * Build the context menu items for a guild icon right-click.
 */
export const buildGuildMenu = (ctx: GuildMenuContext): MenuItem[] => {
    const items: MenuItem[] = [];

    // Guild Settings (if has MANAGE_SERVER permission)
    if ((ctx.currentPermissions & Permission.MANAGE_SERVER) !== 0) {
        items.push({
            id: 'guild-settings',
            label: 'Guild Settings',
            onClick: () => openGuildSettings(ctx.guildId),
        });
    }

    // Separator (only if we added settings above)
    if (items.length > 0) {
        items.push({ id: 'sep-1', separator: true });
    }

    // Leave Guild (if not owner)
    if (!ctx.isOwner) {
        items.push({
            id: 'leave-guild',
            label: 'Leave Guild',
            onClick: async () => {
                await leaveGuild(ctx.guildId, ctx.token);
                ctx.onRefresh?.();
            },
        });
    }

    // Delete Guild (if owner, danger style)
    if (ctx.isOwner) {
        items.push({
            id: 'delete-guild',
            label: 'Delete Guild',
            danger: true,
            onClick: async () => {
                await deleteGuild(ctx.guildId, ctx.token);
                ctx.onRefresh?.();
            },
        });
    }

    // Separator before Copy ID
    items.push({ id: 'sep-2', separator: true });

    // Copy Guild ID (always)
    items.push({
        id: 'copy-guild-id',
        label: 'Copy Guild ID',
        rightIcon: '🆔',
        onClick: () => copyToClipboard(ctx.guildId),
    });

    return cleanSeparators(items);
};

export const RoleSubMenuContent: React.FC<{ guildId: string, profileId: string, guildRoles: RoleData[] }> = ({ guildId, profileId, guildRoles }) => {
    const [assignedRoleIds, setAssignedRoleIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchRoles = async () => {
            const token = useAppStore.getState().currentAccount?.token;
            const guildMap = useAppStore.getState().guildMap;
            const nodeUrl = guildMap[guildId];
            if (!nodeUrl || !token) {
                setLoading(false);
                return;
            }

            try {
                const res = await apiFetch(`${nodeUrl}/api/guilds/${guildId}/profiles/${profileId}/roles`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    // Server returns full role objects (SELECT r.* FROM roles r JOIN profile_roles ...)
                    // so the field is `id`, not `role_id`
                    setAssignedRoleIds(data.map((r: { id: string; role_id?: string }) => r.id || r.role_id).filter(Boolean));
                } else {
                    console.error('Failed to fetch profile roles: HTTP', res.status);
                }
            } catch (err) {
                console.error('Failed to fetch profile roles:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchRoles();
    }, [guildId, profileId]);

    const toggleRole = async (roleId: string, isAssigned: boolean) => {
        const token = useAppStore.getState().currentAccount?.token;
        const guildMap = useAppStore.getState().guildMap;
        const nodeUrl = guildMap[guildId];
        if (!nodeUrl || !token) return;

        // Optimistic update
        setAssignedRoleIds(prev => isAssigned ? prev.filter(id => id !== roleId) : [...prev, roleId]);

        const method = isAssigned ? 'DELETE' : 'POST';
        const url = `${nodeUrl}/api/guilds/${guildId}/profiles/${profileId}/roles${isAssigned ? '/' + roleId : ''}`;
        
        try {
            const res = await apiFetch(url, {
                method,
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${token}` 
                },
                body: isAssigned ? undefined : JSON.stringify({ roleId })
            });
            if (!res.ok) {
                // Revert if failed
                setAssignedRoleIds(prev => !isAssigned ? prev.filter(id => id !== roleId) : [...prev, roleId]);
            }
        } catch (err) {
            console.error('Failed to toggle role:', err);
        }
    };

    if (loading) {
        return <div className="context-menu-item disabled">Loading roles...</div>;
    }

    const rolesToRender = guildRoles.filter(r => r.name !== '@everyone').sort((a,b) => b.position - a.position);

    if (rolesToRender.length === 0) {
         return <div className="context-menu-item disabled">No roles available</div>;
    }

    return (
        <>
            {rolesToRender.map(role => {
                const isAssigned = assignedRoleIds.includes(role.id);
                return (
                    <div 
                        key={role.id} 
                        className="context-menu-item"
                        onClick={(e) => {
                            e.stopPropagation(); // Keep menu open
                            toggleRole(role.id, isAssigned);
                        }}
                    >
                        <span className="context-menu-color" style={{ backgroundColor: role.color || '#FFFFFF' }} />
                        <div className="context-menu-label">
                            <span>{role.name}</span>
                        </div>
                        <span className={`context-menu-checkbox ${isAssigned ? 'checked' : ''}`}>
                            {isAssigned && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            )}
                        </span>
                    </div>
                );
            })}
        </>
    );
};

// ── User Menu ──

/**
 * Build the context menu for a user interaction (avatar, username, @mention, member sidebar).
 */
export const buildUserMenu = (ctx: ResolvedUserContext): MenuItem[] => {
    const items: MenuItem[] = [];
    const { targetNickname, isSelf, isFriend, isHigherRank, canKick, canBan, canManageRoles } = ctx;

    // Profile (always)
    items.push({
        id: 'user-profile',
        label: 'Profile',
        onClick: () => {
            // Open the profile popup with the target's identity.
            // Use context menu position as anchor since we're inside a context menu.
            const cmState = useContextMenuStore.getState();
            const pos = cmState.position;
            cmState.openProfilePopup(
                {
                    accountId: ctx.target.accountId || ctx.targetProfile?.account_id || '',
                    profileId: ctx.target.profileId,
                    guildId: ctx.target.guildId,
                },
                { top: pos.y, left: pos.x, width: 0, height: 0 }
            );
        },
    });

    // Mention (always)
    items.push({
        id: 'user-mention',
        label: 'Mention',
        onClick: () => insertMention(targetNickname),
    });

    // Message (not self)
    if (!isSelf) {
        items.push({
            id: 'user-message',
            label: 'Message',
            onClick: () => {
                useContextMenuStore.getState().showToast('Direct messages coming soon');
            },
        });
    }

    // Separator
    items.push({ id: 'user-sep-1', separator: true });

    // Friend actions (not self)
    if (!isSelf) {
        if (!isFriend) {
            items.push({
                id: 'user-add-friend',
                label: 'Add Friend',
                onClick: () => {
                    useContextMenuStore.getState().showToast('Friend request coming soon');
                },
            });
        } else {
            items.push({
                id: 'user-remove-friend',
                label: 'Remove Friend',
                onClick: () => {
                    useContextMenuStore.getState().showToast('Remove friend coming soon');
                },
            });
        }
    }

    // Separator
    items.push({ id: 'user-sep-2', separator: true });

    // Roles submenu (canManageRoles — self-management is allowed, matching Discord behavior)
    if (canManageRoles) {
        const guildRoles = useAppStore.getState().guildRoles;
        if (guildRoles.filter(r => r.name !== '@everyone').length > 0) {
            items.push({
                id: 'user-roles',
                label: 'Roles',
                children: [
                    {
                        id: 'roles-container',
                        customComponent: <RoleSubMenuContent guildId={ctx.target.guildId} profileId={ctx.target.profileId} guildRoles={guildRoles} />
                    }
                ],
            });
        }
    }

    // Separator before moderation
    items.push({ id: 'user-sep-3', separator: true });

    // Kick (canKick && !isHigherRank && !isSelf) — hidden entirely if outranked
    if (canKick && !isHigherRank && !isSelf) {
        items.push({
            id: 'user-kick',
            label: `Kick ${targetNickname}`,
            danger: true,
            onClick: () => {
                useContextMenuStore.getState().showToast(`Kick ${targetNickname} coming soon`);
            },
        });
    }

    // Ban (canBan && !isHigherRank && !isSelf)
    if (canBan && !isHigherRank && !isSelf) {
        items.push({
            id: 'user-ban',
            label: `Ban ${targetNickname}`,
            danger: true,
            onClick: () => {
                useContextMenuStore.getState().showToast(`Ban ${targetNickname} coming soon`);
            },
        });
    }

    // Separator before Copy ID
    items.push({ id: 'user-sep-4', separator: true });

    // Copy User ID (always)
    items.push({
        id: 'copy-user-id',
        label: 'Copy User ID',
        rightIcon: '🆔',
        onClick: () => copyToClipboard(ctx.target.profileId),
    });

    return cleanSeparators(items);
};

// ── Channel Menu ──

export interface ChannelMenuContext {
    channelId: string;
    channelName: string;
    guildId: string;
    currentPermissions: number;
    isUnread: boolean;
}

/**
 * Build the context menu for a channel (sidebar entry or header).
 */
export const buildChannelMenu = (ctx: ChannelMenuContext): MenuItem[] => {
    const items: MenuItem[] = [];
    const hasManageChannels =
        (ctx.currentPermissions & Permission.ADMINISTRATOR) !== 0 ||
        (ctx.currentPermissions & Permission.MANAGE_CHANNELS) !== 0;

    // Mark As Read (if unread)
    if (ctx.isUnread) {
        items.push({
            id: 'channel-mark-read',
            label: 'Mark As Read',
            onClick: () => markChannelAsRead(ctx.channelId),
        });
        items.push({ id: 'channel-sep-1', separator: true });
    }

    // Channel management (MANAGE_CHANNELS)
    if (hasManageChannels) {
        items.push({
            id: 'channel-edit',
            label: 'Edit Channel',
            onClick: () => {
                useContextMenuStore.getState().showToast('Edit channel coming soon');
            },
        });
        items.push({
            id: 'channel-create',
            label: 'Create Text Channel',
            onClick: () => {
                useContextMenuStore.getState().showToast('Create channel coming soon');
            },
        });
        items.push({
            id: 'channel-delete',
            label: 'Delete Channel',
            danger: true,
            onClick: () => {
                const token = useAppStore.getState().currentAccount?.token || '';
                deleteChannel(ctx.channelId, ctx.guildId, token);
            },
        });
        items.push({ id: 'channel-sep-2', separator: true });
    }

    // Copy Channel ID (always)
    items.push({
        id: 'copy-channel-id',
        label: 'Copy Channel ID',
        rightIcon: '🆔',
        onClick: () => copyToClipboard(ctx.channelId),
    });

    return cleanSeparators(items);
};

// ── Category Menu ──

export interface CategoryMenuContext {
    categoryId: string;
    categoryName: string;
    guildId: string;
    currentPermissions: number;
    isCollapsed: boolean;
    hasUnreadChannels: boolean;
    onToggleCollapse: () => void;
    onCollapseAll: () => void;
}

/**
 * Build the context menu for a category header.
 */
export const buildCategoryMenu = (ctx: CategoryMenuContext): MenuItem[] => {
    const items: MenuItem[] = [];
    const hasManageChannels =
        (ctx.currentPermissions & Permission.ADMINISTRATOR) !== 0 ||
        (ctx.currentPermissions & Permission.MANAGE_CHANNELS) !== 0;

    // Mark Category As Read (if has unread channels)
    if (ctx.hasUnreadChannels) {
        items.push({
            id: 'category-mark-read',
            label: 'Mark Category As Read',
            onClick: () => {
                useContextMenuStore.getState().showToast('Marked category as read');
            },
        });
        items.push({ id: 'category-sep-1', separator: true });
    }

    // Collapse toggle
    items.push({
        id: 'category-collapse',
        label: ctx.isCollapsed ? 'Expand Category' : 'Collapse Category',
        onClick: ctx.onToggleCollapse,
    });
    items.push({
        id: 'category-collapse-all',
        label: 'Collapse All Categories',
        onClick: ctx.onCollapseAll,
    });

    items.push({ id: 'category-sep-2', separator: true });

    // Category management (MANAGE_CHANNELS)
    if (hasManageChannels) {
        items.push({
            id: 'category-edit',
            label: 'Edit Category',
            onClick: () => {
                useContextMenuStore.getState().showToast('Edit category coming soon');
            },
        });
        items.push({
            id: 'category-delete',
            label: 'Delete Category',
            danger: true,
            onClick: () => {
                useContextMenuStore.getState().showToast('Delete category coming soon');
            },
        });
        items.push({ id: 'category-sep-3', separator: true });
    }

    // Copy Category ID (always)
    items.push({
        id: 'copy-category-id',
        label: 'Copy Category ID',
        rightIcon: '🆔',
        onClick: () => copyToClipboard(ctx.categoryId),
    });

    return cleanSeparators(items);
};

// ── Message Menu ──

export interface MessageMenuContext {
    messageId: string;
    messageContent: string;
    authorProfileId: string;
    isOwnMessage: boolean;
    currentPermissions: number;
    channelId: string;
    guildId: string;
    onEdit: () => void;
    onReply: () => void;
    onDelete: () => void;
    onCopyLink: () => void;
    onAddReaction: (emoji: string) => void;
}

/**
 * Build the context menu for a message body right-click.
 */
export const buildMessageMenu = (ctx: MessageMenuContext): MenuItem[] => {
    const items: MenuItem[] = [];
    const hasManageMessages =
        (ctx.currentPermissions & Permission.ADMINISTRATOR) !== 0 ||
        (ctx.currentPermissions & Permission.MANAGE_MESSAGES) !== 0;

    // Quick React Bar (custom component)
    items.push({
        id: 'quick-react',
        customComponent: React.createElement(QuickReactBar, {
            onAddReaction: ctx.onAddReaction,
        }),
    });

    // Add Reaction (submenu placeholder)
    items.push({
        id: 'msg-add-reaction',
        label: 'Add Reaction',
        children: [{ id: 'reaction-picker', label: 'Emoji picker coming soon' }],
    });

    items.push({ id: 'msg-sep-1', separator: true });

    // Edit Message (own message only)
    if (ctx.isOwnMessage) {
        items.push({
            id: 'msg-edit',
            label: 'Edit Message',
            onClick: ctx.onEdit,
        });
    }

    // Reply (always)
    items.push({
        id: 'msg-reply',
        label: 'Reply',
        onClick: ctx.onReply,
    });

    // Copy Text (always)
    items.push({
        id: 'msg-copy-text',
        label: 'Copy Text',
        onClick: () => copyToClipboard(ctx.messageContent),
    });

    // Pin Message (MANAGE_MESSAGES permission)
    if (hasManageMessages) {
        items.push({
            id: 'msg-pin',
            label: 'Pin Message',
            onClick: () => {
                useContextMenuStore.getState().showToast('Pin message coming soon');
            },
        });
    }

    items.push({ id: 'msg-sep-2', separator: true });

    // Mark Unread (always)
    items.push({
        id: 'msg-mark-unread',
        label: 'Mark Unread',
        onClick: () => {
            useContextMenuStore.getState().showToast('Marked as unread');
        },
    });

    // Copy Message Link (always)
    items.push({
        id: 'msg-copy-link',
        label: 'Copy Message Link',
        onClick: () => copyMessageLink(ctx.guildId, ctx.channelId, ctx.messageId),
    });

    items.push({ id: 'msg-sep-3', separator: true });

    // Delete Message (own OR has MANAGE_MESSAGES)
    if (ctx.isOwnMessage || hasManageMessages) {
        items.push({
            id: 'msg-delete',
            label: 'Delete Message',
            danger: true,
            onClick: ctx.onDelete,
        });
    }

    // Report Message (not own)
    if (!ctx.isOwnMessage) {
        items.push({
            id: 'msg-report',
            label: 'Report Message',
            onClick: () => {
                useContextMenuStore.getState().showToast('Report message coming soon');
            },
        });
    }

    items.push({ id: 'msg-sep-4', separator: true });

    // Copy Message ID (always)
    items.push({
        id: 'copy-message-id',
        label: 'Copy Message ID',
        rightIcon: '🆔',
        onClick: () => copyToClipboard(ctx.messageId),
    });

    return cleanSeparators(items);
};
