/**
 * P12b — Unified "Create or Join Guild" Modal Tests
 *
 * Validates:
 * 1. "+" button opens the unified Create/Join modal
 * 2. Modal shows "Create" and "Join" card options
 * 3. Join flow: Click "Join" card → shows URL/invite input form
 * 4. Create flow — operator: sees "Continue to Setup" directly
 * 5. Create flow — provision code: regular user sees code input → validates → can proceed
 * 6. Create flow — invalid code: error message shown
 * 7. Back navigation: from sub-flow → returns to card selection
 * 8. Cancel: clicking Cancel → modal closes
 * 9. Keyboard: Escape closes modal
 * 10. Callback fired: "Continue to Setup" invokes the setup callback
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import type { Account } from '../store/appStore';

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
    Users: () => 'UsersIcon',
    Lock: () => 'LockIcon',
    Unlock: () => 'UnlockIcon',
    Server: () => 'ServerIcon',
    Search: () => 'SearchIcon',
    // Wizard sub-component icons (P13)
    Camera: () => 'CameraIcon',
    Hash: () => '#',
    Volume2: () => '🔊',
    X: () => '✕',
    LayoutTemplate: () => 'TemplateIcon',
    User: () => 'UserIcon',
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

const mockOperatorAccount: Account = {
    id: 'account-1',
    email: 'operator@example.com',
    is_creator: true,
    is_admin: true,
    token: 'test-token',
    primary_server_url: 'http://localhost:3001',
};

const mockRegularAccount: Account = {
    id: 'account-2',
    email: 'user@example.com',
    is_creator: false,
    is_admin: false,
    token: 'test-token-2',
    primary_server_url: 'http://localhost:3001',
};

const mockGuilds = [
    { id: 'guild-1', name: 'Test Guild', icon: '🏰' },
];

describe('P12b — Unified Create/Join Guild Modal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({
            activeGuildId: null,
            activeServerId: null,
            currentAccount: mockOperatorAccount,
            connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
            guildMap: { 'guild-1': 'http://localhost:3001' },
            serverMap: { 'guild-1': 'http://localhost:3001' },
            nodeStatus: {},
            serverStatus: {},
            claimedProfiles: [],
            profilesLoaded: true,
            dismissedGlobalClaim: true,
            isGuestSession: false,
            currentUserPermissions: 0,
        });

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
            // CreateGuildFlow checks node operator status on each connected server
            if (url.includes('/api/accounts/') && url.includes('/state')) {
                const currentAccount = useAppStore.getState().currentAccount;
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ is_creator: !!currentAccount?.is_creator, servers: [], dismissed_global_claim: false, authority_role: 'primary', primary_server_url: null }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ──────────────────────────────────────────────────
    // 1. "+" button opens unified modal
    // ──────────────────────────────────────────────────

    it('clicking "+" button opens the unified Create/Join modal', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        const plusBtn = screen.getByTestId('create-join-btn');
        await act(async () => {
            fireEvent.click(plusBtn);
        });

        expect(screen.getByText('Create or Join a Guild')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 2. Modal shows Create and Join cards
    // ──────────────────────────────────────────────────

    it('modal shows Create and Join card options', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-btn'));
        });

        expect(screen.getByTestId('create-guild-card')).toBeTruthy();
        expect(screen.getByTestId('join-guild-card')).toBeTruthy();
        // Card labels
        expect(screen.getByText('Create')).toBeTruthy();
        expect(screen.getByText('Join')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 3. Join flow: Click "Join" card → shows URL input
    // ──────────────────────────────────────────────────

    it('clicking Join card shows URL input form', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-btn'));
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('join-guild-card'));
        });

        // Should show the join flow with URL input
        expect(screen.getByText('Join a Guild')).toBeTruthy();
        expect(screen.getByLabelText('Node URL or invite link')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 4. Create flow — operator: sees "Continue to Setup" directly
    // ──────────────────────────────────────────────────

    it('node operator clicking Create sees Continue to Setup directly', async () => {
        // Ensure account is operator
        useAppStore.setState({ currentAccount: mockOperatorAccount });

        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-btn'));
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('create-guild-card'));
        });

        expect(screen.getByText('Create a Guild')).toBeTruthy();
        // Wait for async node operator check to resolve
        await waitFor(() => {
            expect(screen.getAllByText(/node operator/i).length).toBeGreaterThan(0);
        });
        await waitFor(() => {
            expect(screen.getByTestId('continue-setup-btn')).toBeTruthy();
        });
    });

    // ──────────────────────────────────────────────────
    // 5. Create flow — provision code: regular user sees code input
    // ──────────────────────────────────────────────────

    it('regular user clicking Create sees provision code input', async () => {
        useAppStore.setState({ currentAccount: mockRegularAccount });

        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-btn'));
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('create-guild-card'));
        });

        expect(screen.getByText('Create a Guild')).toBeTruthy();
        // Wait for async node operator check to resolve (user is not operator → shows provision code)
        await waitFor(() => {
            expect(screen.getByLabelText('Provision code')).toBeTruthy();
        });
        expect(screen.getByText('Validate')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 6. Create flow — invalid code: error message shown
    // ──────────────────────────────────────────────────

    it('invalid provision code shows error message', async () => {
        useAppStore.setState({ currentAccount: mockRegularAccount });

        // Mock the validate endpoint to return failure
        mockApiFetch.mockImplementation((url: string, opts?: any) => {
            if (url.endsWith('/api/guilds') && (!opts || !opts.method || opts.method === 'GET')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockGuilds),
                });
            }
            if (url.includes('/api/accounts/') && url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (url.includes('/api/provision-codes/validate')) {
                return Promise.resolve({
                    ok: false,
                    json: () => Promise.resolve({ error: 'Invalid or expired provision code' }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        // Open modal → Create flow
        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-btn'));
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('create-guild-card'));
        });

        // Enter bad code and submit
        const codeInput = screen.getByLabelText('Provision code');
        await act(async () => {
            fireEvent.change(codeInput, { target: { value: 'BAD-CODE' } });
        });

        const validateBtn = screen.getByText('Validate');
        await act(async () => {
            fireEvent.click(validateBtn);
        });

        await waitFor(() => {
            expect(screen.getByText('Invalid or expired provision code')).toBeTruthy();
        });
    });

    // ──────────────────────────────────────────────────
    // 7. Back navigation: from sub-flow → returns to card selection
    // ──────────────────────────────────────────────────

    it('back button from Join flow returns to card selection', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        // Open modal → Join
        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-btn'));
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('join-guild-card'));
        });

        expect(screen.getByText('Join a Guild')).toBeTruthy();

        // Click back
        const backBtn = screen.getByLabelText('Back to guild options');
        await act(async () => {
            fireEvent.click(backBtn);
        });

        // Should be back at the choice view
        expect(screen.getByText('Create or Join a Guild')).toBeTruthy();
    });

    it('back button from Create flow returns to card selection', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-btn'));
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('create-guild-card'));
        });

        expect(screen.getByText('Create a Guild')).toBeTruthy();

        // Click back
        const backBtn = screen.getByLabelText('Back to guild options');
        await act(async () => {
            fireEvent.click(backBtn);
        });

        expect(screen.getByText('Create or Join a Guild')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 8. Cancel: clicking Cancel → modal closes
    // ──────────────────────────────────────────────────

    it('clicking Cancel closes the modal', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-btn'));
        });

        expect(screen.getByText('Create or Join a Guild')).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-cancel'));
        });

        expect(screen.queryByText('Create or Join a Guild')).toBeNull();
    });

    // ──────────────────────────────────────────────────
    // 9. Keyboard: Escape closes modal
    // ──────────────────────────────────────────────────

    it('pressing Escape closes the modal', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-btn'));
        });

        expect(screen.getByText('Create or Join a Guild')).toBeTruthy();

        await act(async () => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });

        expect(screen.queryByText('Create or Join a Guild')).toBeNull();
    });

    // ──────────────────────────────────────────────────
    // 10. Callback fired with provision code on "Continue to Setup"
    // ──────────────────────────────────────────────────

    it('operator Continue to Setup opens the Guild Setup Wizard', async () => {
        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-btn'));
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('create-guild-card'));
        });

        // Wait for async node operator check to resolve
        await waitFor(() => {
            expect(screen.getByTestId('continue-setup-btn')).toBeTruthy();
        });

        const continueBtn = screen.getByTestId('continue-setup-btn');
        await act(async () => {
            fireEvent.click(continueBtn);
        });

        // The Create/Join modal should close
        expect(screen.queryByText('Create or Join a Guild')).toBeNull();

        // The Guild Setup Wizard should now be open
        expect(screen.getByTestId('guild-setup-wizard')).toBeTruthy();
    });

    it('regular user Continue to Setup opens wizard after provision code validation', async () => {
        useAppStore.setState({ currentAccount: mockRegularAccount });

        // Mock valid provision code
        mockApiFetch.mockImplementation((url: string, opts?: any) => {
            if (url.endsWith('/api/guilds') && (!opts || !opts.method || opts.method === 'GET')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockGuilds),
                });
            }
            if (url.includes('/api/accounts/') && url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (url.includes('/api/provision-codes/validate')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ valid: true }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        await waitFor(() => {
            expect(screen.getByText('TE')).toBeTruthy();
        });

        // Open modal → Create flow
        await act(async () => {
            fireEvent.click(screen.getByTestId('create-join-btn'));
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('create-guild-card'));
        });

        // Enter valid provision code
        const codeInput = screen.getByLabelText('Provision code');
        await act(async () => {
            fireEvent.change(codeInput, { target: { value: 'VALID-CODE-123' } });
        });

        // Validate the code
        const validateBtn = screen.getByText('Validate');
        await act(async () => {
            fireEvent.click(validateBtn);
        });

        // Wait for validation success
        await waitFor(() => {
            expect(screen.getByText('Provision code validated successfully!')).toBeTruthy();
        });

        // Now click Continue to Setup
        const continueBtn = screen.getByTestId('continue-setup-btn');
        await act(async () => {
            fireEvent.click(continueBtn);
        });

        // The Guild Setup Wizard should now be open
        expect(screen.getByTestId('guild-setup-wizard')).toBeTruthy();
    });
});
