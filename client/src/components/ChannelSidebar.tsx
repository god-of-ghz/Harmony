import { useEffect, useState, useCallback } from 'react';
import type { ChannelData, CategoryData } from '../store/appStore';
import { useAppStore, Permission } from '../store/appStore';
import { Hash, Settings, ChevronDown, ChevronRight, Volume2 } from 'lucide-react';
import { GuildSettings } from './GuildSettings';
import { UserPanel } from './UserPanel';
import { useContextMenuStore } from '../store/contextMenuStore';
import { buildChannelMenu, buildCategoryMenu } from './context-menu/menuBuilders';

export const ChannelSidebar = () => {
    const { 
        activeServerId, 
        activeChannelId, 
        setActiveChannelId, 
        serverMap, 
        activeVoiceChannelId, 
        setActiveVoiceChannelId, 
        unreadChannels,
        setCurrentUserPermissions,
        currentAccount,
        claimedProfiles
    } = useAppStore();
    const showGuildSettings = useAppStore(state => state.showGuildSettings);
    const setShowGuildSettings = useAppStore(state => state.setShowGuildSettings);
    const guilds = useAppStore(state => state.guildMap);
    const [channels, setChannels] = useState<ChannelData[]>([]);
    const [categories, setCategories] = useState<CategoryData[]>([]);
    const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
    const [showSettings, setShowSettings] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const currentUserPermissions = useAppStore(state => state.currentUserPermissions);
    const openContextMenu = useContextMenuStore(state => state.openContextMenu);

    useEffect(() => {
        if (!activeServerId || !serverMap[activeServerId] || !currentAccount) {
            setCurrentUserPermissions(0);
            return;
        }

        const baseUrl = serverMap[activeServerId];
        const profile = claimedProfiles.find(p => p.server_id === activeServerId);
        
        if (currentAccount.is_creator || currentAccount.is_admin) {
            setCurrentUserPermissions(0xFFFFFFFF); // All permissions
            return;
        }

        if (!profile) {
            setCurrentUserPermissions(0);
            return;
        }

        // Fetch both the user's assigned roles AND the server's @everyone role
        Promise.all([
            fetch(`${baseUrl}/api/guilds/${activeServerId}/profiles/${profile.id}/roles`, {
                headers: { 'Authorization': `Bearer ${currentAccount?.token}` }
            }).then(r => r.ok ? r.json() : []),
            fetch(`${baseUrl}/api/guilds/${activeServerId}/roles`, {
                headers: { 'Authorization': `Bearer ${currentAccount?.token}` }
            }).then(r => r.ok ? r.json() : [])
        ])
            .then(([userRoles, allRoles]) => {
                let perms = 0;

                // Apply @everyone role permissions (if they're valid Harmony values, not Discord imports)
                const everyoneRole = Array.isArray(allRoles)
                    ? allRoles.find((r: any) => r.name === '@everyone')
                    : null;
                if (everyoneRole && everyoneRole.permissions <= 0xFFFFFF) {
                    perms |= everyoneRole.permissions;
                }

                // Apply DEFAULT_USER_PERMS baseline for USER-role profiles
                // (mirrors server-side DEFAULT_USER_PERMS: SEND_MESSAGES | ATTACH_FILES | VIEW_CHANNEL | READ_MESSAGE_HISTORY | MENTION_EVERYONE)
                if (profile.role === 'USER') {
                    perms |= (Permission.SEND_MESSAGES | Permission.ATTACH_FILES 
                        | Permission.VIEW_CHANNEL | Permission.READ_MESSAGE_HISTORY 
                        | Permission.MENTION_EVERYONE);
                }

                // Apply user's specifically assigned roles
                if (Array.isArray(userRoles)) {
                    userRoles.forEach((r: any) => perms |= r.permissions);
                }
                if (profile.role === 'OWNER') perms |= Permission.ADMINISTRATOR;
                setCurrentUserPermissions(perms);
            })
            .catch(err => {
                console.error("Failed to fetch permissions:", err);
                setCurrentUserPermissions(0);
            });
    }, [activeServerId, currentAccount, claimedProfiles, serverMap, setCurrentUserPermissions]);

    // Sync with global showGuildSettings flag (set by GuildSidebar context menu)
    useEffect(() => {
        if (showGuildSettings && activeServerId) {
            setShowSettings(true);
            setShowGuildSettings(false);
        }
    }, [showGuildSettings, activeServerId, setShowGuildSettings]);

    useEffect(() => {
        if (!activeServerId) {
            setChannels([]);
            setCategories([]);
            return;
        }

        const baseUrl = serverMap[activeServerId];
        if (!baseUrl) return;

        const authHeaders = { 'Authorization': `Bearer ${currentAccount?.token}` };

        Promise.all([
            fetch(`${baseUrl}/api/guilds/${activeServerId}/categories`, { headers: authHeaders }).then(r => r.ok ? r.json() : []),
            fetch(`${baseUrl}/api/guilds/${activeServerId}/channels`, { headers: authHeaders }).then(r => r.ok ? r.json() : [])
        ])
            .then(([catsData, chansData]) => {
                const safeCats = Array.isArray(catsData) ? catsData : [];
                const safeChans = Array.isArray(chansData) ? chansData : [];
                setCategories(safeCats);
                setChannels(safeChans);
                if (safeChans.length > 0 && !activeChannelId) {
                    setActiveChannelId(safeChans[0].id, safeChans[0].name);
                }
            })
            .catch(console.error);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeServerId, refreshTrigger, serverMap, currentAccount]);

    const toggleCategory = (categoryId: string) => {
        setCollapsedCategories(prev => ({
            ...prev,
            [categoryId]: !prev[categoryId]
        }));
    };

    const collapseAllCategories = useCallback(() => {
        const all: Record<string, boolean> = {};
        categories.forEach(cat => { all[cat.id] = true; });
        setCollapsedCategories(all);
    }, [categories]);

    const handleChannelContextMenu = useCallback((e: React.MouseEvent, channel: ChannelData) => {
        e.preventDefault();
        e.stopPropagation();
        const items = buildChannelMenu({
            channelId: channel.id,
            channelName: channel.name,
            guildId: activeServerId || '',
            currentPermissions: currentUserPermissions,
            isUnread: unreadChannels.has(channel.id),
        });
        openContextMenu({ x: e.clientX, y: e.clientY }, items);
    }, [activeServerId, currentUserPermissions, unreadChannels, openContextMenu]);

    const handleCategoryContextMenu = useCallback((e: React.MouseEvent, category: CategoryData) => {
        e.preventDefault();
        e.stopPropagation();
        const categoryChannels = channels.filter(ch => ch.category_id === category.id);
        const hasUnread = categoryChannels.some(ch => unreadChannels.has(ch.id));
        const items = buildCategoryMenu({
            categoryId: category.id,
            categoryName: category.name,
            guildId: activeServerId || '',
            currentPermissions: currentUserPermissions,
            isCollapsed: !!collapsedCategories[category.id],
            hasUnreadChannels: hasUnread,
            onToggleCollapse: () => toggleCategory(category.id),
            onCollapseAll: collapseAllCategories,
        });
        openContextMenu({ x: e.clientX, y: e.clientY }, items);
    }, [activeServerId, currentUserPermissions, unreadChannels, channels, collapsedCategories, collapseAllCategories, openContextMenu]);

    // Group channels by category
    const categorizedChannels = categories.map(cat => ({
        ...cat,
        channels: channels.filter(ch => ch.category_id === cat.id)
    }));
    const uncategorizedChannels = channels.filter(ch => !ch.category_id);

    if (!activeServerId) {
        return (
            <div style={{ width: 'var(--channel-sidebar-width)', backgroundColor: 'var(--bg-secondary)', padding: '16px' }}>
                <h3 style={{ borderBottom: '1px solid var(--divider)', paddingBottom: '12px' }}>Direct Messages</h3>
            </div>
        );
    }

    return (
        <div className="channel-sidebar" style={{ width: 'var(--channel-sidebar-width)', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--divider)', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Guild Configuration</span>
                <Settings data-testid="settings-gear" size={18} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowSettings(true)} />
            </div>
            <div style={{ padding: '12px 0 12px 8px', display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
                {uncategorizedChannels.map(channel => {
                    const isVoice = channel.type === 'voice';
                    const isSelected = isVoice ? activeVoiceChannelId === channel.id : activeChannelId === channel.id;
                    return (
                        <div
                            key={channel.id}
                            onClick={() => {
                                if (isVoice) {
                                    setActiveVoiceChannelId(channel.id);
                                    setActiveChannelId(channel.id, channel.name); // Optional: also focus the connected text chat
                                } else {
                                    setActiveChannelId(channel.id, channel.name);
                                }
                            }}
                            onContextMenu={(e) => handleChannelContextMenu(e, channel)}
                            style={{
                                padding: '6px 8px',
                                marginRight: '8px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '6px',
                                backgroundColor: isSelected ? 'var(--bg-modifier-selected)' : 'transparent',
                                color: isSelected ? 'var(--interactive-active)' : 'var(--interactive-normal)',
                                marginBottom: '2px'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', flex: 1, paddingTop: '2px' }}>
                                {isVoice ? <Volume2 size={18} style={{ flexShrink: 0 }} /> : <Hash size={18} style={{ flexShrink: 0 }} />}
                                <span style={{ lineHeight: '1.2' }}>{channel.name}</span>
                            </div>
                            {unreadChannels.has(channel.id) && !isSelected && (
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--text-normal)' }} />
                            )}
                        </div>
                    );
                })}

                {categorizedChannels.map((category, index) => (
                    <div key={category.id} style={{ display: 'flex', flexDirection: 'column', marginTop: index === 0 && uncategorizedChannels.length === 0 ? '0px' : '12px' }}>
                        <div
                            onClick={() => toggleCategory(category.id)}
                            onContextMenu={(e) => handleCategoryContextMenu(e, category)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                                color: 'var(--text-muted)',
                                padding: '4px 8px',
                                cursor: 'pointer',
                                userSelect: 'none'
                            }}
                        >
                            <span style={{ marginRight: '2px', display: 'flex' }}>
                                {collapsedCategories[category.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                            </span>
                            {category.name}
                        </div>

                        {!collapsedCategories[category.id] && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                                {category.channels.map(channel => {
                                    const isVoice = channel.type === 'voice';
                                    const isSelected = isVoice ? activeVoiceChannelId === channel.id : activeChannelId === channel.id;
                                    return (
                                        <div
                                            key={channel.id}
                                            onClick={() => {
                                                if (isVoice) {
                                                    setActiveVoiceChannelId(channel.id);
                                                    setActiveChannelId(channel.id, channel.name);
                                                } else {
                                                    setActiveChannelId(channel.id, channel.name);
                                                }
                                            }}
                                            onContextMenu={(e) => handleChannelContextMenu(e, channel)}
                                            style={{
                                                padding: '6px 8px',
                                                marginRight: '8px',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'flex-start',
                                                gap: '6px',
                                                backgroundColor: isSelected ? 'var(--bg-modifier-selected)' : 'transparent',
                                                color: isSelected ? 'var(--interactive-active)' : 'var(--interactive-normal)',
                                                marginBottom: '2px'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', flex: 1, paddingTop: '2px' }}>
                                                {isVoice ? <Volume2 size={18} style={{ flexShrink: 0 }} /> : <Hash size={18} style={{ flexShrink: 0 }} />}
                                                <span style={{ 
                                                    fontWeight: unreadChannels.has(channel.id) && !isSelected ? 'bold' : 'normal', 
                                                    color: unreadChannels.has(channel.id) && !isSelected ? 'var(--text-normal)' : undefined,
                                                    lineHeight: '1.2'
                                                }}>{channel.name}</span>
                                            </div>
                                            {unreadChannels.has(channel.id) && !isSelected && (
                                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--text-normal)' }} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <UserPanel />
            {showSettings && (
                <GuildSettings onClose={() => {
                    setShowSettings(false);
                    setRefreshTrigger(prev => prev + 1);
                }} />
            )}
        </div>
    );
};
