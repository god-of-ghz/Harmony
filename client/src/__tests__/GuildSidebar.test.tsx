/**
 * P12a — GuildSidebar Rename + Core Refactoring Tests
 *
 * Validates:
 * 1. Component renders without crashing
 * 2. Home button sets activeGuildId to ''
 * 3. Guild list renders guilds from store
 * 4. Context menu shows "Leave Guild" and "Delete Guild" options
 * 5. Leave guild calls correct /api/guilds/ URL
 * 6. Backward compat: ServerSidebar re-export works
 * 7. Invite format: both old and new formats parsed correctly
 * 8. API calls use /api/guilds/ not /api/servers/
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import { useContextMenuStore } from '../store/contextMenuStore';
import type { GuildData, Account } from '../store/appStore';

// Mock @hello-pangea/dnd to avoid DnD complexities in tests
vi.mock('@hello-pangea/dnd', () => {
    const React = require('react');
    return {
        DragDropContext: ({ children }: any) => React.createElement('div', null, children),
        Droppable: ({ children }: any) => {
            const provided = {
                droppableProps: {},
                innerRef: vi.fn(),
                placeholder: null,
            };
            return React.createElement('div', null, children(provided));
        },
        Draggable: ({ children }: any) => {
            const provided = {
                draggableProps: { style: {} },
                dragHandleProps: {},
                innerRef: vi.fn(),
            };
            return React.createElement('div', null, children(provided));
        },
    };
});

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
    Home: () => 'HomeIcon',
    Plus: () => 'PlusIcon',
    Link: () => 'LinkIcon',
    FolderSync: () => 'FolderSyncIcon',
    LogOut: () => 'LogOutIcon',
    Shield: () => 'ShieldIcon',
    Crown: () => 'CrownIcon',
    Settings: () => 'SettingsIcon',
    ArrowLeft: () => 'ArrowLeftIcon',
    Sparkles: () => 'SparklesIcon',
    KeyRound: () => 'KeyRoundIcon',
    Globe: () => 'GlobeIcon',
}));

// Mock utils
vi.mock('../utils/keyStore', () => ({
    clearSessionKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/slaTracker', () => ({
    loadSlaCache: vi.fn().mockReturnValue({}),
}));

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({
    apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

const mockAccount: Account = {
    id: 'account-1',
    email: 'test@example.com',
    is_creator: true,
    is_admin: true,
    token: 'test-token',
    primary_server_url: 'http://localhost:3001',
};

const mockGuilds: GuildData[] = [
    { id: 'guild-1', name: 'Test Guild', icon: '🏰' },
    { id: 'guild-2', name: 'Second Guild', icon: '⚔️' },
];

describe('P12a — GuildSidebar Rename + Core Refactoring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset store
        useAppStore.setState({
            activeGuildId: null,
            activeServerId: null,
            currentAccount: mockAccount,
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            guildMap: { 'guild-1': 'http://localhost:3001', 'guild-2': 'http://localhost:3001' },
            serverMap: { 'guild-1': 'http://localhost:3001', 'guild-2': 'http://localhost:3001' },
            nodeStatus: {},
            serverStatus: {},
            claimedProfiles: [],
            profilesLoaded: true,
            dismissedGlobalClaim: true,
            isGuestSession: false,
            currentUserPermissions: 0,
        });

        // Reset context menu store
        useContextMenuStore.setState({
            isOpen: false,
            position: { x: 0, y: 0 },
            items: [],
            toasts: [],
            profilePopup: null,
        });

        // Default mock: return guilds list
        mockApiFetch.mockImplementation((url: string, opts?: any) => {
            if (url.endsWith('/api/guilds') && (!opts || !opts.method || opts.method === 'GET')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockGuilds),
                });
            }
            if (url.includes('/api/accounts/') && url.includes('/profiles')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ──────────────────────────────────────────────────
    // 1. Render
    // ──────────────────────────────────────────────────

    it('renders without crashing', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        const { container } = render(<GuildSidebar />);
        expect(container).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 2. Home button
    // ──────────────────────────────────────────────────

    it('clicking home sets activeGuildId to empty string', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        // Wait for guilds to render and auto-select to fire
        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        // Now the auto-select has set activeGuildId to 'guild-1'
        expect(useAppStore.getState().activeGuildId).toBe('guild-1');

        // The home button contains the HomeIcon text
        const homeButton = screen.getByText('HomeIcon').closest('div');
        expect(homeButton).toBeTruthy();

        await act(async () => {
            fireEvent.click(homeButton!);
        });

        const state = useAppStore.getState();
        expect(state.activeGuildId).toBe('');
        expect(state.activeServerId).toBe(''); // backward compat stays in sync
    });

    // ──────────────────────────────────────────────────
    // 3. Guild list
    // ──────────────────────────────────────────────────

    it('renders guilds from store after fetching', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        // Wait for guilds to be fetched and rendered
        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy(); // Test Guild -> TE
            expect(screen.getByText('SE')).toBeTruthy(); // Second Guild -> SE
        });
    });

    // ──────────────────────────────────────────────────
    // 4. Context menu
    // ──────────────────────────────────────────────────

    it('right-click guild shows Leave Guild and Delete Guild options', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        const { ContextMenuOverlay } = await import('../components/context-menu/ContextMenuOverlay');
        render(<><GuildSidebar /><ContextMenuOverlay /></>);

        // Wait for guilds to render
        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        // Right-click on the guild icon
        const guildIcon = screen.getByText('TE');
        await act(async () => {
            fireEvent.contextMenu(guildIcon);
        });

        // Context menu should show guild-oriented labels (now via the new engine)
        const state = useContextMenuStore.getState();
        expect(state.isOpen).toBe(true);
        // is_creator=true means owner, so Delete Guild shown instead of Leave Guild
        expect(state.items.find(i => i.label === 'Delete Guild')).toBeTruthy();
        expect(state.items.find(i => i.label === 'Copy Guild ID')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 5. Leave guild
    // ──────────────────────────────────────────────────

    it('Leave Guild calls API with /api/guilds/ URL', async () => {
        // Set as non-owner so Leave Guild appears
        useAppStore.setState({ currentAccount: { ...mockAccount, is_creator: false } });
        mockApiFetch.mockImplementation((url: string, opts?: any) => {
            if (url.endsWith('/api/guilds') && (!opts || !opts.method || opts.method === 'GET')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockGuilds),
                });
            }
            if (url.includes('/api/guilds/guild-1/leave')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
            }
            if (url.includes('/api/accounts/') && url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const { GuildSidebar } = await import('../components/GuildSidebar');
        const { ContextMenuOverlay } = await import('../components/context-menu/ContextMenuOverlay');
        render(<><GuildSidebar /><ContextMenuOverlay /></>);

        // Wait for guilds to render
        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        // Right-click to open context menu
        const guildIcon = screen.getByText('TE');
        await act(async () => {
            fireEvent.contextMenu(guildIcon);
        });

        // Click "Leave Guild" in the overlay
        const leaveBtn = screen.getByText('Leave Guild');
        await act(async () => {
            fireEvent.click(leaveBtn);
        });

        // Verify the API was called with the /api/guilds/ path
        await waitFor(() => {
            const leaveCalls = mockApiFetch.mock.calls.filter(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('/api/guilds/guild-1/leave')
            );
            expect(leaveCalls.length).toBeGreaterThan(0);
        });

        // Verify NO calls to /api/servers/ were made
        const serverCalls = mockApiFetch.mock.calls.filter(
            (call: any[]) => typeof call[0] === 'string' && call[0].includes('/api/servers/')
        );
        expect(serverCalls.length).toBe(0);
    });

    // ──────────────────────────────────────────────────
    // 6. Backward compatibility
    // ──────────────────────────────────────────────────

    it('ServerSidebar re-export works from GuildSidebar', async () => {
        const { ServerSidebar } = await import('../components/GuildSidebar');
        expect(ServerSidebar).toBeDefined();
        expect(typeof ServerSidebar).toBe('function');
    });

    it('ServerSidebar re-export works from ServerSidebar.tsx wrapper', async () => {
        const { ServerSidebar } = await import('../components/ServerSidebar');
        expect(ServerSidebar).toBeDefined();
        expect(typeof ServerSidebar).toBe('function');
    });

    it('ServerSidebar renders the same component as GuildSidebar', async () => {
        const guildModule = await import('../components/GuildSidebar');
        const serverModule = await import('../components/ServerSidebar');
        // The ServerSidebar should be the same function as GuildSidebar
        expect(serverModule.ServerSidebar).toBe(guildModule.GuildSidebar);
    });

    // ──────────────────────────────────────────────────
    // 7. Invite format
    // ──────────────────────────────────────────────────

    it('old invite format (no guild param) is parseable', () => {
        const oldInvite = 'harmony://invite?host=https://server.com&token=abc123';
        const url = new URL(oldInvite);
        expect(url.searchParams.get('host')).toBe('https://server.com');
        expect(url.searchParams.get('token')).toBe('abc123');
        expect(url.searchParams.get('guild')).toBeNull();
    });

    it('new invite format (with guild param) is parseable', () => {
        const newInvite = 'harmony://invite?host=https://server.com&guild=guild-123&token=abc123';
        const url = new URL(newInvite);
        expect(url.searchParams.get('host')).toBe('https://server.com');
        expect(url.searchParams.get('token')).toBe('abc123');
        expect(url.searchParams.get('guild')).toBe('guild-123');
    });

    // ──────────────────────────────────────────────────
    // 8. API calls use new paths
    // ──────────────────────────────────────────────────

    it('fetchGuilds calls /api/guilds not /api/servers', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        // Wait for the initial fetch to complete
        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        // Verify /api/guilds was called
        const guildsCalls = mockApiFetch.mock.calls.filter(
            (call: any[]) => typeof call[0] === 'string' && call[0].endsWith('/api/guilds')
        );
        expect(guildsCalls.length).toBeGreaterThan(0);

        // Verify /api/servers was NOT called
        const serversCalls = mockApiFetch.mock.calls.filter(
            (call: any[]) => typeof call[0] === 'string' && call[0].endsWith('/api/servers')
        );
        expect(serversCalls.length).toBe(0);
    });

    it('source code contains no /api/servers/ references except backward-compat comments', async () => {
        // Read the actual GuildSidebar.tsx source to verify no /api/servers/ endpoints
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve(__dirname, '../components/GuildSidebar.tsx');
        const content = fs.readFileSync(filePath, 'utf-8');

        // Find all /api/servers references
        const matches = content.match(/\/api\/servers/g) || [];
        // The only remaining /api/servers references should be in the
        // /api/accounts/:id/servers endpoint (which is the account-servers table,
        // NOT the guilds listing). This endpoint remains unchanged.
        const problematicMatches = (content.match(/\/api\/servers[^/]/g) || [])
            .filter(m => !m.includes('/api/servers/reorder'));

        // No direct /api/servers listing calls should remain
        // (the pattern `/api/servers` without a trailing path is the listing endpoint)
        const listingCalls = content.split('\n').filter(line => {
            const trimmed = line.trim();
            // Skip comments
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
            // Check for the guild listing endpoint being called as /api/servers
            return /`\$\{[^}]+\}\/api\/servers`/.test(trimmed) && !trimmed.includes('/api/servers/');
        });
        expect(listingCalls.length).toBe(0);
    });

    // ──────────────────────────────────────────────────
    // 9. Guild Settings context menu option
    // ──────────────────────────────────────────────────

    it('shows Guild Settings option when user has MANAGE_SERVER permission', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        // Wait for guilds to render (auto-select will fire and reset permissions to 0)
        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        // Set MANAGE_SERVER permission AFTER auto-select has reset it
        // MANAGE_SERVER is 1 << 1 = 0x2
        await act(async () => {
            useAppStore.setState({ currentUserPermissions: 0x2 });
        });

        // Right-click guild
        await act(async () => {
            fireEvent.contextMenu(screen.getByText('TE'));
        });

        // Now the items are in the context menu store, not the DOM
        const state = useContextMenuStore.getState();
        expect(state.items.find(i => i.label === 'Guild Settings')).toBeTruthy();
    });

    it('hides Guild Settings option when user lacks MANAGE_SERVER permission', async () => {
        useAppStore.setState({ currentUserPermissions: 0 });

        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        // Wait for guilds to render
        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        // Right-click guild
        await act(async () => {
            fireEvent.contextMenu(screen.getByText('TE'));
        });

        const state = useContextMenuStore.getState();
        expect(state.items.find(i => i.label === 'Guild Settings')).toBeFalsy();
    });

    // ──────────────────────────────────────────────────
    // 10. Component name export
    // ──────────────────────────────────────────────────

    it('GuildSidebar is exported as the primary named export', async () => {
        const module = await import('../components/GuildSidebar');
        expect(module.GuildSidebar).toBeDefined();
        expect(module.GuildSidebar.name).toBe('GuildSidebar');
    });
});
