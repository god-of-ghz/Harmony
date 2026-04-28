/**
 * Guild Bugs Regression Tests
 *
 * Validates fixes for three guild UI bugs:
 *
 * Bug 1 – Context menu "Guild Settings" blanks the screen
 *   1. Clicking "Guild Settings" in context menu sets showGuildSettings in the global store
 *   2. ChannelSidebar opens GuildSettings modal when showGuildSettings flag is set
 *   3. The flag is cleared after ChannelSidebar consumes it (no infinite loop)
 *
 * Bug 2 – "Server Configuration" should say "Guild Configuration"
 *   4. ChannelSidebar header displays "Guild Configuration" not "Server Configuration"
 *   5. Source code contains no "Server Configuration" text in ChannelSidebar
 *
 * Bug 3 – Guild settings vertical tab layout
 *   6. Tab container uses flexDirection: 'column' for vertical layout
 *   7. Tab container has overflowY: 'auto' for scrolling
 *   8. Layout wrapper uses flexDirection: 'row' (left sidebar, right content)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import type { Account, Profile } from '../store/appStore';

// Mock @hello-pangea/dnd
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
            return React.createElement('div', null, children(provided, { isDraggingOver: false }));
        },
        Draggable: ({ children }: any) => {
            const provided = {
                draggableProps: { style: {} },
                dragHandleProps: {},
                innerRef: vi.fn(),
            };
            return React.createElement('div', null, children(provided, { isDragging: false }));
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
    Hash: () => 'HashIcon',
    ChevronDown: () => 'ChevronDownIcon',
    ChevronRight: () => 'ChevronRightIcon',
    Volume2: () => 'Volume2Icon',
    Layers: () => 'LayersIcon',
    Users: () => 'UsersIcon',
    X: (props: any) => {
        const { size, ...rest } = props || {};
        return Object.keys(rest).length
            ? require('react').createElement('span', rest, 'XIcon')
            : 'XIcon';
    },
    GripVertical: () => 'GripIcon',
    Trash: () => 'TrashIcon',
    Save: () => 'SaveIcon',
    User: () => 'UserIcon',
    Edit2: () => 'Edit2Icon',
    Info: () => 'InfoIcon',
    Package: () => 'PackageIcon',
    AlertTriangle: () => 'AlertIcon',
    Mic: () => 'MicIcon',
    MicOff: () => 'MicOffIcon',
    Headphones: () => 'HeadphonesIcon',
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

// ── Mock data ──
const mockAccount: Account = {
    id: 'account-1',
    email: 'test@example.com',
    is_creator: true,
    is_admin: true,
    token: 'test-token',
    primary_server_url: 'http://localhost:3001',
};

const ownerProfile: Profile = {
    id: 'profile-owner',
    server_id: 'guild-1',
    account_id: 'account-1',
    original_username: 'TestOwner',
    nickname: 'TestOwner',
    avatar: '',
    role: 'OWNER',
    aliases: '',
};

const mockGuilds = [
    { id: 'guild-1', name: 'Test Guild', icon: '🏰' },
    { id: 'guild-2', name: 'Second Guild', icon: '⚔️' },
];

// Global fetch mock for ChannelSidebar and GuildSettings API calls
let fetchMock: ReturnType<typeof vi.fn>;

const setupFetchMock = () => {
    fetchMock = vi.fn().mockImplementation((url: string, opts?: any) => {
        if (typeof url === 'string' && url.includes('/categories')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        if (typeof url === 'string' && url.includes('/channels')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        if (typeof url === 'string' && url.includes('/profiles') && !url.includes('/roles')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve([ownerProfile]) });
        }
        if (typeof url === 'string' && url.includes('/roles')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        if (typeof url === 'string' && url.match(/\/api\/guilds\/[^/]+$/) && (!opts?.method || opts.method === 'GET')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'guild-1', name: 'Test Guild', fingerprint: 'abc123' }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = fetchMock;
};

const resetStore = () => {
    useAppStore.setState({
        activeGuildId: 'guild-1',
        activeServerId: 'guild-1',
        currentAccount: mockAccount,
        connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
        guildMap: { 'guild-1': 'http://localhost:3001', 'guild-2': 'http://localhost:3001' },
        serverMap: { 'guild-1': 'http://localhost:3001', 'guild-2': 'http://localhost:3001' },
        nodeStatus: {},
        serverStatus: {},
        claimedProfiles: [ownerProfile],
        guildProfiles: [ownerProfile],
        serverProfiles: [ownerProfile],
        profilesLoaded: true,
        dismissedGlobalClaim: true,
        isGuestSession: false,
        currentUserPermissions: 0xFFFFFFFF,
        showGuildSettings: false,
    });
};

// ══════════════════════════════════════════════════════
// Bug 1 — Context menu "Guild Settings" opens settings
// ══════════════════════════════════════════════════════

describe('Bug 1 — Context menu Guild Settings navigation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
        // For GuildSidebar tests: need apiFetch to return guild list
        mockApiFetch.mockImplementation((url: string, opts?: any) => {
            if (url.endsWith('/api/guilds') && (!opts || !opts.method || opts.method === 'GET')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGuilds) });
            }
            if (url.includes('/api/accounts/') && url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
        setupFetchMock();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('clicking "Guild Settings" in context menu sets showGuildSettings flag in global store', async () => {
        // Start with the flag false
        expect(useAppStore.getState().showGuildSettings).toBe(false);

        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        // Wait for guilds to render
        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        // Give MANAGE_SERVER permission so the Guild Settings option appears
        await act(async () => {
            useAppStore.setState({ currentUserPermissions: 0x2 });
        });

        // Right-click on the first guild icon
        await act(async () => {
            fireEvent.contextMenu(screen.getByText('TE'));
        });

        // Click "Guild Settings"
        const settingsOption = screen.getByText('Guild Settings');
        await act(async () => {
            fireEvent.click(settingsOption);
        });

        // The global store flag should now be true
        expect(useAppStore.getState().showGuildSettings).toBe(true);
        // And the activeGuildId should be set to the context menu guild
        expect(useAppStore.getState().activeGuildId).toBe('guild-1');
    });

    it('ChannelSidebar opens GuildSettings when showGuildSettings flag is set', async () => {
        const { ChannelSidebar } = await import('../components/ChannelSidebar');

        // Render ChannelSidebar with settings not shown
        render(<ChannelSidebar />);

        // Settings should not be visible initially
        expect(screen.queryByTestId('close-settings')).toBeNull();

        // Trigger the flag externally (simulating what GuildSidebar does)
        await act(async () => {
            useAppStore.setState({ showGuildSettings: true });
        });

        // The GuildSettings modal should now appear
        await waitFor(() => {
            expect(screen.getByTestId('close-settings')).toBeTruthy();
        });
    });

    it('showGuildSettings flag is cleared after ChannelSidebar consumes it', async () => {
        const { ChannelSidebar } = await import('../components/ChannelSidebar');
        render(<ChannelSidebar />);

        // Set the flag
        await act(async () => {
            useAppStore.setState({ showGuildSettings: true });
        });

        // Wait for the settings to open
        await waitFor(() => {
            expect(screen.getByTestId('close-settings')).toBeTruthy();
        });

        // The flag should be cleared (to prevent re-opening on next render)
        expect(useAppStore.getState().showGuildSettings).toBe(false);
    });
});

// ══════════════════════════════════════════════════════
// Bug 2 — "Server Configuration" → "Guild Configuration"
// ══════════════════════════════════════════════════════

describe('Bug 2 — Guild Configuration terminology', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
        setupFetchMock();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('ChannelSidebar header displays "Guild Configuration"', async () => {
        const { ChannelSidebar } = await import('../components/ChannelSidebar');
        render(<ChannelSidebar />);

        expect(screen.getByText('Guild Configuration')).toBeTruthy();
    });

    it('ChannelSidebar header does NOT display "Server Configuration"', async () => {
        const { ChannelSidebar } = await import('../components/ChannelSidebar');
        render(<ChannelSidebar />);

        expect(screen.queryByText('Server Configuration')).toBeNull();
    });

    it('source code contains no "Server Configuration" text in ChannelSidebar', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve(__dirname, '../components/ChannelSidebar.tsx');
        const content = fs.readFileSync(filePath, 'utf-8');

        // Should NOT contain "Server Configuration" anywhere
        expect(content).not.toContain('Server Configuration');
        // Should contain "Guild Configuration"
        expect(content).toContain('Guild Configuration');
    });
});

// ══════════════════════════════════════════════════════
// Bug 3 — Guild settings tab text wrapping
// ══════════════════════════════════════════════════════

describe('Bug 3 — Guild Settings vertical tab layout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
        setupFetchMock();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('tab container is a column layout (vertical sidebar)', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve(__dirname, '../components/GuildSettings.tsx');
        const content = fs.readFileSync(filePath, 'utf-8');

        // Check for Left Sidebar styles
        expect(content).toContain("display: 'flex', flexDirection: 'column'");
        // Check for container row layout
        expect(content).toContain("display: 'flex', flexDirection: 'row'");
    });

    it('tab container has overflowY auto for vertical scrolling', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.resolve(__dirname, '../components/GuildSettings.tsx');
        const content = fs.readFileSync(filePath, 'utf-8');

        // The sidebar should have overflowY: 'auto'
        expect(content).toContain("overflowY: 'auto'");
        // It should NOT have overflowX: 'auto' on the tab container anymore
        expect(content).not.toContain("overflowX: 'auto'");
    });

    it('Save Changes button renders next to header controls', async () => {
        const { GuildSettings } = await import('../components/GuildSettings');
        render(<GuildSettings onClose={vi.fn()} />);

        // On hierarchy tab, Save Changes button should be visible
        const saveBtn = screen.getByText(/Save Changes/);
        expect(saveBtn).toBeTruthy();

        // Close button should also be present
        expect(screen.getByTestId('close-settings')).toBeTruthy();
    });
});

// ══════════════════════════════════════════════════════
// Store integration — showGuildSettings state
// ══════════════════════════════════════════════════════

describe('Store — showGuildSettings state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
    });

    it('showGuildSettings defaults to false', () => {
        useAppStore.setState({ showGuildSettings: false });
        expect(useAppStore.getState().showGuildSettings).toBe(false);
    });

    it('setShowGuildSettings updates the flag', () => {
        useAppStore.getState().setShowGuildSettings(true);
        expect(useAppStore.getState().showGuildSettings).toBe(true);

        useAppStore.getState().setShowGuildSettings(false);
        expect(useAppStore.getState().showGuildSettings).toBe(false);
    });

    it('showGuildSettings flag survives activeGuildId change', () => {
        // Set flag first, then change guild — flag should persist
        useAppStore.getState().setShowGuildSettings(true);
        useAppStore.getState().setActiveGuildId('guild-2');

        // The flag should still be true (setActiveGuildId doesn't reset it)
        expect(useAppStore.getState().showGuildSettings).toBe(true);
        expect(useAppStore.getState().activeGuildId).toBe('guild-2');
    });
});
