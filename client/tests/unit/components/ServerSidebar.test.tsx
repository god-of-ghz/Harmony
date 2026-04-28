/// <reference types="@testing-library/jest-dom" />
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerSidebar } from '../../../src/components/ServerSidebar';
import { useAppStore } from '../../../src/store/appStore';

// Mock fetch
global.fetch = vi.fn();

// Mock Zustand store
vi.mock('../../../src/store/appStore', () => {
    const mock = vi.fn();
    (mock as any).getState = vi.fn();
    (mock as any).setState = vi.fn();
    return {
        useAppStore: mock
    };
});

// Mock @hello-pangea/dnd
vi.mock('@hello-pangea/dnd', () => ({
    DragDropContext: ({ children }: any) => <div>{children}</div>,
    Droppable: ({ children }: any) => children({
        droppableProps: {},
        innerRef: vi.fn(),
        placeholder: null
    }),
    Draggable: ({ children }: any) => children({
        draggableProps: {},
        dragHandleProps: {},
        innerRef: vi.fn()
    })
}));

describe('ServerSidebar Component', () => {
    const mockSetActiveServerId = vi.fn();
    const mockSetServerMap = vi.fn();
    const mockSetClaimedProfiles = vi.fn();
    const mockSetConnectedServers = vi.fn();

    const mockState: Record<string, any> = {
        activeGuildId: 's1',
        activeServerId: 's1',
        setActiveServerId: mockSetActiveServerId,
        setActiveGuildId: vi.fn(),
        currentAccount: { id: 'account1', is_creator: true, token: 'mock-token', primary_server_url: 'http://localhost:3001' },
        connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
        guilds: [{ id: 's1', name: 'Test Server', icon: '' }],
        guildMap: { 's1': 'http://localhost:3001' },
        serverMap: { 's1': 'http://localhost:3001' },
        setGuilds: vi.fn(),
        setGuildMap: vi.fn(),
        setServerMap: mockSetServerMap,
        setClaimedProfiles: mockSetClaimedProfiles,
        setConnectedServers: mockSetConnectedServers,
        setCurrentAccount: vi.fn(),
        setSessionPrivateKey: vi.fn(),
        setProfilesLoaded: vi.fn(),
        addGuild: vi.fn(),
        claimedProfiles: [],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (useAppStore as any).mockReturnValue(mockState);
        (useAppStore as any).getState = () => mockState;
        (useAppStore as any).setState = vi.fn((updater: any) => {
            if (typeof updater === 'function') {
                Object.assign(mockState, updater(mockState));
            } else {
                Object.assign(mockState, updater);
            }
        });
        
        (global.fetch as any).mockImplementation((url: string, options: any) => {
            if (url.includes('/api/servers')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([{ id: 's1', name: 'Test Server', icon: '' }])
                });
            }
            if (url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (url.includes('/api/node/status')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ hasOwner: true }) });
            }
            if (url.includes('/api/accounts/account1/servers')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (url.includes('/api/accounts/account1/trusted_servers')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
        
        localStorage.clear();
    });

    it('renders server icons and handles navigation', async () => {
        const user = userEvent.setup();
        render(<ServerSidebar />);

        const serverIcon = await screen.findByText('TE'); // Wait for mock fetch to render
        expect(serverIcon).toBeInTheDocument();
        
        await user.click(serverIcon);
        expect(mockSetActiveServerId).toHaveBeenCalledWith('s1');
    });

    it('handles adding a peer server and joining without trusting', async () => {
        const user = userEvent.setup();
        render(<ServerSidebar />);

        await screen.findByText('TE');

        const plusButton = screen.getByTitle('Add Peer Server');
        await user.click(plusButton);
        
        expect(await screen.findByText('Join a Peer Server')).toBeInTheDocument();
        const input = screen.getByPlaceholderText('http://localhost:3002 or https://...');
        
        await user.type(input, 'http://localhost:3002');
        const continueBtn = screen.getByText('Continue');
        await user.click(continueBtn);

        // Submitting URL calls /api/node/status
        expect(global.fetch).toHaveBeenCalledWith('http://localhost:3002/api/node/status', undefined);

        // Dialog proceeds to trust decision
        expect(await screen.findByText("Do you trust this server's owner?")).toBeInTheDocument();

        // Join without trusting
        const joinNoTrustBtn = screen.getByText('Join Without Trusting');
        await user.click(joinNoTrustBtn);

        // Should record the untrusted join via POST /api/accounts/:id/servers
        expect(global.fetch).toHaveBeenCalledWith(
            'http://localhost:3001/api/accounts/account1/servers',
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('handles adding a peer server and joining & trusting', async () => {
        const user = userEvent.setup();
        render(<ServerSidebar />);

        await screen.findByText('TE');

        await user.click(screen.getByTitle('Add Peer Server'));
        await user.type(screen.getByPlaceholderText('http://localhost:3002 or https://...'), 'http://localhost:3002');
        await user.click(screen.getByText('Continue'));

        expect(await screen.findByText("Do you trust this server's owner?")).toBeInTheDocument();

        // Join & Trust
        const joinTrustBtn = screen.getByText('Join & Trust');
        await user.click(joinTrustBtn);

        expect(global.fetch).toHaveBeenCalledWith('http://localhost:3001/api/accounts/account1/trusted_servers', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ serverUrl: 'http://localhost:3002' })
        }));
        
        await waitFor(() => {
            expect(mockSetConnectedServers).toHaveBeenCalled();
        });
    });

    it('handles adding an unclaimed server and becoming owner', async () => {
        (global.fetch as any).mockImplementation((url: string, options: any) => {
            if (url.includes('/api/servers')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 's1', name: 'Test Server', icon: '' }]) });
            }
            if (url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (url.includes('/api/node/status')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ hasOwner: false }) });
            }
            if (url.includes('/api/node/claim-ownership')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
            }
            if (url.includes('/api/accounts/account1/trusted_servers')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const user = userEvent.setup();
        render(<ServerSidebar />);

        await screen.findByText('TE');

        await user.click(screen.getByTitle('Add Peer Server'));
        await user.type(screen.getByPlaceholderText('http://localhost:3002 or https://...'), 'http://localhost:3002');
        await user.click(screen.getByText('Continue'));

        expect(await screen.findByText("This server has no owner yet!")).toBeInTheDocument();

        // Become Owner
        const becomeOwnerBtn = screen.getByText('Become Owner');
        await user.click(becomeOwnerBtn);

        // Verify claim-ownership was called on the target server
        expect(global.fetch).toHaveBeenCalledWith('http://localhost:3002/api/node/claim-ownership', expect.objectContaining({
            method: 'POST'
        }));

        // Then verify trust was also established via the home server
        expect(global.fetch).toHaveBeenCalledWith('http://localhost:3001/api/accounts/account1/trusted_servers', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ serverUrl: 'http://localhost:3002' })
        }));
        
        await waitFor(() => {
            expect(mockSetConnectedServers).toHaveBeenCalled();
        });
    });

    it('clears harmony_session on logout (not harmony_account)', async () => {
        localStorage.setItem('harmony_session', JSON.stringify({ serverUrl: 'http://localhost:3001', accountId: 'account1', token: 'mock-token' }));

        const user = userEvent.setup();
        render(<ServerSidebar />);

        await screen.findByText('TE');

        const logoutBtn = screen.getByTestId('logout-btn');
        await user.click(logoutBtn);

        // harmony_session should be cleared
        expect(localStorage.getItem('harmony_session')).toBeNull();
        // Old key should never exist
        expect(localStorage.getItem('harmony_account')).toBeNull();
        expect(localStorage.getItem('harmony_trusted_servers')).toBeNull();
    });

    it('Join & Trust does NOT create stale localStorage entries', async () => {
        // No harmony_session in localStorage
        expect(localStorage.getItem('harmony_session')).toBeNull();

        const user = userEvent.setup();
        render(<ServerSidebar />);

        await screen.findByText('TE');

        await user.click(screen.getByTitle('Add Peer Server'));
        await user.type(screen.getByPlaceholderText('http://localhost:3002 or https://...'), 'http://localhost:3002');
        await user.click(screen.getByText('Continue'));

        expect(await screen.findByText("Do you trust this server's owner?")).toBeInTheDocument();

        await user.click(screen.getByText('Join & Trust'));

        await waitFor(() => {
            expect(mockSetConnectedServers).toHaveBeenCalled();
        });

        // No stale localStorage keys should exist
        expect(localStorage.getItem('harmony_account')).toBeNull();
        expect(localStorage.getItem('harmony_known_servers')).toBeNull();
        expect(localStorage.getItem('harmony_trusted_servers')).toBeNull();
    });
});
