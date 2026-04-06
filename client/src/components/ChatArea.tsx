import { useEffect, useState, useRef, useCallback } from 'react';
import type { MessageData } from '../store/appStore';
import { useAppStore } from '../store/appStore';
import { signPayload } from '../utils/crypto';
import { VoiceChannel } from './voice/VoiceChannel';
import { MessageInput } from './MessageInput';
import { MessageList } from './MessageList';
import { TypingIndicator } from './TypingIndicator';
import { PhoneCall } from 'lucide-react';

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

    const [messages, setMessages] = useState<MessageData[]>([]);
    const [firstItemIndex, setFirstItemIndex] = useState(1000000);
    const [hasMoreMessages, setHasMoreMessages] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const messageListRef = useRef<any>(null);

    // Editing state
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

    const [replyingTo, setReplyingTo] = useState<MessageData | null>(null);
    const [activeEmojiPickerId, setActiveEmojiPickerId] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const typingListenersRef = useRef<Set<(payload: any) => void>>(new Set());

    const addTypingListener = useCallback((handler: (payload: any) => void) => {
        typingListenersRef.current.add(handler);
        return () => typingListenersRef.current.delete(handler);
    }, []);

    const LIMIT = 50;

    useEffect(() => {
        if (!activeServerId || !serverMap[activeServerId]) return;

        // Fetch profiles
        fetch(`${serverMap[activeServerId]}/api/servers/${activeServerId}/profiles`)
            .then(res => res.json())
            .then(data => setServerProfiles(data))
            .catch(console.error);

        // Fetch roles
        fetch(`${serverMap[activeServerId]}/api/servers/${activeServerId}/roles`)
            .then(res => res.json())
            .then(data => setServerRoles(data))
            .catch(console.error);
    }, [activeServerId, serverMap, setServerRoles, setServerProfiles]);

    useEffect(() => {
        if (!activeChannelId || !activeServerId || !serverMap[activeServerId]) return;

        setMessages([]);
        setFirstItemIndex(1000000);
        setHasMoreMessages(true);

        fetch(`${serverMap[activeServerId]}/api/channels/${activeChannelId}/messages?limit=${LIMIT}`)
            .then(res => res.json())
            .then(data => {
                setMessages(data);
                if (data.length < LIMIT) setHasMoreMessages(false);
            })
            .catch(console.error);
    }, [activeChannelId, activeServerId, serverMap]);

    useEffect(() => {
        if (!activeChannelId || !activeServerId || !serverMap[activeServerId] || messages.length === 0) return;
        const lastMessage = messages[messages.length - 1];
        if (lastMessage) {
            fetch(`${serverMap[activeServerId]}/api/channels/${activeChannelId}/read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Account-Id': currentAccount?.id || ''
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
        const wsUrl = serverMap[activeServerId].replace(/^http/, 'ws');
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
            const currentAccountId = useAppStore.getState().currentAccount?.id;
            if (currentAccountId) {
                ws.send(JSON.stringify({ type: 'PRESENCE_IDENTIFY', data: { accountId: currentAccountId } }));
            }
            window.addEventListener('mousemove', onUserActivity);
            window.addEventListener('keydown', onUserActivity);
            resetIdleTimer();
        };

        ws.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'NEW_MESSAGE' || payload.type === 'NEW_DM_MESSAGE') {
                    if (payload.data.channel_id === activeChannelId) {
                        setMessages(prev => [...prev, payload.data]);
                    } else {
                        useAppStore.getState().addUnreadChannel(payload.data.channel_id);
                    }
                } else if (payload.type === 'MESSAGE_UPDATE') {
                    setMessages((prev: MessageData[]) => prev.map((m: MessageData) => m.id === payload.data.id ? { ...m, ...payload.data } : m));
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

        fetch(`${serverMap[activeServerId!]}/api/channels/${activeChannelId}/messages?limit=${LIMIT}&cursor=${encodeURIComponent(oldestMessage.timestamp)}`)
            .then(res => res.json())
            .then(data => {
                if (data.length < LIMIT) setHasMoreMessages(false);
                if (data.length > 0) {
                    setMessages((prev: MessageData[]) => [...data, ...prev]);
                    setFirstItemIndex((prev) => prev - data.length);
                }
            })
            .catch(console.error)
            .finally(() => setIsLoadingMore(false));
    }, [isLoadingMore, hasMoreMessages, activeChannelId, activeServerId, serverMap]);

    const handleCopyLink = useCallback((msgId: string) => {
        const link = `${window.location.origin}/#/server/${activeServerId}/channels/${activeChannelId}/messages/${msgId}`;
        navigator.clipboard.writeText(link).then(() => { });
    }, [activeServerId, activeChannelId]);

    const handleAddReaction = useCallback(async (messageId: string, emoji: string) => {
        if (!activeChannelId || !activeServerId) return;
        fetch(`${serverMap[activeServerId]}/api/channels/${activeChannelId}/messages/${messageId}/reactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': currentAccount?.id || '' },
            body: JSON.stringify({ emoji })
        }).catch(console.error);
    }, [activeChannelId, activeServerId, serverMap, currentAccount]);

    const handleRemoveReaction = useCallback(async (messageId: string, emoji: string) => {
        if (!activeChannelId || !activeServerId) return;
        fetch(`${serverMap[activeServerId]}/api/channels/${activeChannelId}/messages/${messageId}/reactions/${emoji}`, {
            method: 'DELETE',
            headers: { 'X-Account-Id': currentAccount?.id || '' }
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
            headers: { 'Content-Type': 'application/json', 'X-Account-Id': useAppStore.getState().currentAccount?.id || '' },
            body: JSON.stringify({ content: editValue, signature })
        }).catch(console.error);

        setEditingMessageId(null);
    }, [editValue, activeChannelId, activeServerId, serverMap, sessionPrivateKey]);

    const onDelete = useCallback(async (messageId: string) => {
        if (!activeChannelId || !window.confirm("Are you sure you want to delete this message?")) return;

        fetch(`${serverMap[activeServerId!]}/api/channels/${activeChannelId}/messages/${messageId}`, {
            method: 'DELETE',
            headers: { 'X-Account-Id': useAppStore.getState().currentAccount?.id || '' }
        }).then(() => {
            setMessages((prev: MessageData[]) => prev.filter((m: MessageData) => m.id !== messageId));
        }).catch(console.error);
    }, [activeChannelId, activeServerId, serverMap]);


    if (!activeChannelId) {
        return <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)' }}></div>;
    }

    const currentProfile = serverProfiles.find(p => p.account_id === currentAccount?.id) || null;

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)', minWidth: 0, minHeight: 0 }}>
            {/* Header */}
            <div style={{ height: '48px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', padding: '0 16px', justifyContent: 'space-between', fontWeight: 'bold' }}>
                <span># {activeChannelName || 'active-channel'}</span>
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
            />

            <TypingIndicator 
                activeChannelId={activeChannelId}
                currentAccountId={currentAccount?.id}
                addTypingListener={addTypingListener}
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
                    }, 10);
                }}
            />
        </div>
    );
};
