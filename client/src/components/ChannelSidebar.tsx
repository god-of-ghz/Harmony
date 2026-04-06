import { useEffect, useState } from 'react';
import type { ChannelData, CategoryData } from '../store/appStore';
import { useAppStore, Permission } from '../store/appStore';
import { Hash, Settings, ChevronDown, ChevronRight, Volume2 } from 'lucide-react';
import { ServerSettings } from './ServerSettings';

export const ChannelSidebar = () => {
    const { 
        activeServerId, 
        activeChannelId, 
        setActiveChannelId, 
        serverMap, 
        activeVoiceChannelId, 
        setActiveVoiceChannelId, 
        unreadChannels,
        currentUserPermissions,
        setCurrentUserPermissions,
        currentAccount,
        claimedProfiles
    } = useAppStore();
    const [channels, setChannels] = useState<ChannelData[]>([]);
    const [categories, setCategories] = useState<CategoryData[]>([]);
    const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
    const [showSettings, setShowSettings] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

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

        fetch(`${baseUrl}/api/servers/${activeServerId}/profiles/${profile.id}/roles`)
            .then(r => r.json())
            .then(roles => {
                let perms = 0;
                roles.forEach((r: any) => perms |= r.permissions);
                if (profile.role === 'OWNER') perms |= Permission.ADMINISTRATOR;
                setCurrentUserPermissions(perms);
            })
            .catch(err => {
                console.error("Failed to fetch permissions:", err);
                setCurrentUserPermissions(0);
            });
    }, [activeServerId, currentAccount, claimedProfiles, serverMap, setCurrentUserPermissions]);

    useEffect(() => {
        if (!activeServerId) {
            setChannels([]);
            setCategories([]);
            return;
        }

        const baseUrl = serverMap[activeServerId];
        if (!baseUrl) return;

        Promise.all([
            fetch(`${baseUrl}/api/servers/${activeServerId}/categories`).then(r => r.json()),
            fetch(`${baseUrl}/api/servers/${activeServerId}/channels`).then(r => r.json())
        ])
            .then(([catsData, chansData]) => {
                setCategories(catsData);
                setChannels(chansData);
                if (chansData.length > 0 && !activeChannelId) {
                    setActiveChannelId(chansData[0].id, chansData[0].name);
                }
            })
            .catch(console.error);
    }, [activeServerId, refreshTrigger]);

    const toggleCategory = (categoryId: string) => {
        setCollapsedCategories(prev => ({
            ...prev,
            [categoryId]: !prev[categoryId]
        }));
    };

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
        <div style={{ width: 'var(--channel-sidebar-width)', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--divider)', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Server Configuration</span>
                {(currentUserPermissions & (Permission.MANAGE_SERVER | Permission.ADMINISTRATOR)) !== 0 && (
                    <Settings data-testid="settings-gear" size={18} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowSettings(true)} />
                )}
            </div>
            <div style={{ padding: '12px 0 12px 8px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto' }}>
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
                            style={{
                                padding: '6px 8px',
                                marginRight: '8px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '6px',
                                backgroundColor: isSelected ? 'var(--bg-modifier-selected)' : 'transparent',
                                color: isSelected ? 'var(--interactive-active)' : 'var(--interactive-normal)'
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
                    <div key={category.id} style={{ display: 'flex', flexDirection: 'column', marginTop: index === 0 && uncategorizedChannels.length === 0 ? '0px' : '16px' }}>
                        <div
                            onClick={() => toggleCategory(category.id)}
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
                                            style={{
                                                padding: '6px 8px',
                                                marginRight: '8px',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'flex-start',
                                                gap: '6px',
                                                backgroundColor: isSelected ? 'var(--bg-modifier-selected)' : 'transparent',
                                                color: isSelected ? 'var(--interactive-active)' : 'var(--interactive-normal)'
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
            {showSettings && (
                <ServerSettings onClose={() => {
                    setShowSettings(false);
                    setRefreshTrigger(prev => prev + 1);
                }} />
            )}
        </div>
    );
};
