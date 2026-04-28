/**
 * Context Menu Identity Resolution Tests
 *
 * Validates:
 * 1. resolveUserContext: correctly identifies self, friend, higher-rank, lower-rank
 * 2. resolveUserContext: correctly computes canKick/canBan/canManageRoles from permissions
 * 3. buildUserMenu: admin sees Kick/Ban for lower-rank user
 * 4. buildUserMenu: admin does NOT see Kick/Ban for higher-rank user
 * 5. buildUserMenu: self-click shows Profile but not Kick/Ban
 * 6. buildChannelMenu: admin sees Edit/Delete, non-admin doesn't
 * 7. buildCategoryMenu: returns correct items
 * 8. useUserInteraction: returns handlers that call openContextMenu
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useContextMenuStore } from '../store/contextMenuStore';
import { useAppStore, Permission } from '../store/appStore';
import type { Profile, RoleData } from '../store/appStore';
import { resolveUserContext } from '../types/UserTarget';
import type { UserTarget } from '../types/UserTarget';
import { buildUserMenu, buildChannelMenu, buildCategoryMenu } from '../components/context-menu/menuBuilders';
import type { ChannelMenuContext, CategoryMenuContext } from '../components/context-menu/menuBuilders';

// ── Test Data ──

const mockProfiles: Profile[] = [
    {
        id: 'profile-owner',
        server_id: 'guild-1',
        account_id: 'account-owner',
        original_username: 'OwnerUser',
        nickname: 'Owner',
        avatar: '',
        role: 'OWNER',
        aliases: '',
    },
    {
        id: 'profile-admin',
        server_id: 'guild-1',
        account_id: 'account-admin',
        original_username: 'AdminUser',
        nickname: 'Admin',
        avatar: '',
        role: 'ADMIN',
        aliases: '',
    },
    {
        id: 'profile-user',
        server_id: 'guild-1',
        account_id: 'account-user',
        original_username: 'RegularUser',
        nickname: 'Regular',
        avatar: '',
        role: 'USER',
        aliases: '',
    },
];

const mockRoles: RoleData[] = [
    { id: 'role-1', server_id: 'guild-1', name: 'Moderator', color: '#ff0000', permissions: 0, position: 1 },
    { id: 'role-2', server_id: 'guild-1', name: 'Member', color: '#00ff00', permissions: 0, position: 0 },
    { id: 'role-everyone', server_id: 'guild-1', name: '@everyone', color: '', permissions: 0, position: -1 },
];

describe('Context Menu Identity Resolution', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset stores
        useContextMenuStore.setState({
            isOpen: false,
            position: { x: 0, y: 0 },
            items: [],
            toasts: [],
            profilePopup: null,
        });

        useAppStore.setState({
            currentAccount: { id: 'account-admin', email: 'admin@test.com', is_creator: false, token: 'test-token' },
            claimedProfiles: [mockProfiles[1]], // current user is admin
            guildProfiles: mockProfiles,
            serverProfiles: mockProfiles,
            guildRoles: mockRoles,
            serverRoles: mockRoles,
            currentUserPermissions: Permission.ADMINISTRATOR,
            relationships: [
                { account_id: 'account-admin', target_id: 'account-user', status: 'friend', timestamp: 1 },
            ],
            activeGuildId: 'guild-1',
            activeServerId: 'guild-1',
            guildMap: { 'guild-1': 'http://localhost:3001' },
            serverMap: { 'guild-1': 'http://localhost:3001' },
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ──────────────────────────────────────────────────
    // 1. resolveUserContext — identity detection
    // ──────────────────────────────────────────────────

    describe('resolveUserContext', () => {
        it('correctly identifies self', () => {
            const target: UserTarget = { profileId: 'profile-admin', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);

            expect(ctx.isSelf).toBe(true);
            expect(ctx.targetNickname).toBe('Admin');
            expect(ctx.targetRole).toBe('ADMIN');
        });

        it('correctly identifies non-self user', () => {
            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);

            expect(ctx.isSelf).toBe(false);
            expect(ctx.targetNickname).toBe('Regular');
            expect(ctx.targetRole).toBe('USER');
        });

        it('correctly detects friend status', () => {
            const target: UserTarget = { profileId: 'profile-user', accountId: 'account-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);

            expect(ctx.isFriend).toBe(true);
        });

        it('correctly detects non-friend status', () => {
            const target: UserTarget = { profileId: 'profile-owner', accountId: 'account-owner', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);

            expect(ctx.isFriend).toBe(false);
        });

        it('correctly computes isHigherRank when target is OWNER (outranks ADMIN)', () => {
            const target: UserTarget = { profileId: 'profile-owner', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);

            expect(ctx.isHigherRank).toBe(true);
        });

        it('correctly computes isHigherRank when target is USER (lower than ADMIN)', () => {
            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);

            expect(ctx.isHigherRank).toBe(false);
        });

        it('correctly computes isHigherRank for same rank', () => {
            // Admin targeting themselves is same rank — treated as >= so true
            const target: UserTarget = { profileId: 'profile-admin', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);

            expect(ctx.isHigherRank).toBe(true); // same rank counts as >=
        });
    });

    // ──────────────────────────────────────────────────
    // 2. resolveUserContext — permission derivation
    // ──────────────────────────────────────────────────

    describe('resolveUserContext permissions', () => {
        it('computes canKick/canBan/canManageRoles from ADMINISTRATOR', () => {
            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);

            expect(ctx.canKick).toBe(true);
            expect(ctx.canBan).toBe(true);
            expect(ctx.canManageRoles).toBe(true);
        });

        it('computes canKick from KICK_MEMBERS permission only', () => {
            useAppStore.setState({ currentUserPermissions: Permission.KICK_MEMBERS });
            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);

            expect(ctx.canKick).toBe(true);
            expect(ctx.canBan).toBe(false);
            expect(ctx.canManageRoles).toBe(false);
        });

        it('computes all false with no permissions', () => {
            useAppStore.setState({ currentUserPermissions: 0 });
            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);

            expect(ctx.canKick).toBe(false);
            expect(ctx.canBan).toBe(false);
            expect(ctx.canManageRoles).toBe(false);
        });
    });

    // ──────────────────────────────────────────────────
    // 3. buildUserMenu — admin sees Kick/Ban for lower-rank
    // ──────────────────────────────────────────────────

    describe('buildUserMenu', () => {
        it('admin sees Kick/Ban for lower-rank user', () => {
            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            expect(items.find(i => i.label === 'Kick Regular')).toBeTruthy();
            expect(items.find(i => i.label === 'Ban Regular')).toBeTruthy();
            expect(items.find(i => i.id === 'user-kick')?.danger).toBe(true);
            expect(items.find(i => i.id === 'user-ban')?.danger).toBe(true);
        });

        it('admin does NOT see Kick/Ban for higher-rank user (OWNER)', () => {
            const target: UserTarget = { profileId: 'profile-owner', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            expect(items.find(i => i.id === 'user-kick')).toBeFalsy();
            expect(items.find(i => i.id === 'user-ban')).toBeFalsy();
        });

        it('self-click shows Profile but not Kick/Ban', () => {
            const target: UserTarget = { profileId: 'profile-admin', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            expect(items.find(i => i.label === 'Profile')).toBeTruthy();
            expect(items.find(i => i.id === 'user-kick')).toBeFalsy();
            expect(items.find(i => i.id === 'user-ban')).toBeFalsy();
        });

        it('self-click does not show Message', () => {
            const target: UserTarget = { profileId: 'profile-admin', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            expect(items.find(i => i.label === 'Message')).toBeFalsy();
        });

        it('non-friend shows Add Friend, not Remove Friend', () => {
            const target: UserTarget = { profileId: 'profile-owner', accountId: 'account-owner', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            expect(items.find(i => i.label === 'Add Friend')).toBeTruthy();
            expect(items.find(i => i.label === 'Remove Friend')).toBeFalsy();
        });

        it('friend shows Remove Friend, not Add Friend', () => {
            const target: UserTarget = { profileId: 'profile-user', accountId: 'account-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            expect(items.find(i => i.label === 'Remove Friend')).toBeTruthy();
            expect(items.find(i => i.label === 'Add Friend')).toBeFalsy();
        });

        it('always includes Copy User ID with 🆔 icon', () => {
            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            const copyItem = items.find(i => i.label === 'Copy User ID');
            expect(copyItem).toBeTruthy();
            expect(copyItem?.rightIcon).toBe('🆔');
        });

        it('shows Roles submenu when canManageRoles and not self', () => {
            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            const rolesItem = items.find(i => i.label === 'Roles');
            expect(rolesItem).toBeTruthy();
            // Should have children (the custom component container)
            expect(rolesItem?.children?.length).toBe(1); // roles-container
        });

        it('shows Roles submenu for self when canManageRoles', () => {
            const target: UserTarget = { profileId: 'profile-admin', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            const rolesItem = items.find(i => i.label === 'Roles');
            expect(rolesItem).toBeTruthy();
            expect(rolesItem?.children?.length).toBe(1);
        });
    });

    // ──────────────────────────────────────────────────
    // 4. buildChannelMenu
    // ──────────────────────────────────────────────────

    describe('buildChannelMenu', () => {
        it('admin sees Edit/Create/Delete channel', () => {
            const ctx: ChannelMenuContext = {
                channelId: 'ch-1',
                channelName: 'general',
                guildId: 'guild-1',
                currentPermissions: Permission.ADMINISTRATOR,
                isUnread: false,
            };
            const items = buildChannelMenu(ctx);

            expect(items.find(i => i.label === 'Edit Channel')).toBeTruthy();
            expect(items.find(i => i.label === 'Create Text Channel')).toBeTruthy();
            expect(items.find(i => i.label === 'Delete Channel')).toBeTruthy();
            expect(items.find(i => i.id === 'channel-delete')?.danger).toBe(true);
        });

        it('non-admin does not see Edit/Create/Delete', () => {
            const ctx: ChannelMenuContext = {
                channelId: 'ch-1',
                channelName: 'general',
                guildId: 'guild-1',
                currentPermissions: 0,
                isUnread: false,
            };
            const items = buildChannelMenu(ctx);

            expect(items.find(i => i.label === 'Edit Channel')).toBeFalsy();
            expect(items.find(i => i.label === 'Create Text Channel')).toBeFalsy();
            expect(items.find(i => i.label === 'Delete Channel')).toBeFalsy();
        });

        it('always includes Copy Channel ID', () => {
            const ctx: ChannelMenuContext = {
                channelId: 'ch-1',
                channelName: 'general',
                guildId: 'guild-1',
                currentPermissions: 0,
                isUnread: false,
            };
            const items = buildChannelMenu(ctx);

            expect(items.find(i => i.label === 'Copy Channel ID')).toBeTruthy();
        });

        it('shows Mark As Read when channel is unread', () => {
            const ctx: ChannelMenuContext = {
                channelId: 'ch-1',
                channelName: 'general',
                guildId: 'guild-1',
                currentPermissions: 0,
                isUnread: true,
            };
            const items = buildChannelMenu(ctx);

            expect(items.find(i => i.label === 'Mark As Read')).toBeTruthy();
        });

        it('hides Mark As Read when channel is read', () => {
            const ctx: ChannelMenuContext = {
                channelId: 'ch-1',
                channelName: 'general',
                guildId: 'guild-1',
                currentPermissions: 0,
                isUnread: false,
            };
            const items = buildChannelMenu(ctx);

            expect(items.find(i => i.label === 'Mark As Read')).toBeFalsy();
        });

        it('user with MANAGE_CHANNELS permission sees management items', () => {
            const ctx: ChannelMenuContext = {
                channelId: 'ch-1',
                channelName: 'general',
                guildId: 'guild-1',
                currentPermissions: Permission.MANAGE_CHANNELS,
                isUnread: false,
            };
            const items = buildChannelMenu(ctx);

            expect(items.find(i => i.label === 'Edit Channel')).toBeTruthy();
        });
    });

    // ──────────────────────────────────────────────────
    // 5. buildCategoryMenu
    // ──────────────────────────────────────────────────

    describe('buildCategoryMenu', () => {
        it('returns correct items for admin with collapsed state', () => {
            const onToggle = vi.fn();
            const onCollapseAll = vi.fn();
            const ctx: CategoryMenuContext = {
                categoryId: 'cat-1',
                categoryName: 'General',
                guildId: 'guild-1',
                currentPermissions: Permission.ADMINISTRATOR,
                isCollapsed: true,
                hasUnreadChannels: false,
                onToggleCollapse: onToggle,
                onCollapseAll: onCollapseAll,
            };
            const items = buildCategoryMenu(ctx);

            // Expand (because it's collapsed)
            expect(items.find(i => i.label === 'Expand Category')).toBeTruthy();
            expect(items.find(i => i.label === 'Collapse All Categories')).toBeTruthy();
            // Admin management
            expect(items.find(i => i.label === 'Edit Category')).toBeTruthy();
            expect(items.find(i => i.label === 'Delete Category')).toBeTruthy();
            expect(items.find(i => i.id === 'category-delete')?.danger).toBe(true);
            // Copy ID
            expect(items.find(i => i.label === 'Copy Category ID')).toBeTruthy();
        });

        it('shows Collapse Category when not collapsed', () => {
            const ctx: CategoryMenuContext = {
                categoryId: 'cat-1',
                categoryName: 'General',
                guildId: 'guild-1',
                currentPermissions: 0,
                isCollapsed: false,
                hasUnreadChannels: false,
                onToggleCollapse: vi.fn(),
                onCollapseAll: vi.fn(),
            };
            const items = buildCategoryMenu(ctx);

            expect(items.find(i => i.label === 'Collapse Category')).toBeTruthy();
            expect(items.find(i => i.label === 'Expand Category')).toBeFalsy();
        });

        it('shows Mark Category As Read when has unread channels', () => {
            const ctx: CategoryMenuContext = {
                categoryId: 'cat-1',
                categoryName: 'General',
                guildId: 'guild-1',
                currentPermissions: 0,
                isCollapsed: false,
                hasUnreadChannels: true,
                onToggleCollapse: vi.fn(),
                onCollapseAll: vi.fn(),
            };
            const items = buildCategoryMenu(ctx);

            expect(items.find(i => i.label === 'Mark Category As Read')).toBeTruthy();
        });

        it('non-admin does not see Edit/Delete category', () => {
            const ctx: CategoryMenuContext = {
                categoryId: 'cat-1',
                categoryName: 'General',
                guildId: 'guild-1',
                currentPermissions: 0,
                isCollapsed: false,
                hasUnreadChannels: false,
                onToggleCollapse: vi.fn(),
                onCollapseAll: vi.fn(),
            };
            const items = buildCategoryMenu(ctx);

            expect(items.find(i => i.label === 'Edit Category')).toBeFalsy();
            expect(items.find(i => i.label === 'Delete Category')).toBeFalsy();
        });

        it('calls onToggleCollapse when Collapse/Expand item is clicked', () => {
            const onToggle = vi.fn();
            const ctx: CategoryMenuContext = {
                categoryId: 'cat-1',
                categoryName: 'General',
                guildId: 'guild-1',
                currentPermissions: 0,
                isCollapsed: false,
                hasUnreadChannels: false,
                onToggleCollapse: onToggle,
                onCollapseAll: vi.fn(),
            };
            const items = buildCategoryMenu(ctx);
            const collapseItem = items.find(i => i.label === 'Collapse Category');
            collapseItem?.onClick?.();
            expect(onToggle).toHaveBeenCalled();
        });
    });

    // ──────────────────────────────────────────────────
    // 6. useUserInteraction hook
    // ──────────────────────────────────────────────────

    describe('useUserInteraction', () => {
        it('returns handlers that call openContextMenu on right-click', async () => {
            // We need to render a component that uses the hook
            const React = await import('react');
            const { useUserInteraction } = await import('../hooks/useUserInteraction');

            const TestComponent = () => {
                const { onContextMenu, onClick } = useUserInteraction({
                    profileId: 'profile-user',
                    guildId: 'guild-1',
                });
                return (
                    <div data-testid="target" onContextMenu={onContextMenu} onClick={onClick}>
                        Test User
                    </div>
                );
            };

            render(<TestComponent />);

            const target = screen.getByTestId('target');

            await act(async () => {
                fireEvent.contextMenu(target);
            });

            const state = useContextMenuStore.getState();
            expect(state.isOpen).toBe(true);
            expect(state.items.length).toBeGreaterThan(0);
            // Should have Profile as first non-separator item
            expect(state.items[0].label).toBe('Profile');
        });

        it('opens profile popup on click', async () => {
            const React = await import('react');
            const { useUserInteraction } = await import('../hooks/useUserInteraction');

            const TestComponent = () => {
                const { onContextMenu, onClick } = useUserInteraction({
                    profileId: 'profile-user',
                    accountId: 'account-user',
                    guildId: 'guild-1',
                });
                return (
                    <div data-testid="target" onContextMenu={onContextMenu} onClick={onClick}>
                        Test User
                    </div>
                );
            };

            render(<TestComponent />);

            const target = screen.getByTestId('target');
            await act(async () => {
                fireEvent.click(target);
            });

            const state = useContextMenuStore.getState();
            expect(state.profilePopup).toBeTruthy();
            expect(state.profilePopup?.target.profileId).toBe('profile-user');
        });
    });

    // ──────────────────────────────────────────────────
    // 7. contextActions — insertMention
    // ──────────────────────────────────────────────────

    describe('contextActions.insertMention', () => {
        it('dispatches harmony-insert-mention custom event', async () => {
            const { insertMention } = await import('../components/context-menu/contextActions');

            const handler = vi.fn();
            window.addEventListener('harmony-insert-mention', handler);

            insertMention('TestUser');

            expect(handler).toHaveBeenCalledTimes(1);
            const event = handler.mock.calls[0][0] as CustomEvent;
            expect(event.detail.nickname).toBe('TestUser');

            window.removeEventListener('harmony-insert-mention', handler);
        });
    });

    // ──────────────────────────────────────────────────
    // 8. contextActions — markChannelAsRead
    // ──────────────────────────────────────────────────

    describe('contextActions.markChannelAsRead', () => {
        it('updates readStates and removes from unreadChannels', async () => {
            const { markChannelAsRead } = await import('../components/context-menu/contextActions');

            // Set up unread state
            useAppStore.setState({
                unreadChannels: new Set(['ch-1', 'ch-2']),
                readStates: {},
            });

            markChannelAsRead('ch-1');

            const state = useAppStore.getState();
            expect(state.unreadChannels.has('ch-1')).toBe(false);
            expect(state.unreadChannels.has('ch-2')).toBe(true);
            expect(state.readStates['ch-1']).toBeTruthy();
        });
    });
});
