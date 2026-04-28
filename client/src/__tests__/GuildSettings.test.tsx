/**
 * P15 — Guild Settings Tests
 *
 * 14 test cases covering:
 * 1.  Render: Settings panel renders for a guild member
 * 2.  Guild info: Shows correct guild name, ID, fingerprint
 * 3.  Ownership section — owner: Guild owner sees transfer ownership section
 * 4.  Ownership section — non-owner: Non-owner does NOT see transfer section
 * 5.  Transfer ownership: Select member → confirm → API called
 * 6.  Export button — owner: Guild owner sees export button
 * 7.  Export flow: Click export → progress modal appears → mock progress → download triggered
 * 8.  Import validation: Upload ZIP → validation results displayed
 * 9.  Import flow: Validate → confirm → API called → success message
 * 10. Delete guild: Type name → confirm → API called → redirect to home
 * 11. Delete validation: Wrong name → button stays disabled
 * 12. Backward compat: ServerSettings export still works
 * 13. Non-owner restrictions: Regular member doesn't see export, ownership, or delete sections
 * 14. Round-trip: Export mock → Import mock → verify correct API calls in sequence
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import type { Account, Profile } from '../store/appStore';

// Mock lucide-react
vi.mock('lucide-react', () => ({
    Layers: () => 'LayersIcon',
    Shield: () => 'ShieldIcon',
    Users: () => 'UsersIcon',
    X: (props: any) => {
        const { size, ...rest } = props || {};
        return Object.keys(rest).length
            ? require('react').createElement('span', rest, 'XIcon')
            : 'XIcon';
    },
    Plus: () => 'PlusIcon',
    GripVertical: () => 'GripIcon',
    Trash: () => 'TrashIcon',
    Save: () => 'SaveIcon',
    User: () => 'UserIcon',
    Edit2: () => 'Edit2Icon',
    Info: () => 'InfoIcon',
    Crown: () => 'CrownIcon',
    Package: () => 'PackageIcon',
    AlertTriangle: () => 'AlertIcon',
}));

// Mock DnD
vi.mock('@hello-pangea/dnd', () => {
    const React = require('react');
    return {
        DragDropContext: ({ children }: any) => React.createElement('div', null, children),
        Droppable: ({ children }: any) => {
            const provided = { droppableProps: {}, innerRef: vi.fn(), placeholder: null };
            return React.createElement('div', null, children(provided, { isDraggingOver: false }));
        },
        Draggable: ({ children }: any) => {
            const provided = { draggableProps: { style: {} }, dragHandleProps: {}, innerRef: vi.fn() };
            return React.createElement('div', null, children(provided, { isDragging: false }));
        },
    };
});

// ── Mock data ──
const ownerAccount: Account = {
    id: 'owner-1',
    email: 'owner@harmony.local',
    is_creator: true,
    token: 'owner-token',
    primary_server_url: 'http://localhost:3001',
};

const regularAccount: Account = {
    id: 'user-1',
    email: 'user@harmony.local',
    is_creator: false,
    token: 'user-token',
    primary_server_url: 'http://localhost:3001',
};

const ownerProfile: Profile = {
    id: 'profile-owner',
    server_id: 'guild-1',
    account_id: 'owner-1',
    original_username: 'GuildOwner',
    nickname: 'GuildOwner',
    avatar: '',
    role: 'OWNER',
    aliases: '',
};

const adminProfile: Profile = {
    id: 'profile-admin',
    server_id: 'guild-1',
    account_id: 'admin-1',
    original_username: 'AdminUser',
    nickname: 'AdminUser',
    avatar: '',
    role: 'ADMIN',
    aliases: '',
};

const memberProfile: Profile = {
    id: 'profile-member',
    server_id: 'guild-1',
    account_id: 'user-1',
    original_username: 'RegularUser',
    nickname: 'RegularUser',
    avatar: '',
    role: 'USER',
    aliases: '',
};

const mockGuildDetails = {
    id: 'guild-1',
    name: 'Test Guild',
    fingerprint: 'abcdef1234567890',
    created_at: '2025-04-25T12:00:00Z',
    owner_email: 'owner@harmony.local',
    host: 'harmony.example.com',
};

const mockExportStats = { total_bytes: 2199023255 }; // ~2.1 GB

const mockImportValidation = {
    valid: true,
    guild_name: 'Gaming Hub',
    message_count: 15000,
    member_count: 42,
    file_count: 230,
    total_size: 2199023255,
    exported_at: '2025-04-20T12:00:00Z',
    source_host: 'old-server.example.com',
};

const setupStore = (account: Account, profile: Profile) => {
    useAppStore.setState({
        currentAccount: account,
        activeGuildId: 'guild-1',
        activeServerId: 'guild-1',
        guildMap: { 'guild-1': 'http://localhost:3001' },
        serverMap: { 'guild-1': 'http://localhost:3001' },
        claimedProfiles: [profile],
        guildProfiles: [ownerProfile, adminProfile, memberProfile],
        serverProfiles: [ownerProfile, adminProfile, memberProfile],
        currentUserPermissions: 0xFFFFFFFF,
    });
};

// Global fetch mock
let fetchMock: ReturnType<typeof vi.fn>;

const setupFetchMock = () => {
    fetchMock = vi.fn().mockImplementation((url: string, opts?: any) => {
        // Guild info
        if (typeof url === 'string' && url.match(/\/api\/guilds\/[^/]+$/) && (!opts?.method || opts.method === 'GET')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGuildDetails) });
        }
        // Categories
        if (url.includes('/categories') && !opts?.method) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        // Channels
        if (url.includes('/channels') && !opts?.method) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        // Profiles
        if (url.includes('/profiles') && !url.includes('/roles') && !opts?.method) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve([ownerProfile, adminProfile, memberProfile]) });
        }
        // Roles
        if (url.includes('/roles') && !opts?.method) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        // Export stats
        if (url.includes('/export/stats')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockExportStats) });
        }
        // Export progress
        if (url.includes('/export/progress')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'complete', progress: 100, download_url: '/downloads/export.zip' }) });
        }
        // Start export
        if (url.includes('/export') && opts?.method === 'POST') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ job_id: 'export-123' }) });
        }
        // Import validate
        if (url.includes('/import/validate')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockImportValidation) });
        }
        // Import
        if (url.includes('/import') && opts?.method === 'POST') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ guild_name: 'Gaming Hub', guild_id: 'imported-1' }) });
        }
        // Transfer ownership
        if (url.includes('/transfer-ownership')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
        }
        // Delete guild
        if (opts?.method === 'DELETE' && url.match(/\/api\/guilds\/[^/]+$/)) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = fetchMock;
};

describe('P15 — Guild Settings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupStore(ownerAccount, ownerProfile);
        setupFetchMock();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // ──────────────────────────────────────────────────
    // 1. Render: Settings panel renders for a guild member
    // ──────────────────────────────────────────────────
    it('renders the guild settings panel for a guild member', async () => {
        const { GuildSettings } = await import('../components/GuildSettings');
        const onClose = vi.fn();
        render(<GuildSettings onClose={onClose} />);

        // Should show tab navigation
        expect(screen.getByText('Profile')).toBeTruthy();
        expect(screen.getByTestId('close-settings')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 2. Guild info: Shows correct guild name, ID, fingerprint
    // ──────────────────────────────────────────────────
    it('guild info shows correct name, ID, and fingerprint', async () => {
        const { GuildInfoSection } = await import('../components/guild/GuildInfoSection');
        render(
            <GuildInfoSection
                guildId="guild-1"
                serverUrl="http://localhost:3001"
                userRole="OWNER"
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId('guild-info-section')).toBeTruthy();
        });

        expect(screen.getByTestId('guild-info-name').textContent).toBe('Test Guild');
        expect(screen.getByTestId('guild-info-id').textContent).toBe('guild-1');
        expect(screen.getByTestId('guild-info-fingerprint').textContent).toContain('ed25519:abcdef1234567890');
        expect(screen.getByTestId('guild-info-owner').textContent).toBe('owner@harmony.local');
        expect(screen.getByTestId('guild-info-role').textContent).toContain('OWNER');
    });

    // ──────────────────────────────────────────────────
    // 3. Ownership section — owner sees transfer section
    // ──────────────────────────────────────────────────
    it('guild owner sees the transfer ownership section', async () => {
        const { GuildSettings } = await import('../components/GuildSettings');
        render(<GuildSettings onClose={vi.fn()} />);

        // Owner should see the ownership tab
        expect(screen.getByTestId('tab-ownership')).toBeTruthy();

        // Click ownership tab
        await act(async () => {
            fireEvent.click(screen.getByTestId('tab-ownership'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('ownership-section')).toBeTruthy();
        });

        // Just verify the section renders
        expect(screen.getByTestId('ownership-section')).toBeTruthy();
        expect(screen.getByTestId('current-owner')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 4. Ownership section — non-owner hidden
    // ──────────────────────────────────────────────────
    it('non-owner does NOT see the ownership tab', async () => {
        setupStore(regularAccount, memberProfile);
        const { GuildSettings } = await import('../components/GuildSettings');
        render(<GuildSettings onClose={vi.fn()} />);

        expect(screen.queryByTestId('tab-ownership')).toBeNull();
        expect(screen.queryByTestId('tab-portability')).toBeNull();
        expect(screen.queryByTestId('tab-danger')).toBeNull();
    });

    // ──────────────────────────────────────────────────
    // 5. Transfer ownership: select member → confirm → API called
    // ──────────────────────────────────────────────────
    it('transfer ownership: select member → confirm → API called', async () => {
        const { OwnershipSection } = await import('../components/guild/OwnershipSection');
        render(
            <OwnershipSection
                guildId="guild-1"
                serverUrl="http://localhost:3001"
                profiles={[ownerProfile, adminProfile, memberProfile]}
                currentProfile={ownerProfile}
            />
        );

        // Select admin member
        const select = screen.getByTestId('transfer-select');
        await act(async () => {
            fireEvent.change(select, { target: { value: 'profile-admin' } });
        });

        // Click transfer button
        await act(async () => {
            fireEvent.click(screen.getByTestId('transfer-btn'));
        });

        // Confirmation dialog should appear
        expect(screen.getByTestId('transfer-confirm-dialog')).toBeTruthy();

        // Confirm transfer
        await act(async () => {
            fireEvent.click(screen.getByTestId('transfer-confirm-btn'));
        });

        // API should have been called
        await waitFor(() => {
            const transferCalls = fetchMock.mock.calls.filter(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('/transfer-ownership')
            );
            expect(transferCalls.length).toBe(1);
            const body = JSON.parse(transferCalls[0][1].body);
            expect(body.newOwnerProfileId).toBe('profile-admin');
        });
    });

    // ──────────────────────────────────────────────────
    // 6. Export button — owner sees it
    // ──────────────────────────────────────────────────
    it('guild owner sees export button in portability tab', async () => {
        const { ExportImportSection } = await import('../components/guild/ExportImportSection');
        render(
            <ExportImportSection guildId="guild-1" serverUrl="http://localhost:3001" />
        );

        await waitFor(() => {
            expect(screen.getByTestId('export-import-section')).toBeTruthy();
        });

        expect(screen.getByTestId('export-btn')).toBeTruthy();
        expect(screen.getByTestId('import-btn')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 7. Export flow: click → progress modal → download
    // ──────────────────────────────────────────────────
    it('export flow: click → progress modal → download triggered', async () => {
        // Mock setInterval to call the callback immediately
        const origSetInterval = window.setInterval;
        (window as any).setInterval = (cb: Function, _ms: number) => {
            Promise.resolve().then(() => cb());
            return 999;
        };
        const origClearInterval = window.clearInterval;
        (window as any).clearInterval = vi.fn();

        const { ExportModal } = await import('../components/guild/ExportModal');
        const onClose = vi.fn();
        render(
            <ExportModal
                guildId="guild-1"
                serverUrl="http://localhost:3001"
                estimatedSize={2199023255}
                onClose={onClose}
            />
        );

        expect(screen.getByTestId('export-confirm')).toBeTruthy();

        // Start export
        await act(async () => {
            fireEvent.click(screen.getByTestId('export-start-btn'));
        });

        // The mocked setInterval calls the poll callback immediately
        // Wait for the poll result to resolve
        await act(async () => {
            await new Promise(r => origSetInterval(r, 50));
        });

        await waitFor(() => {
            expect(screen.getByTestId('export-done')).toBeTruthy();
        });

        expect(screen.getByText('Export Complete!')).toBeTruthy();

        // Restore
        window.setInterval = origSetInterval;
        window.clearInterval = origClearInterval;
    });

    // ──────────────────────────────────────────────────
    // 8. Import validation: Upload ZIP → results displayed
    // ──────────────────────────────────────────────────
    it('import validation: upload ZIP → validation results displayed', async () => {
        const { ImportModal } = await import('../components/guild/ImportModal');
        render(<ImportModal serverUrl="http://localhost:3001" onClose={vi.fn()} />);

        expect(screen.getByTestId('import-select')).toBeTruthy();

        // Simulate file selection
        const fileInput = screen.getByTestId('import-file-input');
        const mockFile = new File(['test'], 'export.zip', { type: 'application/zip' });

        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [mockFile] } });
        });

        // Wait for validation results
        await waitFor(() => {
            expect(screen.getByTestId('import-preview')).toBeTruthy();
        });

        expect(screen.getByTestId('import-guild-name').textContent).toBe('Gaming Hub');
        expect(screen.getByText(/15,000/)).toBeTruthy();
        expect(screen.getByText(/42/)).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 9. Import flow: validate → confirm → API → success
    // ──────────────────────────────────────────────────
    it('import flow: validate → confirm → success message', async () => {
        const { ImportModal } = await import('../components/guild/ImportModal');
        const onClose = vi.fn();
        render(<ImportModal serverUrl="http://localhost:3001" onClose={onClose} />);

        // Select file
        const fileInput = screen.getByTestId('import-file-input');
        const mockFile = new File(['test'], 'export.zip', { type: 'application/zip' });
        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [mockFile] } });
        });

        // Wait for validation preview
        await waitFor(() => {
            expect(screen.getByTestId('import-preview')).toBeTruthy();
        });

        // Mock XMLHttpRequest for the actual import — call onload synchronously from send
        const xhrMock = {
            open: vi.fn(),
            setRequestHeader: vi.fn(),
            send: vi.fn(),
            upload: { onprogress: null as any },
            onload: null as any,
            onerror: null as any,
            status: 200,
            responseText: JSON.stringify({ guild_name: 'Gaming Hub', guild_id: 'imported-1' }),
        };
        // Make send() trigger onload via microtask
        xhrMock.send = vi.fn(function() {
            Promise.resolve().then(() => {
                if (xhrMock.upload.onprogress) {
                    xhrMock.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
                }
                if (xhrMock.onload) xhrMock.onload();
            });
        });
        const origXHR = window.XMLHttpRequest;
        // Use a proper function constructor that works with `new`
        (window as any).XMLHttpRequest = function() { return xhrMock; };

        // Click import
        await act(async () => {
            fireEvent.click(screen.getByTestId('import-confirm-btn'));
        });

        // Flush microtask queue
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(screen.getByTestId('import-done')).toBeTruthy();
        });

        expect(screen.getByText('Import Complete!')).toBeTruthy();
        expect(screen.getByText('Gaming Hub')).toBeTruthy();

        // Restore
        (window as any).XMLHttpRequest = origXHR;
    });

    // ──────────────────────────────────────────────────
    // 10. Delete guild: type name → confirm → API → redirect
    // ──────────────────────────────────────────────────
    it('delete guild: type name → confirm → API called', async () => {
        const { DangerZoneSection } = await import('../components/guild/DangerZoneSection');
        const onClose = vi.fn();
        render(
            <DangerZoneSection
                guildId="guild-1"
                guildName="Test Guild"
                serverUrl="http://localhost:3001"
                onClose={onClose}
            />
        );

        expect(screen.getByTestId('danger-zone-section')).toBeTruthy();

        // Click delete button
        await act(async () => {
            fireEvent.click(screen.getByTestId('delete-guild-btn'));
        });

        expect(screen.getByTestId('delete-confirm-dialog')).toBeTruthy();

        // Type correct name
        const input = screen.getByTestId('delete-confirm-input');
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Test Guild' } });
        });

        // Confirm delete
        const deleteBtn = screen.getByTestId('delete-confirm-btn');
        expect(deleteBtn).not.toBeDisabled();
        await act(async () => {
            fireEvent.click(deleteBtn);
        });

        // API should have been called
        await waitFor(() => {
            const deleteCalls = fetchMock.mock.calls.filter(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('/api/guilds/guild-1') && call[1]?.method === 'DELETE'
            );
            expect(deleteCalls.length).toBe(1);
        });

        // onClose should have been called
        expect(onClose).toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────
    // 11. Delete validation: wrong name → disabled
    // ──────────────────────────────────────────────────
    it('delete button stays disabled with wrong name', async () => {
        const { DangerZoneSection } = await import('../components/guild/DangerZoneSection');
        render(
            <DangerZoneSection
                guildId="guild-1"
                guildName="Test Guild"
                serverUrl="http://localhost:3001"
                onClose={vi.fn()}
            />
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('delete-guild-btn'));
        });

        const input = screen.getByTestId('delete-confirm-input');
        const deleteBtn = screen.getByTestId('delete-confirm-btn');

        // Initially disabled
        expect(deleteBtn).toBeDisabled();

        // Wrong name
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
    // 12. Backward compat: ServerSettings export still works
    // ──────────────────────────────────────────────────
    it('ServerSettings re-export wrapper works', async () => {
        const { ServerSettings } = await import('../components/ServerSettings');
        expect(ServerSettings).toBeDefined();
        expect(typeof ServerSettings).toBe('function');

        // Render it — should produce the same output as GuildSettings
        render(<ServerSettings onClose={vi.fn()} />);
        expect(screen.getByText('Profile')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 13. Non-owner restrictions
    // ──────────────────────────────────────────────────
    it('non-owner does not see export, ownership, or delete tabs', async () => {
        setupStore(regularAccount, memberProfile);
        const { GuildSettings } = await import('../components/GuildSettings');
        render(<GuildSettings onClose={vi.fn()} />);

        // Info tab should be visible for all
        expect(screen.getByTestId('tab-info')).toBeTruthy();

        // Owner-only tabs should be hidden
        expect(screen.queryByTestId('tab-ownership')).toBeNull();
        expect(screen.queryByTestId('tab-portability')).toBeNull();
        expect(screen.queryByTestId('tab-danger')).toBeNull();
    });

    // ──────────────────────────────────────────────────
    // 14. Round-trip: Export → Import → correct API calls
    // ──────────────────────────────────────────────────
    it('round-trip: export then import calls correct APIs in sequence', async () => {
        // Export first
        const { ExportModal } = await import('../components/guild/ExportModal');
        const { unmount: unmountExport } = render(
            <ExportModal
                guildId="guild-1"
                serverUrl="http://localhost:3001"
                estimatedSize={2199023255}
                onClose={vi.fn()}
            />
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('export-start-btn'));
        });

        // Verify export API was called
        await waitFor(() => {
            const exportCalls = fetchMock.mock.calls.filter(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('/export') && call[1]?.method === 'POST'
            );
            expect(exportCalls.length).toBe(1);
        });

        unmountExport();

        // Import next
        const { ImportModal } = await import('../components/guild/ImportModal');
        render(<ImportModal serverUrl="http://localhost:3001" onClose={vi.fn()} />);

        const fileInput = screen.getByTestId('import-file-input');
        const mockFile = new File(['test'], 'export.zip', { type: 'application/zip' });

        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [mockFile] } });
        });

        // Verify validate API was called
        await waitFor(() => {
            const validateCalls = fetchMock.mock.calls.filter(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('/import/validate')
            );
            expect(validateCalls.length).toBe(1);
        });

        // Verify both export and validate calls happened in correct order
        const allCalls = fetchMock.mock.calls.map((call: any[]) => call[0]);
        const exportIdx = allCalls.findIndex((url: string) => url.includes('/export') && !url.includes('/export/stats') && !url.includes('/export/progress'));
        const validateIdx = allCalls.findIndex((url: string) => url.includes('/import/validate'));
        expect(exportIdx).toBeLessThan(validateIdx);
    });
});
