import { useEffect, useState, useRef, useCallback } from 'react';
import type { MessageData } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { signPayload, deriveSharedKey, decryptMessageContent } from '../utils/crypto';
import { VoiceChannel } from './voice/VoiceChannel';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';
import { TypingIndicator } from './TypingIndicator';
import { PhoneCall, Search } from 'lucide-react';
import { SearchSidebar } from './SearchSidebar';
import { convertToWsUrl } from '../utils/url';

export const ChatArea = () => {
    // Targeted Selectors (Only the ones that don't change frequently)
    const activeChannelId = useAppStore(state => state.activeChannelId);
    const activeChannelName = useAppStore(state => state.activeChannelName);
    const activeServerId = useAppStore(state => state.activeServerId);
    const serverMap = useAppStore(state => state.serverMap);
    const sessionPrivateKey = useAppStore(state => state.sessionPrivateKey);
    const currentAccount = useAppStore(state => state.currentAccount);
    const setServerRoles = useAppStore(state => state.setServerRoles);
    const setServerProfiles = useAppStore(state => state.setServerProfiles);
    const activeVoiceChannelId = useAppStore(state => state.activeVoiceChannelId);
    const setActiveVoiceChannelId = useAppStore(state => state.setActiveVoiceChannelId);
    const serverProfiles = useAppStore(state => state.serverProfiles);

    const isSearchSidebarOpen = useAppStore(state => state.isSearchSidebarOpen);
    const setSearchSidebarOpen = useAppStore(state => state.setSearchSidebarOpen);

    const [messages, setMessages] = useState<MessageData[]>([]);
    const [firstItemIndex, setFirstItemIndex] = useState(1000000);
    const [hasMoreMessages, setHasMoreMessages] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const messageListRef = useRef<any>(null);

    // Editing state
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [messageToDelete, setMessageToDelete] = useState<string | null>(null);

    const [replyingTo, setReplyingTo] = useState<MessageData | null>(null);
    const [activeEmojiPickerId, setActiveEmojiPickerId] = useState<string | null>(null);
    const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
    const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const typingListenersRef = useRef<Set<(payload: any) => void>>(new Set());

    const addTypingListener = useCallback((handler: (payload: any) => void) => {
        typingListenersRef.current.add(handler);
        return () => typingListenersRef.current.delete(handler);
    }, []);

    const decryptMessages = useCallback(async (msgList: MessageData[]): Promise<MessageData[]> => {
        if (!sessionPrivateKey) return msgList;
        
        const decrypted = await Promise.all(msgList.map(async (m) => {
            // Check if the message is actually encrypted rather than guessing by colon presence
            if (m.is_encrypted && m.public_key) {
                try {
                    // We derive the shared key using our private key and the sender's public key
                    // This works for 1-on-1 and for messages we sent ourselves (if we use the recipient's pubkey)
                    // For group channels, it depends on whether we use a shared channel key.
                    const aesKey = await deriveSharedKey(sessionPrivateKey, m.public_key);
                    const decryptedContent = await decryptMessageContent(m.content, aesKey);
                    return { ...m, content: decryptedContent };
                } catch (e) {
                    console.error("Failed to decrypt message", m.id, e);
                    // Return with fallback content
                    return { ...m, content: "🔒 Message could not be decrypted" };
                }
            }
            return m;
        }));
        return decrypted;
    }, [sessionPrivateKey]);

    const LIMIT = 50;

    useEffect(() => {
        if (!activeServerId || !serverMap[activeServerId]) return;

        // Fetch profiles
        fetch(`${serverMap[activeServerId]}/api/servers/${activeServerId}/profiles`, {
            headers: { 'Authorization': `Bearer ${currentAccount?.token}` }
        })
            .then(res => res.ok ? res.json() : [])
            .then(data => setServerProfiles(Array.isArray(data) ? data : []))
            .catch(console.error);

        // Fetch roles
        fetch(`${serverMap[activeServerId]}/api/servers/${activeServerId}/roles`, {
            headers: { 'Authorization': `Bearer ${currentAccount?.token}` }
        })
            .then(res => res.ok ? res.json() : [])
            .then(data => setServerRoles(Array.isArray(data) ? data : []))
            .catch(console.error);
    }, [activeServerId, serverMap, setServerRoles, setServerProfiles]);

    useEffect(() => {
        if (!activeChannelId || !activeServerId || !serverMap[activeServerId]) return;

        const currentPendingJump = useAppStore.getState().pendingJump;

        setMessages([]);
        setFirstItemIndex(1000000);
        setHasMoreMessages(true);

        if (currentPendingJump && currentPendingJump.channelId === activeChannelId) {
            const { messageId } = currentPendingJump;
            // Do NOT clear pendingJump here to avoid React Strict Mode double-effect bug.
            // It will be cleared inside onJumpComplete in MessageList.
            
            fetch(`${serverMap[activeServerId]}/api/channels/${activeChannelId}/messages/around/${messageId}`, {
                headers: { 'Authorization': `Bearer ${currentAccount?.token}` }
            })
                .then(res => res.ok ? res.json() : [])
                .then(async data => {
                    const safeData = Array.isArray(data) ? data : [];
                    const decrypted = await decryptMessages(safeData);
                    setMessages(decrypted);
                    setHasMoreMessages(true);
                    setJumpToMessageId(messageId);
                    // Do NOT clear pendingJump here — onJumpComplete clears it after scroll finishes
                })
                .catch(console.error);
            return;
        }

        fetch(`${serverMap[activeServerId]}/api/channels/${activeChannelId}/messages?limit=${LIMIT}`, {
            headers: { 'Authorization': `Bearer ${currentAccount?.token}` }
        })
            .then(res => res.ok ? res.json() : [])
            .then(async data => {
                const safeData = Array.isArray(data) ? data : [];
                const decrypted = await decryptMessages(safeData);
                setMessages(decrypted);
                if (safeData.length < LIMIT) setHasMoreMessages(false);
            })
            .catch(console.error);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeChannelId, activeServerId, serverMap, decryptMessages, currentAccount]);

    useEffect(() => {
        if (!activeChannelId || !activeServerId || !serverMap[activeServerId] || messages.length === 0) return;
        const lastMessage = messages[messages.length - 1];
        if (lastMessage) {
            fetch(`${serverMap[activeServerId]}/api/channels/${activeChannelId}/read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentAccount?.token || ''}`
                },
                body: JSON.stringify({ lastMessageId: lastMessage.id })
            }).catch(console.error);
            useAppStore.getState().updateReadState(activeChannelId, lastMessage.id);
            useAppStore.getState().removeUnreadChannel(activeChannelId);
        }
    }, [messages, activeChannelId, activeServerId, serverMap, currentAccount]);

    useEffect(() => {
        if (!activeChannelId || !activeServerId || !serverMap[activeServerId]) return;
        // Basic WebSocket connection
        const wsUrl = convertToWsUrl(serverMap[activeServerId]);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        let isIdle = false;
        let idleTimer: ReturnType<typeof setTimeout>;
        let lastActivity = Date.now();

        const resetIdleTimer = () => {
            if (isIdle) {
                isIdle = false;
                ws.send(JSON.stringify({ type: 'PRESENCE_UPDATE', data: { status: 'online' } }));
            }
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                isIdle = true;
                ws.send(JSON.stringify({ type: 'PRESENCE_UPDATE', data: { status: 'idle' } }));
            }, 5 * 60 * 1000);
        };

        const onUserActivity = () => {
            const now = Date.now();
            if (now - lastActivity > 1000) {
                lastActivity = now;
                if (ws.readyState === WebSocket.OPEN) {
                    resetIdleTimer();
                }
            }
        };

        ws.onopen = () => {
            const currentToken = useAppStore.getState().currentAccount?.token;
            if (currentToken) {
                ws.send(JSON.stringify({ type: 'PRESENCE_IDENTIFY', data: { token: currentToken } }));
            }
            window.addEventListener('mousemove', onUserActivity);
            window.addEventListener('keydown', onUserActivity);
            resetIdleTimer();
        };

        ws.onmessage = async (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'NEW_MESSAGE' || payload.type === 'NEW_DM_MESSAGE') {
                    if (payload.data.channel_id === activeChannelId) {
                        const decrypted = await decryptMessages([payload.data]);
                        setMessages(prev => [...prev, decrypted[0]]);
                    } else {
                        useAppStore.getState().addUnreadChannel(payload.data.channel_id);
                    }
                } else if (payload.type === 'MESSAGE_UPDATE') {
                    const decrypted = await decryptMessages([payload.data]);
                    setMessages((prev: MessageData[]) => prev.map((m: MessageData) => m.id === payload.data.id ? { ...m, ...decrypted[0] } : m));
                } else if (payload.type === 'REACTION_ADD') {
                    if (payload.data.channel_id === activeChannelId) {
                        setMessages((prev: MessageData[]) => prev.map(m => m.id === payload.data.message_id ? { ...m, reactions: [...(m.reactions || []), { author_id: payload.data.author_id, emoji: payload.data.emoji }] } : m));
                    }
                } else if (payload.type === 'REACTION_REMOVE') {
                    if (payload.data.channel_id === activeChannelId) {
                        setMessages((prev: MessageData[]) => prev.map(m => m.id === payload.data.message_id ? { ...m, reactions: (m.reactions || []).filter(r => !(r.author_id === payload.data.author_id && r.emoji === payload.data.emoji)) } : m));
                    }
                } else if (payload.type === 'PRESENCE_SYNC') {
                    const { setPresenceMap } = useAppStore.getState();
                    const map: any = {};
                    payload.data.forEach((p: any) => map[p.accountId] = p);
                    setPresenceMap(map);
                } else if (payload.type === 'PRESENCE_UPDATE') {
                    const { updatePresence } = useAppStore.getState();
                    updatePresence(payload.data);
                } else if (payload.type === 'PROFILE_UPDATE') {
                    if (payload.data.server_id === activeServerId) {
                        const { updateServerProfile } = useAppStore.getState();
                        updateServerProfile(payload.data);
                    }
                } else if (payload.type === 'TYPING_START' || payload.type === 'TYPING_STOP') {
                    typingListenersRef.current.forEach(listener => listener(payload));
                }
            } catch (e) { }
        };

        return () => {
            ws.close();
            wsRef.current = null;
            clearTimeout(idleTimer);
            window.removeEventListener('mousemove', onUserActivity);
            window.removeEventListener('keydown', onUserActivity);
        };
    }, [activeChannelId, activeServerId, serverMap]);

    const messagesRef = useRef(messages);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    const handleLoadMore = useCallback(() => {
        if (isLoadingMore || !hasMoreMessages || !activeChannelId || messagesRef.current.length === 0) return;

        setIsLoadingMore(true);
        const oldestMessage = messagesRef.current[0];

        fetch(`${serverMap[activeServerId!]}/api/channels/${activeChannelId}/messages?limit=${LIMIT}&cursor=${encodeURIComponent(oldestMessage.timestamp)}`, {
            headers: { 'Authorization': `Bearer ${currentAccount?.token}` }
        })
            .then(res => res.ok ? res.json() : [])
            .then(data => {
                const safeData = Array.isArray(data) ? data : [];
                if (safeData.length < LIMIT) setHasMoreMessages(false);
                if (safeData.length > 0) {
                    setMessages((prev: MessageData[]) => [...safeData, ...prev]);
                    setFirstItemIndex((prev) => prev - safeData.length);
                }
            })
            .catch(console.error)
            .finally(() => setIsLoadingMore(false));
    }, [isLoadingMore, hasMoreMessages, activeChannelId, activeServerId, serverMap]);

    const handleCopyLink = useCallback((msgId: string) => {
        let base = window.location.origin;
        if (base === 'file://' || base.includes('tauri://') || window.location.protocol === 'file:') {
            base = serverMap[activeServerId!] || base;
        }
        const link = `${base}/#/server/${activeServerId}/channels/${activeChannelId}/messages/${msgId}`;
        navigator.clipboard.writeText(link).then(() => { });
    }, [activeServerId, activeChannelId, serverMap]);

    const handleAddReaction = useCallback(async (messageId: string, emoji: string) => {
        if (!activeChannelId || !activeServerId) return;
        fetch(`${serverMap[activeServerId]}/api/channels/${activeChannelId}/messages/${messageId}/reactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentAccount?.token || ''}` },
            body: JSON.stringify({ emoji })
        }).catch(console.error);
    }, [activeChannelId, activeServerId, serverMap, currentAccount]);

    const handleRemoveReaction = useCallback(async (messageId: string, emoji: string) => {
        if (!activeChannelId || !activeServerId) return;
        fetch(`${serverMap[activeServerId]}/api/channels/${activeChannelId}/messages/${messageId}/reactions/${emoji}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${currentAccount?.token || ''}` }
        }).catch(console.error);
    }, [activeChannelId, activeServerId, serverMap, currentAccount]);

    const onEdit = useCallback(async (messageId: string) => {
        if (!editValue.trim() || !activeChannelId) return;

        let signature = '';
        if (sessionPrivateKey) {
            try {
                signature = await signPayload(editValue, sessionPrivateKey);
            } catch (err) {
                console.error("Failed to sign payload", err);
            }
        }

        fetch(`${serverMap[activeServerId!]}/api/channels/${activeChannelId}/messages/${messageId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAppStore.getState().currentAccount?.token || ''}` },
            body: JSON.stringify({ content: editValue, signature })
        }).catch(console.error);

        setEditingMessageId(null);
    }, [editValue, activeChannelId, activeServerId, serverMap, sessionPrivateKey]);

    const confirmDelete = useCallback(async () => {
        if (!messageToDelete || !activeChannelId) return;

        const messageId = messageToDelete;
        setMessageToDelete(null);

        fetch(`${serverMap[activeServerId!]}/api/channels/${activeChannelId}/messages/${messageId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${useAppStore.getState().currentAccount?.token || ''}` }
        }).then(() => {
            setMessages((prev: MessageData[]) => prev.filter((m: MessageData) => m.id !== messageId));
        }).catch(console.error);
    }, [messageToDelete, activeChannelId, activeServerId, serverMap]);

    const onDelete = useCallback(async (messageId: string) => {
        if (!activeChannelId) return;
        setMessageToDelete(messageId);
    }, [activeChannelId]);

    const handleJumpToMessage = useCallback(async (serverId: string, channelId: string, messageId: string) => {
        if (activeChannelId === channelId) {
            // Check if the message is actually rendered in the DOM, meaning it's on screen or very close.
            const element = document.querySelector(`[data-message-id="${messageId}"]`);
            if (element) {
                setJumpToMessageId(messageId);
                return;
            }

            // If it's NOT in the DOM, it's either unloaded or too far away in the virtual list.
            // Safest method: Fetch accurate context around the message.
            setMessages([]);
            setFirstItemIndex(1000000);
            setHasMoreMessages(true);
            try {
                const res = await fetch(`${serverMap[serverId]}/api/channels/${channelId}/messages/around/${messageId}`, {
                    headers: { 'Authorization': `Bearer ${currentAccount?.token}` }
                });
                const data = await res.json();
                setMessages(data);
                setHasMoreMessages(true);
                setJumpToMessageId(messageId);
                // Do NOT clear pendingJump here — onJumpComplete clears it after scroll finishes
            } catch (e) {
                console.error(e);
            }
            return;
        }
        if (serverId !== activeServerId) {
            useAppStore.getState().setActiveServerId(serverId);
        }

        try {
            const res = await fetch(`${serverMap[serverId]}/api/servers/${serverId}/channels`, {
                headers: { 'Authorization': `Bearer ${useAppStore.getState().currentAccount?.token}` }
            });
            if (res.ok) {
                const channels = await res.json();
                const channel = channels.find((c: any) => c.id === channelId);
                useAppStore.getState().setPendingJump({ channelId, messageId });
                useAppStore.getState().setActiveChannelId(channelId, channel ? channel.name : '');
                return;
            }
        } catch (e) {
            console.error('Failed to fetch channel name for jump', e);
        }

        useAppStore.getState().setPendingJump({ channelId, messageId });
        useAppStore.getState().setActiveChannelId(channelId);
    }, [activeChannelId, activeServerId, serverMap]);

    useEffect(() => {
        const handleJumpEvent = (e: Event) => {
            const customEvent = e as CustomEvent;
            const { serverId, channelId, messageId } = customEvent.detail;
            handleJumpToMessage(serverId, channelId, messageId);
        };
        window.addEventListener('harmony-jump', handleJumpEvent);
        return () => window.removeEventListener('harmony-jump', handleJumpEvent);
    }, [handleJumpToMessage]);


    if (!activeChannelId) {
        return <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)' }}></div>;
    }

    const currentProfile = serverProfiles.find(p => p.account_id === currentAccount?.id) || null;

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', backgroundColor: 'var(--bg-primary)', minWidth: 0, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
            {/* Header */}
            <div style={{ height: '48px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', padding: '0 16px', justifyContent: 'space-between', fontWeight: 'bold', flexShrink: 0 }}>
                <span style={{ fontSize: '15px', color: 'var(--header-primary)' }}># {activeChannelName || 'active-channel'}</span>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {/* Search Bar */}
                    <div 
                        onClick={() => !isSearchSidebarOpen && setSearchSidebarOpen(true)}
                        style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px', 
                            backgroundColor: 'var(--bg-tertiary)', 
                            padding: '4px 8px', 
                            borderRadius: '4px',
                            cursor: 'text',
                            width: isSearchSidebarOpen ? '0' : '144px',
                            opacity: isSearchSidebarOpen ? 0 : 1,
                            overflow: 'hidden',
                            transition: 'all 0.2s ease',
                            color: 'var(--text-muted)',
                            fontSize: '13px',
                            fontWeight: 'normal'
                        }}
                    >
                        <Search size={14} />
                        <span>Search</span>
                    </div>

                    <div title={activeVoiceChannelId === activeChannelId ? "Leave Voice/Huddle" : "Join Voice/Huddle"} style={{ display: 'flex' }}>
                        <PhoneCall size={20} style={{ cursor: 'pointer', color: activeVoiceChannelId === activeChannelId ? 'var(--status-danger)' : 'var(--interactive-normal)' }} onClick={() => {
                            if (activeVoiceChannelId === activeChannelId) {
                                setActiveVoiceChannelId(null);
                            } else {
                                setActiveVoiceChannelId(activeChannelId);
                            }
                        }} />
                    </div>
                </div>
            </div>

            {activeVoiceChannelId && serverMap[activeServerId!] && (
                <div style={{ height: '45vh', minHeight: '300px', borderBottom: '1px solid var(--divider)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <VoiceChannel
                        channelId={activeVoiceChannelId}
                        serverUrl={serverMap[activeServerId!]}
                        onClose={() => setActiveVoiceChannelId(null)}
                    />
                </div>
            )}

            {/* Message List */}
            <MessageList 
                ref={messageListRef}
                messages={messages}
                firstItemIndex={firstItemIndex}
                editingMessageId={editingMessageId}
                editValue={editValue}
                setEditValue={setEditValue}
                onCancelEdit={() => setEditingMessageId(null)}
                onEdit={onEdit}
                onDelete={onDelete}
                handleAddReaction={handleAddReaction}
                handleRemoveReaction={handleRemoveReaction}
                handleCopyLink={handleCopyLink}
                onReply={(m) => setReplyingTo(m)}
                activeEmojiPickerId={activeEmojiPickerId}
                setActiveEmojiPickerId={setActiveEmojiPickerId}
                serverMap={serverMap}
                activeServerId={activeServerId}
                activeChannelId={activeChannelId}
                onLoadMore={handleLoadMore}
                isLoadingMore={isLoadingMore}
                currentProfileId={currentProfile?.id}
                highlightedMessageId={highlightedMessageId}
                jumpToMessageId={jumpToMessageId}
                onJumpComplete={(id) => {
                    setJumpToMessageId(null);
                    useAppStore.getState().setPendingJump(null);
                    setHighlightedMessageId(id);
                    setTimeout(() => setHighlightedMessageId(null), 2500);
                }}
                typingIndicator={
                    <TypingIndicator 
                        activeChannelId={activeChannelId}
                        currentAccountId={currentAccount?.id}
                        addTypingListener={addTypingListener}
                    />
                }
            />

            {/* Input Box */}
            <MessageInput
                activeChannelId={activeChannelId}
                activeChannelName={activeChannelName || 'active-channel'}
                activeServerId={activeServerId!}
                serverUrl={serverMap[activeServerId!]}
                currentProfile={currentProfile}
                currentAccount={currentAccount}
                sessionPrivateKey={sessionPrivateKey}
                replyingTo={replyingTo}
                setReplyingTo={setReplyingTo}
                wsRef={wsRef}
                onMessageSent={() => {
                    setTimeout(() => {
                        messageListRef.current?.scrollToBottom();
                    }, 50); // Increased timeout for better Virtuoso state sync
                }}
            />
        </div>

        <SearchSidebar 
            onJumpToMessage={handleJumpToMessage}
        />

        {messageToDelete && (
            <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
                <div style={{
                    backgroundColor: 'var(--bg-primary)', padding: '24px', borderRadius: '8px',
                    width: '400px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', border: '1px solid var(--divider)'
                }}>
                    <h3 style={{ margin: '0 0 16px 0', color: 'var(--header-primary)' }}>Delete Message</h3>
                    <p style={{ margin: '0 0 24px 0', color: 'var(--text-normal)' }}>Are you sure you want to delete this message? This action cannot be undone.</p>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                        <button 
                            onClick={() => setMessageToDelete(null)}
                            style={{ padding: '8px 16px', background: 'var(--bg-modifier-selected)', color: 'var(--text-normal)', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                        >Cancel</button>
                        <button 
                            onClick={confirmDelete}
                            style={{ padding: '8px 16px', background: 'var(--status-danger)', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold' }}
                        >Delete</button>
                    </div>
                </div>
            </div>
        )}

        </div>
    );
};
