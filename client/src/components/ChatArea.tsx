import { useEffect, useState, useRef } from 'react';
import type { MessageData, Profile } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { Send } from 'lucide-react';

export const ChatArea = () => {
    const { activeChannelId, activeChannelName, activeServerId, claimedProfiles, showUnknownTags, serverMap } = useAppStore();
    const currentProfile = claimedProfiles.find(p => p.server_id === activeServerId);
    const [messages, setMessages] = useState<MessageData[]>([]);
    const [serverProfiles, setServerProfiles] = useState<Profile[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [hasMoreMessages, setHasMoreMessages] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const LIMIT = 50;

    useEffect(() => {
        if (!activeServerId || !serverMap[activeServerId]) return;
        fetch(`${serverMap[activeServerId]}/api/servers/${activeServerId}/profiles`)
            .then(res => res.json())
            .then(data => setServerProfiles(data))
            .catch(console.error);
    }, [activeServerId, serverMap]);

    useEffect(() => {
        if (!activeChannelId || !activeServerId || !serverMap[activeServerId]) return;

        setMessages([]);
        setHasMoreMessages(true);

        fetch(`${serverMap[activeServerId]}/api/channels/${activeChannelId}/messages?limit=${LIMIT}`)
            .then(res => res.json())
            .then(data => {
                setMessages(data);
                if (data.length < LIMIT) setHasMoreMessages(false);
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 100);
            })
            .catch(console.error);
    }, [activeChannelId, activeServerId, serverMap]);

    useEffect(() => {
        if (!activeChannelId || !activeServerId || !serverMap[activeServerId]) return;
        // Basic WebSocket connection
        const wsUrl = serverMap[activeServerId].replace(/^http/, 'ws');
        const ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'NEW_MESSAGE') {
                    // If the message is for the channel we're currently viewing
                    if (payload.data.channel_id === activeChannelId) {
                        setMessages(prev => [...prev, payload.data]);
                    }
                }
            } catch (e) { }
        };

        return () => { ws.close(); };
    }, [activeChannelId, activeServerId, serverMap]);

    const handleScroll = () => {
        if (!scrollContainerRef.current || isLoadingMore || !hasMoreMessages || !activeChannelId) return;

        // If user scrolls to the top
        if (scrollContainerRef.current.scrollTop === 0) {
            if (messages.length === 0) return;

            setIsLoadingMore(true);
            const oldestMessage = messages[0];
            const previousHeight = scrollContainerRef.current.scrollHeight;

            fetch(`${serverMap[activeServerId!]}/api/channels/${activeChannelId}/messages?limit=${LIMIT}&cursor=${encodeURIComponent(oldestMessage.timestamp)}`)
                .then(res => res.json())
                .then(data => {
                    if (data.length < LIMIT) setHasMoreMessages(false);
                    if (data.length > 0) {
                        setMessages(prev => [...data, ...prev]);
                        // Maintain scroll position so the view doesn't jump to top
                        setTimeout(() => {
                            if (scrollContainerRef.current) {
                                const newHeight = scrollContainerRef.current.scrollHeight;
                                scrollContainerRef.current.scrollTop = newHeight - previousHeight;
                            }
                        }, 0);
                    }
                })
                .catch(console.error)
                .finally(() => setIsLoadingMore(false));
        }
    };

    const handleSend = () => {
        if (!inputValue.trim() || !currentProfile || !activeChannelId) return;

        // Parse @nickname to <@id>
        const sortedProfiles = [...serverProfiles].sort((a, b) => b.nickname.length - a.nickname.length);
        let parsedContent = inputValue;
        for (const p of sortedProfiles) {
            const regex = new RegExp(`@${p.nickname}\\b`, 'g');
            parsedContent = parsedContent.replace(regex, `<@${p.id}>`);
        }

        fetch(`${serverMap[activeServerId!]}/api/channels/${activeChannelId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: parsedContent, authorId: currentProfile.id })
        }).catch(console.error);

        setInputValue('');
    };

    if (!activeChannelId) {
        return <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)' }}></div>;
    }

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)', minWidth: 0, minHeight: 0 }}>
            {/* Header */}
            <div style={{ height: '48px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', padding: '0 16px', fontWeight: 'bold' }}>
                # {activeChannelName || 'active-channel'}
            </div>

            {/* Message List */}
            <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}
            >
                {isLoadingMore && <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading older messages...</div>}
                {messages.map(msg => {
                    const isMentioned = currentProfile && msg.content.includes(`<@${currentProfile.id}>`);

                    // Parse content out string -> React Components
                    const contentSegments = msg.content.split(/(<@[^>]+>)/g);

                    return (
                        <div key={msg.id} className={isMentioned ? 'mentioned-message' : ''} style={{ display: 'flex', gap: '16px', padding: '4px 16px', margin: '0 -16px', borderLeft: isMentioned ? undefined : '2px solid transparent' }}>
                            <div className="avatar" style={{ width: '40px', height: '40px' }}>
                                {msg.username.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                    <span style={{ fontWeight: '500', color: 'var(--interactive-active)' }}>{msg.username}</span>
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                        {new Date(msg.timestamp).toLocaleString()}
                                    </span>
                                </div>
                                <div style={{ marginTop: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.4' }}>
                                    {contentSegments.map((segment, idx) => {
                                        if (segment.startsWith('<@') && segment.endsWith('>')) {
                                            let id = segment.slice(2, -1);
                                            if (id.startsWith('!')) id = id.slice(1);
                                            const p = serverProfiles.find(profile => profile.id === id || (profile.aliases && profile.aliases.split(',').map(a => a.trim()).includes(id)));
                                            if (p) {
                                                return <span key={idx} className="mention-tag">@{p.nickname}</span>;
                                            } else if (showUnknownTags) {
                                                return <span key={idx}>{segment}</span>;
                                            } else {
                                                return <span key={idx} className="mention-tag">@UnknownProfileOrRole</span>;
                                            }
                                        }
                                        return <span key={idx}>{segment}</span>;
                                    })}
                                </div>
                            </div>
                        </div>
                    )
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Box */}
            <div style={{ padding: '0 16px 24px 16px' }}>
                <div style={{ backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', display: 'flex', alignItems: 'center', paddingRight: '12px' }}>
                    <input
                        className="input-field"
                        style={{ backgroundColor: 'transparent' }}
                        placeholder={`Message #${activeChannelName || 'active-channel'}`}
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                    />
                    <Send
                        size={20}
                        color={inputValue.trim() ? "var(--interactive-hover)" : "var(--interactive-normal)"}
                        onClick={handleSend}
                        style={{ cursor: 'pointer' }}
                    />
                </div>
            </div>
        </div>
    );
};
