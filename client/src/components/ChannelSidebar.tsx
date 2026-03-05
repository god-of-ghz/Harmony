import { useEffect, useState } from 'react';
import type { ChannelData, CategoryData } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { Hash, Settings, ChevronDown, ChevronRight } from 'lucide-react';
import { ServerSettings } from './ServerSettings';

export const ChannelSidebar = () => {
    const { activeServerId, activeChannelId, setActiveChannelId, serverUrl } = useAppStore();
    const [channels, setChannels] = useState<ChannelData[]>([]);
    const [categories, setCategories] = useState<CategoryData[]>([]);
    const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
    const [showSettings, setShowSettings] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    useEffect(() => {
        if (!activeServerId) {
            setChannels([]);
            setCategories([]);
            return;
        }

        Promise.all([
            fetch(`${serverUrl}/api/servers/${activeServerId}/categories`).then(r => r.json()),
            fetch(`${serverUrl}/api/servers/${activeServerId}/channels`).then(r => r.json())
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
                <Settings size={18} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowSettings(true)} />
            </div>
            <div style={{ padding: '12px 0 12px 8px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto' }}>
                {uncategorizedChannels.map(channel => (
                    <div
                        key={channel.id}
                        onClick={() => setActiveChannelId(channel.id, channel.name)}
                        style={{
                            padding: '6px 8px',
                            marginRight: '8px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            backgroundColor: activeChannelId === channel.id ? 'var(--bg-modifier-selected)' : 'transparent',
                            color: activeChannelId === channel.id ? 'var(--interactive-active)' : 'var(--interactive-normal)'
                        }}
                    >
                        <Hash size={18} />
                        <span>{channel.name}</span>
                    </div>
                ))}

                {categorizedChannels.map(category => (
                    <div key={category.id} style={{ display: 'flex', flexDirection: 'column' }}>
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
                                {category.channels.map(channel => (
                                    <div
                                        key={channel.id}
                                        onClick={() => setActiveChannelId(channel.id, channel.name)}
                                        style={{
                                            padding: '6px 8px',
                                            marginRight: '8px',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            backgroundColor: activeChannelId === channel.id ? 'var(--bg-modifier-selected)' : 'transparent',
                                            color: activeChannelId === channel.id ? 'var(--interactive-active)' : 'var(--interactive-normal)'
                                        }}
                                    >
                                        <Hash size={18} />
                                        <span>{channel.name}</span>
                                    </div>
                                ))}
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
