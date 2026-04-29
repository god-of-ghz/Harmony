import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useAppStore, type MessageData } from '../store/appStore';
import { MessageItem } from './MessageItem';
import React, { forwardRef, useImperativeHandle } from 'react';

interface MessageListProps {
    messages: MessageData[];
    firstItemIndex: number;
    editingMessageId: string | null;
    editValue: string;
    setEditValue: (val: string) => void;
    onCancelEdit: () => void;
    onEdit: (messageId: string) => void;
    onStartEdit: (messageId: string, content: string) => void;
    onDelete: (messageId: string) => void;
    handleAddReaction: (messageId: string, emoji: string) => void;
    handleRemoveReaction: (messageId: string, emoji: string) => void;
    handleCopyLink: (msgId: string) => void;
    onReply: (msg: MessageData) => void;
    activeEmojiPickerId: string | null;
    setActiveEmojiPickerId: (id: string | null) => void;
    serverMap: Record<string, string>;
    activeServerId: string | null;
    activeChannelId: string | null;
    onLoadMore: () => void;
    isLoadingMore: boolean;
    onLoadNewer?: () => void;
    isLoadingNewer?: boolean;
    hasNewerMessages?: boolean;
    currentProfileId?: string;
    highlightedMessageId?: string | null;
    jumpToMessageId?: string | null;
    onJumpComplete?: (messageId: string) => void;
    typingIndicator?: React.ReactNode;
}

type ListItem = { 
    msg: MessageData; 
    isGrouped: boolean; 
    showDaySeparator: boolean; 
    dateString: string;
};

// Internal cache for message metadata to avoid re-calculating thousands of items
// Key: `${msg.id}-${prevMsgId}`
const metadataCache = new Map<string, { isGrouped: boolean, showDaySeparator: boolean, dateString: string }>();

export interface MessageListHandle {
    scrollToBottom: () => void;
    scrollToIndex: (index: number) => void;
}

export const MessageList = React.memo(forwardRef<MessageListHandle, MessageListProps>(({
    messages,
    firstItemIndex,
    editingMessageId,
    editValue,
    setEditValue,
    onCancelEdit,
    onEdit,
    onStartEdit,
    onDelete,
    handleAddReaction,
    handleRemoveReaction,
    handleCopyLink,
    onReply,
    activeEmojiPickerId,
    setActiveEmojiPickerId,
    serverMap,
    activeServerId,
    activeChannelId,
    onLoadMore,
    isLoadingMore,
    onLoadNewer,
    isLoadingNewer,
    hasNewerMessages,
    currentProfileId,
    highlightedMessageId,
    jumpToMessageId,
    onJumpComplete,
    typingIndicator
}, ref) => {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [isJumping, setIsJumping] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(false);
    // jumpKey forces Virtuoso to remount when a jump occurs, so initialTopMostItemIndex takes effect
    const [jumpKey, setJumpKey] = useState(0);

    const currentProfile = useAppStore(useCallback(state => 
        state.claimedProfiles.find(p => p.server_id === activeServerId), 
    [activeServerId]));
    const serverRoles = useAppStore(state => state.serverRoles);

    const mentionChecks = useMemo(() => {
        if (!currentProfile) return { ids: [], roleIds: [], tags: [] };
        
        const ids = [currentProfile.id];
        const tags = [
            `@${currentProfile.nickname}`,
            `@${currentProfile.original_username}`
        ];
        
        if (currentProfile.aliases) {
            currentProfile.aliases.split(',').forEach(a => {
                const alias = a.trim();
                if (alias) {
                    ids.push(alias);
                    tags.push(`@${alias}`);
                }
            });
        }
        
        const roleIds: string[] = [];
        if (currentProfile.role) {
            currentProfile.role.split(',').forEach(r => {
                const roleId = r.trim();
                if (roleId) {
                    roleIds.push(roleId);
                    const role = serverRoles.find(sr => sr.id === roleId);
                    if (role) {
                        tags.push(`@${role.name}`);
                    }
                }
            });
        }
        
        tags.push('@everyone', '@here');
        
        return { ids, roleIds, tags };
    }, [currentProfile, serverRoles]);

    useEffect(() => {
        if (activeChannelId) {
            setIsInitialLoading(true);
            const timer = setTimeout(() => setIsInitialLoading(false), 2000);
            return () => clearTimeout(timer);
        }
    }, [activeChannelId]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (jumpToMessageId) {
            setIsJumping(true);
            // Force Virtuoso to remount so initialTopMostItemIndex positions the target correctly
            setJumpKey(prev => prev + 1);
        } else {
            // Keep followOutput disabled for 1.5 seconds after jump finishes
            timer = setTimeout(() => {
                setIsJumping(false);
            }, 1500);
        }
        return () => clearTimeout(timer);
    }, [jumpToMessageId]);

    const listItems = useMemo(() => {
        const items: ListItem[] = [];
        
        messages.forEach((msg, index) => {
            const prevMsg = index > 0 ? messages[index - 1] : null;
            const prevId = prevMsg?.id || 'none';
            const cacheKey = `${msg.id}-${prevId}`;
            
            let cached = metadataCache.get(cacheKey);
            
            if (!cached) {
                const msgDate = new Date(msg.timestamp);
                const dateString = msgDate.toDateString();
                const prevMsgDate = prevMsg ? new Date(prevMsg.timestamp) : null;
                const showDaySeparator = !prevMsgDate || dateString !== prevMsgDate.toDateString();
                const isGrouped = !!(!showDaySeparator &&
                    prevMsg &&
                    prevMsg.author_id === msg.author_id &&
                    (msgDate.getTime() - (prevMsgDate?.getTime() || 0) < 3600000) &&
                    !msg.reply_to);
                
                cached = { isGrouped, showDaySeparator, dateString };
                metadataCache.set(cacheKey, cached);
            }

            items.push({ 
                msg, 
                isGrouped: cached.isGrouped, 
                showDaySeparator: cached.showDaySeparator,
                dateString: cached.dateString
            });
        });
        return items;
    }, [messages]);

    const targetIndex = useMemo(() => {
        if (!jumpToMessageId || listItems.length === 0) return -1;
        return listItems.findIndex(item => item.msg.id === jumpToMessageId);
    }, [jumpToMessageId, listItems]);

    useImperativeHandle(ref, () => ({
        scrollToBottom: () => {
            virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + listItems.length - 1, align: 'end', behavior: 'auto' });
        },
        scrollToIndex: (index: number) => {
            virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + index, align: 'center', behavior: 'auto' });
        }
    }), [firstItemIndex, listItems.length]);

    // Jump completion: after Virtuoso remounts at the target position, fire onJumpComplete to highlight and clean up
    useEffect(() => {
        if (jumpToMessageId && listItems.length > 0 && targetIndex !== -1) {
            const timer = setTimeout(() => {
                onJumpComplete?.(jumpToMessageId);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [jumpToMessageId, listItems, targetIndex, onJumpComplete]);

    const lastScrolledChannelId = useRef<string | null>(null);

    useEffect(() => {
        if (activeChannelId && listItems.length > 0 && lastScrolledChannelId.current !== activeChannelId) {
            metadataCache.clear();
            // Check immediately if we are handling a jump. If so, completely skip the scroll-to-bottom.
            const pendingJump = useAppStore.getState().pendingJump;
            if (pendingJump || jumpToMessageId || isJumping) {
                lastScrolledChannelId.current = activeChannelId;
                return;
            }

            const timer = setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + listItems.length - 1, align: 'end', behavior: 'auto' });
                lastScrolledChannelId.current = activeChannelId;
            }, 150);
            return () => clearTimeout(timer);
        } else if (!activeChannelId) {
            lastScrolledChannelId.current = null;
        }
    }, [activeChannelId, listItems.length, firstItemIndex, jumpToMessageId, isJumping]);

    const renderItem = useCallback((_index: number, item: ListItem) => {
        const msg = item.msg;
        const isEditing = editingMessageId === msg.id;

        let isMentioned = false;
        if (currentProfile) {
            const { ids, roleIds, tags } = mentionChecks;
            const contentLower = msg.content.toLowerCase();
            
            if (tags.some(tag => contentLower.includes(tag.toLowerCase()))) {
                isMentioned = true;
            } else {
                const userMentionMatches = [...msg.content.matchAll(/<@!?([^>]+)>/g)];
                if (userMentionMatches.some(m => ids.includes(m[1]))) {
                    isMentioned = true;
                } else if (roleIds && roleIds.length > 0) {
                    const roleMentionMatches = [...msg.content.matchAll(/<@&([^>]+)>/g)];
                    if (roleMentionMatches.some(m => roleIds.includes(m[1]))) {
                        isMentioned = true;
                    }
                }
            }
        }

        return (
            <MessageItem
                key={msg.id}
                msg={msg}
                isGrouped={item.isGrouped}
                showDaySeparator={item.showDaySeparator}
                daySeparatorDate={item.dateString}
                isMentioned={isMentioned} 
                isAuthor={msg.author_id === currentProfileId}    
                isEditing={isEditing}
                editValue={editValue}
                setEditValue={setEditValue}
                onCancelEdit={onCancelEdit}
                onEdit={onEdit}
                onStartEdit={onStartEdit}
                onDelete={onDelete}
                onAddReaction={handleAddReaction}
                onRemoveReaction={handleRemoveReaction}
                onCopyLink={handleCopyLink}
                onReply={onReply}
                activeEmojiPickerId={activeEmojiPickerId}
                setActiveEmojiPickerId={setActiveEmojiPickerId}
                serverMap={serverMap}
                activeServerId={activeServerId}
                isHighlighted={msg.id === highlightedMessageId}
            />
        );
    }, [
        editingMessageId, 
        editValue, 
        setEditValue, 
        onCancelEdit, 
        onEdit, 
        onStartEdit,
        onDelete,
        handleAddReaction, 
        handleRemoveReaction, 
        handleCopyLink, 
        onReply, 
        activeEmojiPickerId, 
        setActiveEmojiPickerId, 
        serverMap, 
        activeServerId,
        currentProfileId,
        highlightedMessageId,
        currentProfile,
        mentionChecks
    ]);

    if (listItems.length === 0) {
        return <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)' }} />;
    }

    // Determine where to start rendering:
    // - If jumping, position target at the top of the viewport
    // - Otherwise, start at the bottom (most recent messages)
    const initialIndex = targetIndex !== -1 ? targetIndex : listItems.length - 1;

    return (
        <Virtuoso
            key={`${activeChannelId || 'none'}-${jumpKey}`}
            ref={virtuosoRef}
            firstItemIndex={firstItemIndex}
            data={listItems}
            itemContent={renderItem}
            computeItemKey={(_index, item) => item.msg.id}
            followOutput={(isJumping || isLoadingMore || hasNewerMessages) ? false : (isInitialLoading ? true : "auto")}
            alignToBottom={targetIndex === -1}
            atBottomThreshold={150}
            increaseViewportBy={500}
            startReached={onLoadMore}
            endReached={hasNewerMessages ? onLoadNewer : undefined}
            initialTopMostItemIndex={initialIndex}
            data-testid="scroll-container"
            components={{
                Header: () => isLoadingMore ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '8px' }}>Loading older messages...</div> : null,
                Footer: () => (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {isLoadingNewer && <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '8px' }}>Loading newer messages...</div>}
                        {typingIndicator}
                        <div style={{ height: '24px' }} /> {/* Fixed buffer at bottom */}
                    </div>
                )
            }}
            style={{ flex: 1, backgroundColor: 'var(--bg-primary)' }}
        />
    );
}));

MessageList.displayName = 'MessageList';
