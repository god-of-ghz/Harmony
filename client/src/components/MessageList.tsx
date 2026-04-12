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
    currentProfileId,
    highlightedMessageId,
    jumpToMessageId,
    onJumpComplete,
    typingIndicator
}, ref) => {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [isJumping, setIsJumping] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(false);

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
        } else {
            // Keep followOutput disabled for 1.5 seconds after jump finishes
            // to prevent Virtuoso from snapping to the bottom due to deferred followOutput state checks.
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

    useEffect(() => {
        if (jumpToMessageId && listItems.length > 0) {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    const index = listItems.findIndex(item => item.msg.id === jumpToMessageId);
                    if (index !== -1) {
                        virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + index, align: 'center', behavior: 'auto' });
                        setTimeout(() => {
                            onJumpComplete?.(jumpToMessageId);
                        }, 50);
                    }
                }, 100);
            });
        }
    }, [jumpToMessageId, listItems, firstItemIndex, onJumpComplete]);

    const lastScrolledChannelId = useRef<string | null>(null);

    useEffect(() => {
        if (activeChannelId && listItems.length > 0 && lastScrolledChannelId.current !== activeChannelId) {
            metadataCache.clear();
            // Check immediately if we are handling a jump. If so, completely skip the scroll-to-bottom timeout.
            const pendingJump = useAppStore.getState().pendingJump;
            if (pendingJump || jumpToMessageId) {
                lastScrolledChannelId.current = activeChannelId;
                return;
            }

            const timer = setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + listItems.length - 1, align: 'end', behavior: 'auto' });
                lastScrolledChannelId.current = activeChannelId;
            }, 150); // Increased delay slightly for layout stability
            return () => clearTimeout(timer);
        } else if (!activeChannelId) {
            lastScrolledChannelId.current = null;
        }
    }, [activeChannelId, listItems.length, firstItemIndex, jumpToMessageId]);

    const renderItem = useCallback((_index: number, item: ListItem) => {
        const msg = item.msg;
        const isEditing = editingMessageId === msg.id;

        return (
            <MessageItem
                key={msg.id}
                msg={msg}
                isGrouped={item.isGrouped}
                showDaySeparator={item.showDaySeparator}
                daySeparatorDate={item.dateString}
                isMentioned={false} 
                isAuthor={msg.author_id === currentProfileId}    
                isEditing={isEditing}
                editValue={editValue}
                setEditValue={setEditValue}
                onCancelEdit={onCancelEdit}
                onEdit={onEdit}
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
        highlightedMessageId
    ]);

    if (listItems.length === 0) {
        return <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)' }} />;
    }

    return (
        <Virtuoso
            key={activeChannelId || 'none'}
            ref={virtuosoRef}
            firstItemIndex={firstItemIndex}
            data={listItems}
            itemContent={renderItem}
            computeItemKey={(_index, item) => item.msg.id}
            followOutput={isJumping || isLoadingMore ? false : (isInitialLoading ? true : "auto")}
            alignToBottom={true}
            atBottomThreshold={150} // More forgiving for dynamic shifts when near the bottom
            increaseViewportBy={500} // More aggressive pre-rendering for smoothness
            startReached={onLoadMore}
            initialTopMostItemIndex={targetIndex !== -1 ? firstItemIndex + targetIndex : firstItemIndex + listItems.length - 1} // Fallback for initial load
            data-testid="scroll-container"
            components={{
                Header: () => isLoadingMore ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '8px' }}>Loading older messages...</div> : null,
                Footer: () => (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
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
