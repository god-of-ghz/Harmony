import { useAppStore } from '../store/appStore';
import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// Stable empty array to avoid infinite re-renders from Zustand selectors
// (Object.is([], []) is false, so returning a new [] each time triggers loops)
const EMPTY_RESULTS: any[] = [];

interface SearchSidebarProps {
    onJumpToMessage: (serverId: string, channelId: string, messageId: string) => void;
}

export const SearchSidebar = ({ onJumpToMessage }: SearchSidebarProps) => {
    const activeServerId = useAppStore(state => state.activeServerId);
    
    // Guild-scoped search state
    const isSearchSidebarOpen = useAppStore(state => activeServerId ? (state.searchStateByGuild[activeServerId]?.isOpen ?? false) : false);
    const searchQuery = useAppStore(state => activeServerId ? (state.searchStateByGuild[activeServerId]?.query ?? '') : '');
    const searchResults = useAppStore(state => activeServerId ? (state.searchStateByGuild[activeServerId]?.results ?? EMPTY_RESULTS) : EMPTY_RESULTS);

    const setSearchSidebarOpen = useAppStore(state => state.setSearchSidebarOpen);
    const setSearchQuery = useAppStore(state => state.setSearchQuery);
    const setSearchResults = useAppStore(state => state.setSearchResults);
    const serverMap = useAppStore(state => state.serverMap);

    const [isSearching, setIsSearching] = useState(false);

    const handleSearch = useCallback(async () => {
        if (!searchQuery.trim() || !activeServerId || !serverMap[activeServerId]) return;
        setIsSearching(true);
        try {
            const res = await fetch(`${serverMap[activeServerId]}/api/guilds/${activeServerId}/search?query=${encodeURIComponent(searchQuery)}`, {
                headers: { 'Authorization': `Bearer ${useAppStore.getState().currentAccount?.token}` }
            });
            const data = await res.json();
            setSearchResults(data);
        } catch (err) {
            console.error(err);
        } finally {
            setIsSearching(false);
        }
    }, [searchQuery, activeServerId, serverMap, setSearchResults]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchQuery.trim()) handleSearch();
            else setSearchResults([]);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery, handleSearch, setSearchResults]);

    const highlightText = (text: string, highlight: string) => {
        if (!highlight.trim()) return text;
        const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
        return (
            <span>
                {parts.map((part, i) => 
                    part.toLowerCase() === highlight.toLowerCase() ? 
                        <span key={i} className="search-highlight">{part}</span> : 
                        part
                )}
            </span>
        );
    };

    if (!isSearchSidebarOpen) return null;

    return (
        <div style={{
            width: '420px',
            backgroundColor: 'var(--bg-secondary)',
            borderLeft: '1px solid var(--divider)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideIn 0.2s ease-out',
            flexShrink: 0
        }}>
            <style>
                {`
                @keyframes slideIn {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
                .search-result-item {
                    padding: 16px;
                    border-radius: 8px;
                    margin: 8px;
                    background: var(--bg-primary);
                    cursor: pointer;
                    transition: all 0.2s ease;
                    border: 1px solid transparent;
                    position: relative;
                    overflow: hidden;
                }
                .search-result-item:hover {
                    background: var(--bg-modifier-hover);
                    border-color: var(--brand-experiment);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                }
                .search-result-item:active {
                    transform: translateY(0);
                }
                .search-highlight {
                    background: rgba(255, 170, 0, 0.4);
                    color: #fff;
                    border-radius: 2px;
                    padding: 0 2px;
                    font-weight: 500;
                }
                .search-scroll::-webkit-scrollbar {
                    width: 8px;
                }
                .search-scroll::-webkit-scrollbar-track {
                    background: transparent;
                }
                .search-scroll::-webkit-scrollbar-thumb {
                    background: var(--bg-tertiary);
                    border-radius: 4px;
                }
                `}
            </style>
            
            <div style={{ height: '48px', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--divider)', flexShrink: 0 }}>
                <span style={{ fontWeight: 'bold', fontSize: '15px', color: 'var(--header-primary)' }}>Search Results</span>
                <X data-testid="close-search" size={18} style={{ cursor: 'pointer', color: 'var(--interactive-normal)' }} onClick={() => setSearchSidebarOpen(false)} />
            </div>

            <div style={{ padding: '16px', borderBottom: '1px solid var(--divider)', flexShrink: 0 }}>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Search size={16} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
                    <input
                        data-testid="search-input"
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search messages..."
                        autoFocus
                        style={{
                            width: '100%',
                            padding: '10px 12px 10px 36px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--bg-tertiary)',
                            border: 'none',
                            color: 'var(--text-normal)',
                            fontSize: '14px',
                            outline: 'none'
                        }}
                    />
                    {searchQuery && (
                        <X 
                            size={14} 
                            style={{ position: 'absolute', right: '10px', color: 'var(--text-muted)', cursor: 'pointer' }} 
                            onClick={() => setSearchQuery('')}
                        />
                    )}
                </div>
                <div style={{ marginTop: '12px', fontSize: '12px', fontWeight: '500', color: 'var(--header-secondary)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                    {isSearching ? 'Searching...' : `${searchResults.length} results found`}
                </div>
            </div>

            <div className="search-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                {searchResults.length === 0 && !isSearching && searchQuery.trim() && (
                    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <div style={{ marginBottom: '12px' }}><Search size={48} opacity={0.2} /></div>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-normal)' }}>No results found</div>
                        <div style={{ fontSize: '14px', marginTop: '4px' }}>Try a different keyword or check your spelling.</div>
                    </div>
                )}
                
                {searchResults.map((msg: any) => (
                    <div 
                        key={msg.id} 
                        className="search-result-item"
                        data-testid="search-result-item"
                        onClick={() => onJumpToMessage(activeServerId!, msg.channel_id, msg.id)}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                            {msg.avatar ? (
                                <img src={`${serverMap[activeServerId!]}${msg.avatar}`} style={{ width: '24px', height: '24px', borderRadius: '50%' }} alt="" />
                            ) : (
                                <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--brand-experiment)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#fff', fontWeight: 'bold' }}>
                                    {msg.username[0].toUpperCase()}
                                </div>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                                    <span style={{ fontWeight: '600', fontSize: '14px', color: 'var(--header-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {msg.username}
                                    </span>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0 }}>
                                        {new Date(msg.timestamp).toLocaleDateString()} {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ color: 'var(--interactive-normal)', fontWeight: '600' }}># {msg.channel_name}</span>
                        </div>
                        <div style={{ fontSize: '14px', color: 'var(--text-normal)', wordBreak: 'break-word', lineHeight: '1.4' }}>
                            {highlightText(msg.content, searchQuery)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
