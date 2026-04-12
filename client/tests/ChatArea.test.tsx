import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { ChatArea } from '../src/components/ChatArea';
import { useAppStore } from '../src/store/appStore';

// Mock WebSocket
class MockWebSocket {
    onopen: () => void = () => {};
    onmessage: (event: { data: string }) => void = () => {};
    onclose: () => void = () => {};
    send = vi.fn();
    close = vi.fn();
    readyState = 1; // OPEN

    constructor(url: string) {
        setTimeout(() => this.onopen(), 0);
    }
}

const MockWebSocketFn = vi.fn().mockImplementation(function (this: any, url: string) {
    return new MockWebSocket(url);
});
global.WebSocket = MockWebSocketFn as any;


global.fetch = vi.fn();

describe('ChatArea component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Setup initial Zustand state
        useAppStore.setState({
            activeServerId: 'server1',
            activeChannelId: 'channel1',
            activeChannelName: 'general',
            claimedProfiles: [{
                id: 'profile1',
                server_id: 'server1',
                account_id: 'account1',
                original_username: 'me',
                nickname: 'me',
                avatar: '',
                role: 'USER',
                aliases: ''
            }],
            serverMap: { 'server1': 'http://localhost' },
            currentAccount: { id: 'account1', email: 'test@example.com', is_creator: false, token: 'test-jwt-token' },
            unreadChannels: new Set(),
            presenceMap: {},
            currentUserPermissions: 0xFFFFFFFF,
            serverRoles: []
        });

        // Mock ResizeObserver which is often needed by scroll components or just safe to have
        global.ResizeObserver = vi.fn().mockImplementation(() => ({
            observe: vi.fn(),
            unobserve: vi.fn(),
            disconnect: vi.fn(),
        }));
    });

    it('renders messages correctly with author, and content', async () => {
        const messages = [
            {
                id: 'msg1',
                channel_id: 'channel1',
                author_id: 'profile2',
                content: 'Hello world',
                timestamp: '2024-01-01T12:00:00Z',
                username: 'Friend',
                avatar: ''
            }
        ];

        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/messages')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(messages)
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        render(<ChatArea />);

        await waitFor(() => {
            expect(screen.getByText('Hello world')).toBeInTheDocument();
            expect(screen.getByText('Friend')).toBeInTheDocument();
        });
    });

    it('renders attachments as images', async () => {
        const messages = [
            {
                id: 'msg2',
                channel_id: 'channel1',
                author_id: 'profile1',
                content: 'Check this out',
                timestamp: new Date().toISOString(),
                username: 'me',
                attachments: JSON.stringify(['/uploads/test.png'])
            }
        ];

        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/messages')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(messages)
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        render(<ChatArea />);

        await waitFor(() => {
            const img = screen.getByAltText('attachment');
            expect(img).toBeInTheDocument();
            expect(img).toHaveAttribute('src', 'http://localhost/uploads/test.png');
        });
    });

    it('triggers pagination when scrolling to top', async () => {
        const initialMessages = Array.from({ length: 50 }, (_, i) => ({
            id: `msg-${i}`,
            channel_id: 'channel1',
            author_id: 'profile1',
            content: `Message ${i}`,
            timestamp: new Date(Date.now() - i * 1000).toISOString(),
            username: 'me'
        }));

        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/messages')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(initialMessages)
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        render(<ChatArea />);

        await waitFor(() => {
            expect(screen.getByText('Message 0')).toBeInTheDocument();
        });

        const scrollContainer = screen.getByTestId('scroll-container');

        // Mock scroll values
        Object.defineProperty(scrollContainer, 'scrollTop', { value: 0, writable: true });
        Object.defineProperty(scrollContainer, 'scrollHeight', { value: 2000, writable: true });
        Object.defineProperty(scrollContainer, 'clientHeight', { value: 500, writable: true });

        // Manually trigger handleScroll via fireEvent
        fireEvent.scroll(scrollContainer);

        await waitFor(() => {
            // Verify fetch was called for previous messages (cursor)
            expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('cursor='), expect.any(Object));
        });
    });

    it('updates message list on WebSocket NEW_MESSAGE event', async () => {
        (global.fetch as any).mockImplementation(() => 
            Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        );

        render(<ChatArea />);

        await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());
        
        const wsInstances = (global.WebSocket as any).mock.instances;
        const mainWs = wsInstances[0];

        // Trigger onopen just in case
        mainWs.onopen();

        const newMessage = {
            type: 'NEW_MESSAGE',
            data: {
                id: 'msg-ws',
                channel_id: 'channel1',
                author_id: 'profile2',
                content: 'Incoming from WS',
                timestamp: new Date().toISOString(),
                username: 'WS User'
            }
        };

        // Simulate receiving message
        mainWs.onmessage({ data: JSON.stringify(newMessage) } as MessageEvent);

        await waitFor(() => {
            expect(screen.getByText(/Incoming from WS/)).toBeInTheDocument();
        }, { timeout: 2000 });
    });

    it('handles message jump gracefully via scrollToIndex', async () => {
        useAppStore.setState({
            activeChannelId: 'channel1',
            pendingJump: { channelId: 'channel1', messageId: 'msg-target' }
        });

        const aroundMessages = Array.from({ length: 11 }, (_, i) => ({
            id: i === 5 ? 'msg-target' : `msg-around-${i}`,
            channel_id: 'channel1',
            author_id: 'profile1',
            content: `Message ${i}`,
            timestamp: new Date(Date.now() - (10 - i) * 1000).toISOString(),
            username: 'me'
        }));

        (global.fetch as any).mockImplementation((url: string) => {
            if (url.includes('/messages/around/msg-target')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(aroundMessages)
                });
            }
            if (url.includes('/messages')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(aroundMessages)
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        render(<ChatArea />);

        // Wait for the target message to render
        await waitFor(() => {
            expect(screen.getByText('Message 5')).toBeInTheDocument();
        });

        // All messages around the target should be rendered
        await waitFor(() => {
            expect(screen.getByText('Message 0')).toBeInTheDocument();
            expect(screen.getByText('Message 10')).toBeInTheDocument();
        });
    });
});
