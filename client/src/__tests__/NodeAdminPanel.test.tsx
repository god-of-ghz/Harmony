/**
 * P14 — Node Admin Panel Tests
 *
 * 14 test cases covering:
 * 1.  Panel renders when opened
 * 2.  Panel hidden for non-operators
 * 3.  Section navigation switches content
 * 4.  Overview shows guild counts and storage
 * 5.  Guild table shows all guilds with metadata
 * 6.  Suspend guild → API called → status updates
 * 7.  Resume guild → API called → status updates
 * 8.  Delete guild: type name → confirm → guild removed
 * 9.  Delete validation: wrong name → button disabled
 * 10. Provision code generation → new code appears
 * 11. Copy code → clipboard API called
 * 12. Revoke code → code removed from list
 * 13. Node settings: toggle open creation → save → API call
 * 14. Escape key closes panel
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import type { Account } from '../store/appStore';

// Mock lucide-react
vi.mock('lucide-react', () => ({
    X: () => 'XIcon',
    Home: () => 'HomeIcon',
    Plus: () => 'PlusIcon',
    FolderSync: () => 'FolderSyncIcon',
    LogOut: () => 'LogOutIcon',
    Settings: () => 'SettingsIcon',
}));

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({
    apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

const creatorAccount: Account = {
    id: 'admin-1',
    email: 'admin@harmony.local',
    is_creator: true,
    token: 'admin-token',
    primary_server_url: 'http://localhost:3001',
};

const regularAccount: Account = {
    id: 'user-1',
    email: 'user@harmony.local',
    is_creator: false,
    token: 'user-token',
    primary_server_url: 'http://localhost:3001',
};

const mockGuilds = [
    { id: 'g1', name: 'Gaming', owner_email: 'user@x.com', status: 'active', member_count: 15, storage_bytes: 134217728 },
    { id: 'g2', name: 'Study', owner_email: 'admin@y.com', status: 'suspended', member_count: 42, storage_bytes: 2254857830 },
    { id: 'g3', name: 'Test', owner_email: 'me@local', status: 'active', member_count: 3, storage_bytes: 12582912 },
];

const mockNodeStatus = {
    uptime: 309600, // 3 days 14 hours
    version: '0.5.0',
    user_count: 47,
    total_storage: 4509715456,
};

const mockProvisionCodes = [
    { code: 'a1b2c3d4e5f6', expires_at: null, max_members: 50, used: false },
    { code: 'f1e2d3c4b5a6', expires_at: null, max_members: 0, used: false },
    { code: '9876abcd1234', used: true, used_by: 'bob@x.com', guild_name: "Bob's Guild" },
];

const mockNodeSettings = {
    guild_creation_policy: 'provision_code',
    max_members_per_guild: 0,
    max_guilds: 0,
};

const setupStore = (account: Account) => {
    useAppStore.setState({
        currentAccount: account,
        connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
        guildMap: {},
        nodeStatus: {},
    });
};

const setupDefaultMocks = () => {
    mockApiFetch.mockImplementation((url: string, opts?: any) => {
        if (url.includes('/api/node/status')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockNodeStatus) });
        }
        if (url.includes('/api/node/settings') && (!opts?.method || opts.method === 'GET')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockNodeSettings) });
        }
        if (url.includes('/api/node/settings') && opts?.method === 'PUT') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
        }
        if (url.includes('/api/provision-codes') && (!opts?.method || opts.method === 'GET')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProvisionCodes) });
        }
        if (url.includes('/api/provision-codes') && opts?.method === 'POST') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 'newcode12345678' }) });
        }
        if (url.match(/\/api\/provision-codes\//) && opts?.method === 'DELETE') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
        }
        if (url.match(/\/api\/guilds\/[^/]+\/suspend/) && opts?.method === 'POST') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
        }
        if (url.match(/\/api\/guilds\/[^/]+\/resume/) && opts?.method === 'POST') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
        }
        if (url.match(/\/api\/guilds\/[^/]+$/) && opts?.method === 'DELETE') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
        }
        if (url.match(/\/api\/guilds\/[^/]+$/) && (!opts?.method || opts.method === 'GET')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'g1', name: 'Gaming', fingerprint: 'abc123' }) });
        }
        if (url.endsWith('/api/guilds')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGuilds) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
};

describe('P14 — Node Admin Panel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupStore(creatorAccount);
        setupDefaultMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ──────────────────────────────────────────────────
    // 1. Panel renders when opened
    // ──────────────────────────────────────────────────
    it('renders the admin panel with sidebar navigation', async () => {
        const { NodeAdminPanel } = await import('../components/NodeAdminPanel');
        const onClose = vi.fn();
        render(<NodeAdminPanel onClose={onClose} />);

        expect(screen.getByTestId('admin-panel')).toBeTruthy();
        expect(screen.getByText('Node Admin')).toBeTruthy();
        expect(screen.getByText('Overview')).toBeTruthy();
        expect(screen.getByText('Guild Management')).toBeTruthy();
        expect(screen.getByText('Provision Codes')).toBeTruthy();
        expect(screen.getByText('Node Settings')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 2. Panel hidden for non-operators
    // ──────────────────────────────────────────────────
    it('admin panel button is hidden for non-operator users', async () => {
        setupStore(regularAccount);
        // We need to mock the DnD and guild sidebar deps
        vi.mock('@hello-pangea/dnd', () => {
            const React = require('react');
            return {
                DragDropContext: ({ children }: any) => React.createElement('div', null, children),
                Droppable: ({ children }: any) => {
                    const provided = { droppableProps: {}, innerRef: vi.fn(), placeholder: null };
                    return React.createElement('div', null, children(provided));
                },
                Draggable: ({ children }: any) => {
                    const provided = { draggableProps: { style: {} }, dragHandleProps: {}, innerRef: vi.fn() };
                    return React.createElement('div', null, children(provided));
                },
            };
        });
        vi.mock('../utils/keyStore', () => ({ clearSessionKey: vi.fn().mockResolvedValue(undefined) }));
        vi.mock('../utils/slaTracker', () => ({ loadSlaCache: vi.fn().mockReturnValue({}) }));

        const { GuildSidebar } = await import('../components/GuildSidebar');
        render(<GuildSidebar />);

        // The admin panel button should NOT be present
        expect(screen.queryByTestId('admin-panel-btn')).toBeNull();
    });

    // ──────────────────────────────────────────────────
    // 3. Section navigation
    // ──────────────────────────────────────────────────
    it('clicking section names switches the content area', async () => {
        const { NodeAdminPanel } = await import('../components/NodeAdminPanel');
        render(<NodeAdminPanel onClose={vi.fn()} />);

        // Default is Overview
        await waitFor(() => {
            expect(screen.getByText('Node Overview')).toBeTruthy();
        });

        // Switch to Guild Management
        await act(async () => {
            fireEvent.click(screen.getByTestId('admin-nav-guilds'));
        });
        await waitFor(() => {
            // The section title "Guild Management" + the nav item both exist;
            // verify the guild table rendered to confirm the section switched.
            expect(screen.getByTestId('guild-table')).toBeTruthy();
        });

        // Switch to Provision Codes
        await act(async () => {
            fireEvent.click(screen.getByTestId('admin-nav-provisions'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('active-codes-table')).toBeTruthy();
        });

        // Switch to Node Settings
        await act(async () => {
            fireEvent.click(screen.getByTestId('admin-nav-settings'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('creation-policy')).toBeTruthy();
        });
    });

    // ──────────────────────────────────────────────────
    // 4. Overview data
    // ──────────────────────────────────────────────────
    it('overview shows correct guild count and storage', async () => {
        const { NodeOverview } = await import('../components/admin/NodeOverview');
        render(<NodeOverview onNavigate={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByTestId('overview-stats')).toBeTruthy();
        });

        // Check guild count
        expect(screen.getByText('3')).toBeTruthy(); // 3 guilds total
        // Check user count
        expect(screen.getByText('47')).toBeTruthy();
        // Storage - 4.2 GB
        expect(screen.getByText('4.2 GB')).toBeTruthy();
        // Guild breakdown
        expect(screen.getByText(/2 active/)).toBeTruthy();
        expect(screen.getByText(/1 suspended/)).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 5. Guild table
    // ──────────────────────────────────────────────────
    it('guild table shows all guilds with correct metadata', async () => {
        const { GuildManagement } = await import('../components/admin/GuildManagement');
        render(<GuildManagement />);

        await waitFor(() => {
            expect(screen.getByTestId('guild-table')).toBeTruthy();
        });

        // Check all guild names appear
        expect(screen.getByText('Gaming')).toBeTruthy();
        expect(screen.getByText('Study')).toBeTruthy();
        expect(screen.getByText('Test')).toBeTruthy();

        // Check owner emails
        expect(screen.getByText('user@x.com')).toBeTruthy();
        expect(screen.getByText('admin@y.com')).toBeTruthy();

        // Check status labels
        const activeLabels = screen.getAllByText('active');
        expect(activeLabels.length).toBe(2);
        expect(screen.getByText('suspended')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 6. Suspend guild
    // ──────────────────────────────────────────────────
    it('suspend guild calls API and updates status', async () => {
        const { GuildManagement } = await import('../components/admin/GuildManagement');
        render(<GuildManagement />);

        await waitFor(() => {
            expect(screen.getByTestId('suspend-g1')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('suspend-g1'));
        });

        // Verify API was called
        const suspendCalls = mockApiFetch.mock.calls.filter(
            (call: any[]) => typeof call[0] === 'string' && call[0].includes('/api/guilds/g1/suspend')
        );
        expect(suspendCalls.length).toBe(1);

        // Status should now show as suspended in the row
        await waitFor(() => {
            const row = screen.getByTestId('guild-row-g1');
            expect(row.textContent).toContain('suspended');
        });
    });

    // ──────────────────────────────────────────────────
    // 7. Resume guild
    // ──────────────────────────────────────────────────
    it('resume guild calls API and updates status', async () => {
        const { GuildManagement } = await import('../components/admin/GuildManagement');
        render(<GuildManagement />);

        await waitFor(() => {
            expect(screen.getByTestId('resume-g2')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('resume-g2'));
        });

        // Verify API was called
        const resumeCalls = mockApiFetch.mock.calls.filter(
            (call: any[]) => typeof call[0] === 'string' && call[0].includes('/api/guilds/g2/resume')
        );
        expect(resumeCalls.length).toBe(1);

        // Status should now show as active
        await waitFor(() => {
            const row = screen.getByTestId('guild-row-g2');
            expect(row.textContent).toContain('active');
        });
    });

    // ──────────────────────────────────────────────────
    // 8. Delete guild (full flow)
    // ──────────────────────────────────────────────────
    it('delete guild: type name, confirm, guild removed', async () => {
        const { GuildManagement } = await import('../components/admin/GuildManagement');
        render(<GuildManagement />);

        await waitFor(() => {
            expect(screen.getByTestId('delete-g1')).toBeTruthy();
        });

        // Open delete dialog
        await act(async () => {
            fireEvent.click(screen.getByTestId('delete-g1'));
        });

        expect(screen.getByTestId('delete-confirm-dialog')).toBeTruthy();
        expect(screen.getByText(/permanently delete/i)).toBeTruthy();

        // Type correct guild name
        const input = screen.getByTestId('delete-confirm-input');
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Gaming' } });
        });

        // Click delete
        const deleteBtn = screen.getByTestId('delete-confirm-btn');
        expect(deleteBtn).not.toBeDisabled();
        await act(async () => {
            fireEvent.click(deleteBtn);
        });

        // Verify API was called
        const deleteCalls = mockApiFetch.mock.calls.filter(
            (call: any[]) => typeof call[0] === 'string' && call[0].includes('/api/guilds/g1') && call[1]?.method === 'DELETE'
        );
        expect(deleteCalls.length).toBe(1);

        // Guild should be removed from table
        await waitFor(() => {
            expect(screen.queryByTestId('guild-row-g1')).toBeNull();
        });
    });

    // ──────────────────────────────────────────────────
    // 9. Delete validation
    // ──────────────────────────────────────────────────
    it('delete button stays disabled with wrong name', async () => {
        const { GuildManagement } = await import('../components/admin/GuildManagement');
        render(<GuildManagement />);

        await waitFor(() => {
            expect(screen.getByTestId('delete-g1')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('delete-g1'));
        });

        const input = screen.getByTestId('delete-confirm-input');
        const deleteBtn = screen.getByTestId('delete-confirm-btn');

        // Initially disabled
        expect(deleteBtn).toBeDisabled();

        // Type wrong name
        await act(async () => {
            fireEvent.change(input, { target: { value: 'WrongName' } });
        });
        expect(deleteBtn).toBeDisabled();

        // Cancel closes dialog
        await act(async () => {
            fireEvent.click(screen.getByTestId('delete-cancel-btn'));
        });
        expect(screen.queryByTestId('delete-confirm-dialog')).toBeNull();
    });

    // ──────────────────────────────────────────────────
    // 10. Provision code generation
    // ──────────────────────────────────────────────────
    it('generate provision code → new code appears', async () => {
        const { ProvisionCodes } = await import('../components/admin/ProvisionCodes');
        render(<ProvisionCodes />);

        await waitFor(() => {
            expect(screen.getByTestId('show-generate-btn')).toBeTruthy();
        });

        // Open form
        await act(async () => {
            fireEvent.click(screen.getByTestId('show-generate-btn'));
        });

        expect(screen.getByTestId('generate-form')).toBeTruthy();

        // Click generate
        await act(async () => {
            fireEvent.click(screen.getByTestId('generate-btn'));
        });

        // New code should appear
        await waitFor(() => {
            expect(screen.getByTestId('new-code-banner')).toBeTruthy();
            // Code appears in both the banner and the active codes table,
            // so use getAllByText and verify at least one match.
            const codeElements = screen.getAllByText('newcode12345678');
            expect(codeElements.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ──────────────────────────────────────────────────
    // 11. Copy code
    // ──────────────────────────────────────────────────
    it('copy code calls clipboard API', async () => {
        const writeTextMock = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

        const { ProvisionCodes } = await import('../components/admin/ProvisionCodes');
        render(<ProvisionCodes />);

        await waitFor(() => {
            expect(screen.getByTestId('copy-a1b2c3d4e5f6')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('copy-a1b2c3d4e5f6'));
        });

        expect(writeTextMock).toHaveBeenCalledWith('a1b2c3d4e5f6');
    });

    // ──────────────────────────────────────────────────
    // 12. Revoke code
    // ──────────────────────────────────────────────────
    it('revoke code removes it from active list', async () => {
        const { ProvisionCodes } = await import('../components/admin/ProvisionCodes');
        render(<ProvisionCodes />);

        await waitFor(() => {
            expect(screen.getByTestId('revoke-a1b2c3d4e5f6')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('revoke-a1b2c3d4e5f6'));
        });

        // Verify API was called
        const revokeCalls = mockApiFetch.mock.calls.filter(
            (call: any[]) => typeof call[0] === 'string' && call[0].includes('/api/provision-codes/a1b2c3d4e5f6') && call[1]?.method === 'DELETE'
        );
        expect(revokeCalls.length).toBe(1);

        // Code should be removed from list
        await waitFor(() => {
            expect(screen.queryByTestId('code-row-a1b2c3d4e5f6')).toBeNull();
        });
    });

    // ──────────────────────────────────────────────────
    // 13. Node settings: toggle and save
    // ──────────────────────────────────────────────────
    it('toggle open creation and save calls API', async () => {
        const { NodeSettings } = await import('../components/admin/NodeSettings');
        render(<NodeSettings />);

        await waitFor(() => {
            expect(screen.getByTestId('creation-policy')).toBeTruthy();
        });

        // Toggle to open creation
        await act(async () => {
            fireEvent.click(screen.getByTestId('policy-open'));
        });

        // Save
        await act(async () => {
            fireEvent.click(screen.getByTestId('save-settings-btn'));
        });

        // Verify API was called with open policy
        const saveCalls = mockApiFetch.mock.calls.filter(
            (call: any[]) => typeof call[0] === 'string' && call[0].includes('/api/node/settings') && call[1]?.method === 'PUT'
        );
        expect(saveCalls.length).toBe(1);
        const body = JSON.parse(saveCalls[0][1].body);
        expect(body.guild_creation_policy).toBe('open');

        // Success message
        await waitFor(() => {
            expect(screen.getByTestId('save-success')).toBeTruthy();
        });
    });

    // ──────────────────────────────────────────────────
    // 14. Escape key closes panel
    // ──────────────────────────────────────────────────
    it('escape key closes the panel', async () => {
        const { NodeAdminPanel } = await import('../components/NodeAdminPanel');
        const onClose = vi.fn();
        render(<NodeAdminPanel onClose={onClose} />);

        expect(screen.getByTestId('admin-panel')).toBeTruthy();

        await act(async () => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
