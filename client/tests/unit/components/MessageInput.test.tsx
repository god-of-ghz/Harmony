import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { MessageInput } from '../../../src/components/MessageInput';
import { useAppStore } from '../../../src/store/appStore';
import { useContextMenuStore } from '../../../src/store/contextMenuStore';

// Mock crypto
vi.mock('../../../src/utils/crypto', () => ({
    signPayload: vi.fn().mockResolvedValue('mock-signature'),
    deriveSharedKey: vi.fn().mockResolvedValue({}),
    encryptMessageContent: vi.fn().mockImplementation((p) => Promise.resolve(p)),
}));

// Mock WebSocket
class MockWebSocket {
    readyState = 1;
    send = vi.fn();
}

describe('MessageInput Mention Autocomplete', () => {
    const mockWs = new MockWebSocket();
    const wsRef = { current: mockWs as any };
    
    const mockProfiles = [
        {
            id: 'user1',
            server_id: 'server1',
            account_id: 'acc1',
            original_username: 'godofghz',
            nickname: 'Dungeon Master',
            avatar: '',
            role: 'owner',
            aliases: ''
        },
        {
            id: 'user2',
            server_id: 'server1',
            account_id: 'acc2',
            original_username: 'bob123',
            nickname: 'Builder Bob',
            avatar: '',
            role: 'user',
            aliases: ''
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({
            serverProfiles: mockProfiles,
            guildRoles: [],
            serverRoles: [],
            currentAccount: { id: 'my-acc', token: 'token' }
        });
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ urls: [] })
        });
    });

    it('surfaces user by original_username matching', async () => {
        render(
            <MessageInput 
                activeChannelId="chan1"
                activeChannelName="general"
                activeServerId="serv1"
                serverUrl="http://localhost"
                currentProfile={mockProfiles[0] as any}
                currentAccount={{id: 'acc1'}}
                sessionPrivateKey={{} as any}
                replyingTo={null}
                setReplyingTo={() => {}}
                wsRef={wsRef}
            />
        );

        const input = screen.getByPlaceholderText('Message #general');
        fireEvent.change(input, { target: { value: '@god', selectionStart: 4 } });

        await waitFor(() => {
            expect(screen.getByText('Dungeon Master')).toBeInTheDocument();
            expect(screen.getByText('@godofghz')).toBeInTheDocument();
        });
    });

    it('surfaces user by nickname matching', async () => {
        render(
            <MessageInput 
                activeChannelId="chan1"
                activeChannelName="general"
                activeServerId="serv1"
                serverUrl="http://localhost"
                currentProfile={mockProfiles[0] as any}
                currentAccount={{id: 'acc1'}}
                sessionPrivateKey={{} as any}
                replyingTo={null}
                setReplyingTo={() => {}}
                wsRef={wsRef}
            />
        );

        const input = screen.getByPlaceholderText('Message #general');
        fireEvent.change(input, { target: { value: '@Dungeon', selectionStart: 8 } });

        await waitFor(() => {
            expect(screen.getByText('Dungeon Master')).toBeInTheDocument();
            expect(screen.getByText('@godofghz')).toBeInTheDocument();
        });
    });

    it('prioritizes exact matches in autocomplete', async () => {
        // Add a user whose username contains "bob" but is not "bob"
        useAppStore.setState({
            serverProfiles: [
                ...mockProfiles,
                {
                    id: 'user3',
                    server_id: 'server1',
                    account_id: 'acc3',
                    original_username: 'sponge_bob',
                    nickname: 'Sponge',
                    avatar: '',
                    role: 'user',
                    aliases: ''
                }
            ]
        });

        render(
            <MessageInput 
                activeChannelId="chan1"
                activeChannelName="general"
                activeServerId="serv1"
                serverUrl="http://localhost"
                currentProfile={mockProfiles[0] as any}
                currentAccount={{id: 'acc1'}}
                sessionPrivateKey={{} as any}
                replyingTo={null}
                setReplyingTo={() => {}}
                wsRef={wsRef}
            />
        );

        const input = screen.getByPlaceholderText('Message #general');
        // Type @bob - this should match "Builder Bob" (contains bob) and "sponge_bob" (contains bob)
        // Actually "Builder Bob" STARTS with "Builder", but "bob123" STARTS with "bob".
        // Wait, if I type "@bob", then "bob123" starts with "bob". "sponge_bob" contains "bob".
        // "bob123" should be first.
        fireEvent.change(input, { target: { value: '@bob', selectionStart: 4 } });

        await waitFor(() => {
            const items = screen.getAllByTestId('mention-option');
            expect(items[0]).toHaveTextContent('Builder Bob');
            expect(items[0]).toHaveTextContent('@bob123');
        });
    });

    it('parses both nicknames and original_usernames to <@id> on send', async () => {
        render(
            <MessageInput 
                activeChannelId="chan1"
                activeChannelName="general"
                activeServerId="serv1"
                serverUrl="http://localhost"
                currentProfile={mockProfiles[0] as any}
                currentAccount={{id: 'acc1', token: 'test-token'}}
                sessionPrivateKey={{} as any}
                replyingTo={null}
                setReplyingTo={() => {}}
                wsRef={wsRef}
            />
        );

        const input = screen.getByPlaceholderText('Message #general');
        
        // Test nickname
        fireEvent.change(input, { target: { value: 'Hello @Dungeon Master' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/messages'),
                expect.objectContaining({
                    body: expect.stringContaining('<@user1>')
                })
            );
        });

        // Test username
        fireEvent.change(input, { target: { value: 'Hey @godofghz' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/messages'),
                expect.objectContaining({
                    body: expect.stringContaining('<@user1>')
                })
            );
        });
    });

    it('does NOT send on Shift+Enter (allows multiline)', async () => {
        render(
            <MessageInput 
                activeChannelId="chan1"
                activeChannelName="general"
                activeServerId="serv1"
                serverUrl="http://localhost"
                currentProfile={mockProfiles[0] as any}
                currentAccount={{id: 'acc1', token: 'test-token'}}
                sessionPrivateKey={{} as any}
                replyingTo={null}
                setReplyingTo={() => {}}
                wsRef={wsRef}
            />
        );

        const input = screen.getByPlaceholderText('Message #general');
        fireEvent.change(input, { target: { value: 'Line 1' } });

        // Shift+Enter should NOT trigger send
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true });

        // Wait a tick and verify fetch was NOT called with /messages
        await new Promise(r => setTimeout(r, 100));
        const messageCalls = (global.fetch as any).mock.calls.filter(
            (c: any) => c[0]?.includes('/messages')
        );
        expect(messageCalls.length).toBe(0);
    });

    it('sends on Enter without Shift', async () => {
        render(
            <MessageInput 
                activeChannelId="chan1"
                activeChannelName="general"
                activeServerId="serv1"
                serverUrl="http://localhost"
                currentProfile={mockProfiles[0] as any}
                currentAccount={{id: 'acc1', token: 'test-token'}}
                sessionPrivateKey={{} as any}
                replyingTo={null}
                setReplyingTo={() => {}}
                wsRef={wsRef}
            />
        );

        const input = screen.getByPlaceholderText('Message #general');
        fireEvent.change(input, { target: { value: 'Hello world' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/messages'),
                expect.objectContaining({
                    method: 'POST'
                })
            );
        });
    });

    describe('Context Menus & Icons', () => {
        beforeEach(() => {
            vi.spyOn(useContextMenuStore.getState(), 'openContextMenu').mockImplementation(() => {});
        });

        it('clicking the + icon opens the attachment context menu', () => {
            render(
                <MessageInput 
                    activeChannelId="chan1"
                    activeChannelName="general"
                    activeServerId="serv1"
                    serverUrl="http://localhost"
                    currentProfile={mockProfiles[0] as any}
                    currentAccount={{id: 'acc1', token: 'test-token'}}
                    sessionPrivateKey={{} as any}
                    replyingTo={null}
                    setReplyingTo={() => {}}
                    wsRef={wsRef}
                />
            );

            // The plus icon is rendered inside a div next to the input
            const plusIcon = screen.getByRole('textbox').previousSibling as HTMLElement;
            fireEvent.click(plusIcon);

            expect(useContextMenuStore.getState().openContextMenu).toHaveBeenCalledWith(
                expect.any(Object),
                expect.arrayContaining([
                    expect.objectContaining({ id: 'upload-file', label: 'Upload a File' })
                ])
            );
        });

        it('right clicking the message bar opens the context menu', () => {
            render(
                <MessageInput 
                    activeChannelId="chan1"
                    activeChannelName="general"
                    activeServerId="serv1"
                    serverUrl="http://localhost"
                    currentProfile={mockProfiles[0] as any}
                    currentAccount={{id: 'acc1', token: 'test-token'}}
                    sessionPrivateKey={{} as any}
                    replyingTo={null}
                    setReplyingTo={() => {}}
                    wsRef={wsRef}
                />
            );

            // The container of the textarea has the onContextMenu handler
            const container = screen.getByRole('textbox').parentElement!;
            fireEvent.contextMenu(container);

            expect(useContextMenuStore.getState().openContextMenu).toHaveBeenCalledWith(
                expect.any(Object),
                expect.arrayContaining([
                    expect.objectContaining({ id: 'quick-react' }),
                    expect.objectContaining({ id: 'add-emoji' }),
                    expect.objectContaining({ id: 'toggle-send-btn' }),
                    expect.objectContaining({ id: 'toggle-spellcheck' }),
                    expect.objectContaining({ id: 'paste' })
                ])
            );
        });
    });
});
