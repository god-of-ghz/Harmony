/**
 * Phase 4 — MemberSidebar Unit Tests
 *
 * Validates:
 * 1. Renders members grouped by role
 * 2. Shows online members before offline
 * 3. Right-click member opens user context menu
 * 4. Shows presence indicators correctly
 * 5. Handles empty member list gracefully
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import { useContextMenuStore } from '../store/contextMenuStore';
import type { Profile, RoleData, PresenceData } from '../store/appStore';

// Mock lucide-react
vi.mock('lucide-react', () => ({
    ChevronDown: () => 'ChevronIcon',
    PhoneCall: () => 'PhoneCallIcon',
    Search: () => 'SearchIcon',
}));

const mockProfiles: Profile[] = [
    {
        id: 'p-admin-1',
        server_id: 'guild-1',
        account_id: 'acc-1',
        original_username: 'AdminUser',
        nickname: 'Admin Alice',
        avatar: '',
        role: 'ADMIN',
        aliases: '',
        primary_role_color: '#e74c3c',
    },
    {
        id: 'p-admin-2',
        server_id: 'guild-1',
        account_id: 'acc-2',
        original_username: 'AdminUser2',
        nickname: 'Admin Bob',
        avatar: '',
        role: 'ADMIN',
        aliases: '',
        primary_role_color: '#e74c3c',
    },
    {
        id: 'p-user-1',
        server_id: 'guild-1',
        account_id: 'acc-3',
        original_username: 'RegularUser',
        nickname: 'Charlie',
        avatar: '',
        role: 'USER',
        aliases: '',
        primary_role_color: null,
    },
    {
        id: 'p-offline-1',
        server_id: 'guild-1',
        account_id: 'acc-4',
        original_username: 'OfflineUser',
        nickname: 'Dave',
        avatar: '',
        role: 'USER',
        aliases: '',
        primary_role_color: null,
    },
];

const mockRoles: RoleData[] = [
    { id: 'role-admin', server_id: 'guild-1', name: 'ADMIN', color: '#e74c3c', permissions: 0x3, position: 2 },
    { id: 'role-user', server_id: 'guild-1', name: 'USER', color: '', permissions: 0, position: 0 },
    { id: 'role-everyone', server_id: 'guild-1', name: '@everyone', color: '', permissions: 0, position: -1 },
];

const mockPresence: Record<string, PresenceData> = {
    'acc-1': { accountId: 'acc-1', status: 'online', lastUpdated: Date.now() },
    'acc-2': { accountId: 'acc-2', status: 'idle', lastUpdated: Date.now() },
    'acc-3': { accountId: 'acc-3', status: 'dnd', lastUpdated: Date.now() },
    // acc-4 is missing → offline
};

function setupStore(overrides: Partial<{
    guildProfiles: Profile[];
    guildRoles: RoleData[];
    presenceMap: Record<string, PresenceData>;
    activeServerId: string | null;
}> = {}) {
    useAppStore.setState({
        activeServerId: 'guild-1',
        activeGuildId: 'guild-1',
        serverMap: { 'guild-1': 'http://localhost:3001' },
        guildMap: { 'guild-1': 'http://localhost:3001' },
        guildProfiles: mockProfiles,
        serverProfiles: mockProfiles,
        guildRoles: mockRoles,
        serverRoles: mockRoles,
        presenceMap: mockPresence,
        currentAccount: { id: 'acc-1', email: 'a@b.com', is_creator: false, token: 'tok' },
        claimedProfiles: [{ id: 'p-admin-1', server_id: 'guild-1', account_id: 'acc-1', original_username: 'AdminUser', nickname: 'Admin Alice', avatar: '', role: 'ADMIN', aliases: '' }],
        currentUserPermissions: 0,
        relationships: [],
        ...overrides,
    });

    useContextMenuStore.setState({
        isOpen: false,
        position: { x: 0, y: 0 },
        items: [],
        toasts: [],
        profilePopup: null,
    });
}

describe('Phase 4 — MemberSidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupStore();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ──────────────────────────────────────────────────
    // 1. Renders members grouped by role
    // ──────────────────────────────────────────────────

    it('renders members grouped by role with section headers', async () => {
        const { MemberSidebar } = await import('../components/MemberSidebar');
        render(<MemberSidebar />);

        // ADMIN section should exist with 2 members
        const adminSection = screen.getByTestId('member-section-ADMIN');
        expect(adminSection).toBeTruthy();
        expect(adminSection.textContent).toContain('ADMIN');
        expect(adminSection.textContent).toContain('2');

        // Check member entries exist
        expect(screen.getByTestId('member-entry-p-admin-1')).toBeTruthy();
        expect(screen.getByTestId('member-entry-p-admin-2')).toBeTruthy();
        expect(screen.getByText('Admin Alice')).toBeTruthy();
        expect(screen.getByText('Admin Bob')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 2. Shows online members before offline
    // ──────────────────────────────────────────────────

    it('shows online members before offline members', async () => {
        const { MemberSidebar } = await import('../components/MemberSidebar');
        const { container } = render(<MemberSidebar />);

        const sectionHeaders = container.querySelectorAll('.member-sidebar-section-header');
        const headerTexts = Array.from(sectionHeaders).map(h => h.textContent || '');

        // Online role sections should come before Offline
        const offlineIdx = headerTexts.findIndex(t => t.includes('Offline'));
        expect(offlineIdx).toBeGreaterThan(0); // Not first

        // Offline section is collapsed by default, so Dave isn't rendered
        // Verify it exists as a section and has count 1
        expect(headerTexts[offlineIdx]).toContain('1');

        // Expand the Offline section and verify Dave appears
        const offlineHeader = sectionHeaders[offlineIdx];
        await act(async () => {
            fireEvent.click(offlineHeader);
        });

        expect(screen.getByText('Dave')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 3. Right-click member opens user context menu
    // ──────────────────────────────────────────────────

    it('right-click member entry opens user context menu', async () => {
        const { MemberSidebar } = await import('../components/MemberSidebar');
        render(<MemberSidebar />);

        const entry = screen.getByTestId('member-entry-p-admin-2');
        await act(async () => {
            fireEvent.contextMenu(entry);
        });

        const state = useContextMenuStore.getState();
        expect(state.isOpen).toBe(true);
        // Should contain user menu items
        expect(state.items.find(i => i.label === 'Profile')).toBeTruthy();
        expect(state.items.find(i => i.label === 'Mention')).toBeTruthy();
        expect(state.items.find(i => i.label === 'Copy User ID')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 4. Shows presence indicators correctly
    // ──────────────────────────────────────────────────

    it('shows presence indicators with correct status classes', async () => {
        const { MemberSidebar } = await import('../components/MemberSidebar');
        render(<MemberSidebar />);

        // acc-1 → online
        const presence1 = screen.getByTestId('presence-p-admin-1');
        expect(presence1.className).toContain('online');

        // acc-2 → idle
        const presence2 = screen.getByTestId('presence-p-admin-2');
        expect(presence2.className).toContain('idle');

        // acc-3 → dnd
        const presence3 = screen.getByTestId('presence-p-user-1');
        expect(presence3.className).toContain('dnd');
    });

    // ──────────────────────────────────────────────────
    // 5. Handles empty member list gracefully
    // ──────────────────────────────────────────────────

    it('handles empty member list gracefully', async () => {
        setupStore({ guildProfiles: [] });

        const { MemberSidebar } = await import('../components/MemberSidebar');
        render(<MemberSidebar />);

        expect(screen.getByText('No members')).toBeTruthy();
    });

    // ──────────────────────────────────────────────────
    // 6. Returns null when no guild is active
    // ──────────────────────────────────────────────────

    it('returns null when no guild is active', async () => {
        setupStore({ activeServerId: null });

        const { MemberSidebar } = await import('../components/MemberSidebar');
        const { container } = render(<MemberSidebar />);

        expect(container.querySelector('.member-sidebar')).toBeNull();
    });
});
