import { useMemo, useRef, useEffect, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { MessageData } from '../store/appStore';
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
}

type ListItem = 
    | { type: 'message'; msg: MessageData; isGrouped: boolean; showDaySeparator: boolean }
    | { type: 'separator'; date: string };

// Internal cache for message metadata to avoid re-calculating thousands of items
// Key: `${msg.id}-${prevMsgId}`
const metadataCache = new Map<string, { isGrouped: boolean, showDaySeparator: boolean, dateString: string }>();

export interface MessageListHandle {
    scrollToBottom: () => void;
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
    isLoadingMore
}, ref) => {
    const virtuosoRef = useRef<VirtuosoHandle>(null);



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

            if (cached.showDaySeparator) {
                items.push({ type: 'separator', date: cached.dateString });
            }

            items.push({ type: 'message', msg, isGrouped: cached.isGrouped, showDaySeparator: cached.showDaySeparator });
        });
        return items;
    }, [messages]);

    useImperativeHandle(ref, () => ({
        scrollToBottom: () => {
            virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + listItems.length - 1, align: 'end', behavior: 'auto' });
        }
    }), [firstItemIndex, listItems.length]);

    useEffect(() => {
        if (activeChannelId) {
            metadataCache.clear();
            setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + listItems.length - 1, align: 'end', behavior: 'auto' });
            }, 100);
        }
    }, [activeChannelId]);

    const renderItem = useCallback((_index: number, item: ListItem) => {
        if (item.type === 'separator') {
            return (
                <div style={{ display: 'flex', alignItems: 'center', margin: '16px 0', padding: '0 16px' }}>
                    <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--divider)' }} />
                    <span style={{ padding: '0 8px', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        {item.date}
                    </span>
                    <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--divider)' }} />
                </div>
            );
        }

        const msg = item.msg;
        const isEditing = editingMessageId === msg.id;

        return (
            <MessageItem
                key={msg.id}
                msg={msg}
                isGrouped={item.isGrouped}
                showDaySeparator={false}
                isMentioned={false} 
                isAuthor={false}    
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
        activeServerId
    ]);

    return (
        <Virtuoso
            ref={virtuosoRef}
            firstItemIndex={firstItemIndex}
            data={listItems}
            itemContent={renderItem}
            followOutput="auto"
            alignToBottom={true}
            startReached={onLoadMore}
            initialTopMostItemIndex={firstItemIndex + listItems.length - 1} // Fallback for initial load
            data-testid="scroll-container"
            components={{
                Header: () => isLoadingMore ? <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '8px' }}>Loading older messages...</div> : null,
                Footer: () => <div style={{ height: '16px' }} />
            }}
            style={{ flex: 1, backgroundColor: 'var(--bg-primary)' }}
        />
    );
}));

MessageList.displayName = 'MessageList';
