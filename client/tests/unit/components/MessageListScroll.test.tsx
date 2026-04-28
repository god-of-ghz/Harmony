import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { MessageList } from '../../../src/components/MessageList';

// Mock react-virtuoso with ref support and prop tracking
const mockScrollToIndex = vi.fn();
let capturedFollowOutput: any = null;
let capturedStartReached: any = null;
let capturedEndReached: any = null;

vi.mock('react-virtuoso', () => {
    const React = require('react');
    return {
        Virtuoso: React.forwardRef((props: any, ref: any) => {
            capturedFollowOutput = props.followOutput;
            capturedStartReached = props.startReached;
            capturedEndReached = props.endReached;
            React.useImperativeHandle(ref, () => ({
                scrollToIndex: mockScrollToIndex
            }));
            return (
                <div data-testid="mock-virtuoso">
                    {props.data?.map((item: any, i: number) => (
                        <div key={i}>{item.type === 'message' ? item.msg.content : 'separator'}</div>
                    ))}
                </div>
            );
        })
    };
});

describe('MessageList scroll behavior', () => {
    const defaultProps = {
        messages: [],
        firstItemIndex: 1000,
        editingMessageId: null,
        editValue: '',
        setEditValue: vi.fn(),
        onCancelEdit: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        handleAddReaction: vi.fn(),
        handleRemoveReaction: vi.fn(),
        handleCopyLink: vi.fn(),
        onReply: vi.fn(),
        activeEmojiPickerId: null,
        setActiveEmojiPickerId: vi.fn(),
        guildMap: {},
        serverMap: {},
        activeGuildId: 'server1',
        activeServerId: 'server1',
        activeChannelId: 'channel1',
        onLoadMore: vi.fn(),
        isLoadingMore: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    it('scrolls to bottom when messages are loaded for a new channel', async () => {
        const { rerender } = render(<MessageList {...defaultProps} messages={[]} />);
        
        // No messages yet, so no scroll
        expect(mockScrollToIndex).not.toHaveBeenCalled();

        // Load messages for channel1
        const messages = [{ id: '1', content: 'hello', timestamp: new Date().toISOString(), username: 'user', author_id: 'p1' }];
        rerender(<MessageList {...defaultProps} messages={messages} />);

        // Should trigger scroll after timeout
        act(() => {
            vi.advanceTimersByTime(200);
        });

        expect(mockScrollToIndex).toHaveBeenCalledWith(expect.objectContaining({
            index: 1000, // firstItemIndex + listItems.length (1) - 1. Date separator is merged into message item.
            align: 'end'
        }));
    });

    it('does not re-scroll if messages change within the same channel', async () => {
        const messages1 = [{ id: '1', content: 'hello', timestamp: new Date().toISOString(), username: 'user', author_id: 'p1' }];
        const { rerender } = render(<MessageList {...defaultProps} messages={messages1} />);
        
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(mockScrollToIndex).toHaveBeenCalledTimes(1);

        // Add a second message to the same channel
        const messages2 = [...messages1, { id: '2', content: 'world', timestamp: new Date().toISOString(), username: 'user', author_id: 'p1' }];
        rerender(<MessageList {...defaultProps} messages={messages2} />);

        act(() => {
            vi.advanceTimersByTime(200);
        });

        // Should NOT have called scrollToIndex again because activeChannelId hasn't changed
        expect(mockScrollToIndex).toHaveBeenCalledTimes(1);
    });

    it('re-scrolls when switching to a different channel', async () => {
        const messages1 = [{ id: '1', content: 'hello', timestamp: new Date().toISOString(), username: 'user', author_id: 'p1' }];
        const { rerender } = render(<MessageList {...defaultProps} messages={messages1} />);
        
        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(mockScrollToIndex).toHaveBeenCalledTimes(1);

        // Switch to channel2
        const messages2 = [{ id: '2', content: 'goodbye', timestamp: new Date().toISOString(), username: 'user', author_id: 'p1' }];
        rerender(<MessageList {...defaultProps} activeChannelId="channel2" messages={messages2} />);

        act(() => {
            vi.advanceTimersByTime(200);
        });

        // Should have called scrollToIndex again for the new channel
        expect(mockScrollToIndex).toHaveBeenCalledTimes(2);
    });

    it('forces followOutput=true during the initial 2-second lock period', async () => {
        const messages = [{ id: '1', content: 'hello', timestamp: new Date().toISOString(), username: 'user', author_id: 'p1' }];
        
        render(<MessageList {...defaultProps} activeChannelId="channel-new" messages={messages} />);
        
        // Initially should be true
        expect(capturedFollowOutput).toBe(true);

        // Advance 2.1 seconds
        act(() => {
            vi.advanceTimersByTime(2100);
        });

        // Should return to "auto"
        expect(capturedFollowOutput).toBe('auto');
    });

    it('binds startReached to onLoadMore and endReached to onLoadNewer', async () => {
        const mockOnLoadMore = vi.fn();
        const mockOnLoadNewer = vi.fn();

        const messages = [{ id: '1', content: 'hello', timestamp: new Date().toISOString(), username: 'user', author_id: 'p1' }];
        
        render(<MessageList 
            {...defaultProps} 
            activeChannelId="channel-pagination" 
            messages={messages} 
            onLoadMore={mockOnLoadMore}
            onLoadNewer={mockOnLoadNewer}
            hasNewerMessages={true}
        />);
        
        // Assert props were passed correctly to the mocked Virtuoso
        expect(capturedStartReached).toBeDefined();
        expect(capturedEndReached).toBeDefined();

        // Trigger them
        capturedStartReached();
        expect(mockOnLoadMore).toHaveBeenCalled();

        capturedEndReached();
        expect(mockOnLoadNewer).toHaveBeenCalled();
    });
});
