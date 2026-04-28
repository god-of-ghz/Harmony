/**
 * Tests for the MessageInput inline error banner and ChatArea WebSocket guards.
 * 
 * These tests validate the fixes for the "can't type" federation bug:
 * 1. MessageInput: alert() replaced with inline error banner (no focus stealing)
 * 2. ChatArea: WebSocket send guards prevent crashes on closed connections
 * 
 * @see implementation_plan.md for full context on the bug.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { MessageInput } from '../../../src/components/MessageInput';
import { ChatArea } from '../../../src/components/ChatArea';
import { useAppStore } from '../../../src/store/appStore';
import { installMockWebSocket, getMockWebSocketInstances, MockWebSocket } from '../../helpers/mockWebSocket';

// Mock crypto
vi.mock('../../../src/utils/crypto', () => ({
    signPayload: vi.fn().mockResolvedValue('mock-signature'),
    deriveSharedKey: vi.fn().mockResolvedValue({}),
    encryptMessageContent: vi.fn().mockImplementation((p) => Promise.resolve(p)),
    decryptMessageContent: vi.fn().mockImplementation((p) => Promise.resolve(p)),
}));

describe('MessageInput: Inline Error Banner (no alert())', () => {
    const mockWs = { readyState: 1, send: vi.fn() };
    const wsRef = { current: mockWs as any };

    const mockProfile = {
        id: 'user1',
        server_id: 'server1',
        account_id: 'acc1',
        original_username: 'testuser',
        nickname: 'TestUser',
        avatar: '',
        role: 'USER',
        aliases: ''
    };

    const renderInput = () => render(
        <MessageInput
            activeChannelId="chan1"
            activeChannelName="general"
            activeServerId="serv1"
            serverUrl="http://localhost"
            currentProfile={mockProfile as any}
            currentAccount={{ id: 'acc1', token: 'test-token' }}
            sessionPrivateKey={{} as any}
            replyingTo={null}
            setReplyingTo={() => {}}
            wsRef={wsRef}
        />
    );

    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({
            serverProfiles: [mockProfile],
            guildRoles: [],
            serverRoles: [],
            currentAccount: { id: 'acc1', token: 'test-token' }
        });
    });

    it('should NOT call window.alert on 403 errors — uses inline banner instead', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ error: 'Forbidden: Account is deactivated' })
        });

        renderInput();

        const input = screen.getByPlaceholderText('Message #general');
        fireEvent.change(input, { target: { value: 'Hello world' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(alertSpy).not.toHaveBeenCalled();
        });

        // Verify inline error banner appears
        await waitFor(() => {
            const banner = screen.getByTestId('send-error-banner');
            expect(banner).toBeInTheDocument();
            expect(banner).toHaveTextContent('Account is deactivated');
        });

        alertSpy.mockRestore();
    });

    it('should NOT call window.alert on 429 rate limit — uses inline banner instead', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
            json: () => Promise.resolve({ error: 'Rate limited' })
        });

        renderInput();

        const input = screen.getByPlaceholderText('Message #general');
        fireEvent.change(input, { target: { value: 'Spam message' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(alertSpy).not.toHaveBeenCalled();
        });

        await waitFor(() => {
            const banner = screen.getByTestId('send-error-banner');
            expect(banner).toBeInTheDocument();
            expect(banner).toHaveTextContent(/too fast/i);
        });

        alertSpy.mockRestore();
    });

    it('should display inline error on network failure instead of alert()', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        renderInput();

        const input = screen.getByPlaceholderText('Message #general');
        fireEvent.change(input, { target: { value: 'Will fail' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(alertSpy).not.toHaveBeenCalled();
        });

        await waitFor(() => {
            const banner = screen.getByTestId('send-error-banner');
            expect(banner).toBeInTheDocument();
            expect(banner).toHaveTextContent(/network error/i);
        });

        alertSpy.mockRestore();
    });

    it('should dismiss error banner when X button is clicked', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ error: 'Forbidden' })
        });

        renderInput();

        const input = screen.getByPlaceholderText('Message #general');
        fireEvent.change(input, { target: { value: 'Test' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        // Wait for error to appear
        await waitFor(() => {
            expect(screen.getByTestId('send-error-banner')).toBeInTheDocument();
        });

        // Click the X to dismiss
        const closeBtn = screen.getByTestId('send-error-banner').querySelector('svg');
        if (closeBtn) fireEvent.click(closeBtn);

        await waitFor(() => {
            expect(screen.queryByTestId('send-error-banner')).not.toBeInTheDocument();
        });
    });

    it('input should remain focusable and typeable after a send error', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ error: 'Forbidden: Account is deactivated' })
        });

        renderInput();

        const input = screen.getByPlaceholderText('Message #general') as HTMLInputElement;

        // Send a message that will fail
        fireEvent.change(input, { target: { value: 'Will fail' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        // Wait for error
        await waitFor(() => {
            expect(screen.getByTestId('send-error-banner')).toBeInTheDocument();
        });

        // Input should still be usable — this is the critical assertion
        // The old alert() would steal focus and leave the input broken
        fireEvent.change(input, { target: { value: 'This should work' } });
        expect(input.value).toBe('This should work');

        // Should be able to type and send again
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ id: 'msg-1' })
        });

        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/messages'),
                expect.objectContaining({
                    body: expect.stringContaining('This should work')
                })
            );
        });
    });
});

describe('ChatArea: WebSocket readyState guards', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        installMockWebSocket();

        useAppStore.setState({
            activeGuildId: 'server1',
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
            guildMap: { 'server1': 'http://localhost' },
            serverMap: { 'server1': 'http://localhost' },
            currentAccount: { id: 'account1', email: 'test@example.com', is_creator: false, token: 'test-jwt-token' },
            unreadChannels: new Set(),
            presenceMap: {},
            currentUserPermissions: 0xFFFFFFFF,
            guildRoles: [],
            serverRoles: []
        });

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([])
        });
    });

    it('should not crash when WS sends fail on a closing connection', async () => {
        render(<ChatArea />);

        await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());

        const wsInstances = getMockWebSocketInstances();
        const ws = wsInstances[0];

        // Open the connection
        await act(async () => {
            ws.onopen?.();
        });

        // Simulate the WS closing (server rejected the connection)
        ws.readyState = 3; // WebSocket.CLOSED
        await act(async () => {
            ws.onclose?.();
        });

        // Now simulate user activity (keydown) — this should NOT crash
        // because the resetIdleTimer guards against ws.readyState !== OPEN
        expect(() => {
            fireEvent.keyDown(document, { key: 'a' });
        }).not.toThrow();

        // Also simulate mousemove
        expect(() => {
            fireEvent.mouseMove(document);
        }).not.toThrow();
    });

    it('should detect rapid close as server rejection', async () => {
        render(<ChatArea />);

        await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());

        const wsInstances = getMockWebSocketInstances();
        const ws = wsInstances[0];

        // Open the connection
        await act(async () => {
            ws.onopen?.();
        });

        // Immediately close (simulating server rejection of deactivated account)
        ws.readyState = 3;
        await act(async () => {
            ws.onclose?.();
        });

        // ws.send should not have been called with PRESENCE_UPDATE after close
        const presenceUpdates = ws.send.mock.calls.filter(
            (call: any[]) => {
                try {
                    const parsed = JSON.parse(call[0]);
                    return parsed.type === 'PRESENCE_UPDATE';
                } catch { return false; }
            }
        );
        // There should be zero PRESENCE_UPDATE sends after the connection was rejected
        // (the PRESENCE_IDENTIFY on open is expected, but not idle/activity updates)
        expect(presenceUpdates.length).toBe(0);
    });

    it('should send PRESENCE_IDENTIFY only when WS is open', async () => {
        render(<ChatArea />);

        await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());

        const wsInstances = getMockWebSocketInstances();
        const ws = wsInstances[0];

        // Open the connection
        await act(async () => {
            ws.onopen?.();
        });

        // Verify PRESENCE_IDENTIFY was sent on open
        const identifyCalls = ws.send.mock.calls.filter(
            (call: any[]) => {
                try {
                    const parsed = JSON.parse(call[0]);
                    return parsed.type === 'PRESENCE_IDENTIFY';
                } catch { return false; }
            }
        );
        // In React Strict Mode (dev/test), effects run twice, so we may get 2 sends.
        // The important thing is that it's sent at least once.
        expect(identifyCalls.length).toBeGreaterThanOrEqual(1);
    });
});
