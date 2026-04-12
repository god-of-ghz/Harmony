import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { MessageList } from '../src/components/MessageList';

// Mock react-virtuoso
vi.mock('react-virtuoso', () => ({
    Virtuoso: vi.fn(({ components, followOutput, atBottomThreshold, increaseViewportBy }) => {
        // Render headers and footers so we can inspect them
        return (
            <div data-testid="mock-virtuoso">
                {components?.Header?.()}
                <div data-testid="footer-container">
                    {components?.Footer?.()}
                </div>
                <div data-testid="at-bottom-threshold">{atBottomThreshold}</div>
                <div data-testid="increase-viewport-by">{increaseViewportBy}</div>
            </div>
        );
    })
}));

describe('MessageList stability tests', () => {
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
        serverMap: {},
        activeServerId: 'server1',
        activeChannelId: 'channel1',
        onLoadMore: vi.fn(),
        isLoadingMore: false,
    };

    it('passes correct stability constants to Virtuoso', () => {
        render(<MessageList {...defaultProps} messages={[{ id: '1', content: 'test', timestamp: new Date().toISOString(), username: 'user', author_id: 'p1' }]} />);
        
        expect(screen.getByTestId('at-bottom-threshold')).toHaveTextContent('150');
        expect(screen.getByTestId('increase-viewport-by')).toHaveTextContent('500');
    });

    it('renders typingIndicator inside the footer container', () => {
        const typingText = "Someone is typing...";
        const typingIndicator = <div>{typingText}</div>;
        
        render(<MessageList {...defaultProps} 
            messages={[{ id: '1', content: 'test', timestamp: new Date().toISOString(), username: 'user', author_id: 'p1' }]} 
            typingIndicator={typingIndicator} 
        />);
        
        const footer = screen.getByTestId('footer-container');
        expect(footer).toHaveTextContent(typingText);
    });

    it('includes a fixed bottom buffer div in the footer', () => {
        render(<MessageList {...defaultProps} messages={[{ id: '1', content: 'test', timestamp: new Date().toISOString(), username: 'user', author_id: 'p1' }]} />);
        
        // The buffer div has height: 24px
        const footer = screen.getByTestId('footer-container');
        const buffer = footer.querySelector('div[style*="height: 24px"]');
        expect(buffer).toBeInTheDocument();
    });
});
