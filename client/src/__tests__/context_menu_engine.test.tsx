/**
 * Context Menu Engine Tests
 *
 * Validates:
 * 1. contextMenuStore: open/close state, toast add/auto-remove
 * 2. ContextMenuOverlay: renders items, handles click, closes on backdrop click, closes on Escape
 * 3. ContextMenuItem: renders label, icon, separator, danger styling, disabled state
 * 4. buildGuildMenu: returns correct items for admin vs non-admin, owner vs non-owner
 * 5. contextActions.copyToClipboard: calls navigator.clipboard.writeText
 * 6. GuildSidebar regression: right-click still shows context menu (through the new system)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useContextMenuStore } from '../store/contextMenuStore';
import { useAppStore } from '../store/appStore';
import type { Account } from '../store/appStore';

// Mock @hello-pangea/dnd
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

// Mock lucide-react
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

const mockGuilds = [
    { id: 'guild-1', name: 'Test Guild', icon: '🏰' },
    { id: 'guild-2', name: 'Second Guild', icon: '⚔️' },
];

describe('Context Menu Engine', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset context menu store
        useContextMenuStore.setState({
            isOpen: false,
            position: { x: 0, y: 0 },
            items: [],
            toasts: [],
            profilePopup: null,
        });

        // Reset app store
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

        mockApiFetch.mockImplementation((url: string, opts?: any) => {
            if (url.endsWith('/api/guilds') && (!opts || !opts.method || opts.method === 'GET')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGuilds) });
            }
            if (url.includes('/api/accounts/') && url.includes('/profiles')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ──────────────────────────────────────────────────
    // 1. contextMenuStore
    // ──────────────────────────────────────────────────

    describe('contextMenuStore', () => {
        it('opens context menu with position and items', () => {
            const items = [{ id: 'test', label: 'Test Item' }];
            useContextMenuStore.getState().openContextMenu({ x: 100, y: 200 }, items);

            const state = useContextMenuStore.getState();
            expect(state.isOpen).toBe(true);
            expect(state.position).toEqual({ x: 100, y: 200 });
            expect(state.items).toEqual(items);
        });

        it('closes context menu', () => {
            useContextMenuStore.getState().openContextMenu({ x: 100, y: 200 }, [{ id: 'test', label: 'Test' }]);
            useContextMenuStore.getState().closeContextMenu();

            const state = useContextMenuStore.getState();
            expect(state.isOpen).toBe(false);
            expect(state.items).toEqual([]);
        });

        it('adds toast and auto-removes after 2s', () => {
            vi.useFakeTimers();
            useContextMenuStore.getState().showToast('Hello!');

            expect(useContextMenuStore.getState().toasts).toHaveLength(1);
            expect(useContextMenuStore.getState().toasts[0].message).toBe('Hello!');

            // Advance time by 2 seconds
            vi.advanceTimersByTime(2000);
            expect(useContextMenuStore.getState().toasts).toHaveLength(0);
            vi.useRealTimers();
        });

        it('toast defaults to info type', () => {
            useContextMenuStore.getState().showToast('Info msg');
            expect(useContextMenuStore.getState().toasts[0].type).toBe('info');
        });

        it('removes specific toast', () => {
            useContextMenuStore.getState().showToast('First');
            useContextMenuStore.getState().showToast('Second');

            expect(useContextMenuStore.getState().toasts).toHaveLength(2);
            const firstId = useContextMenuStore.getState().toasts[0].id;
            useContextMenuStore.getState().removeToast(firstId);
            expect(useContextMenuStore.getState().toasts).toHaveLength(1);
            expect(useContextMenuStore.getState().toasts[0].message).toBe('Second');
        });
    });

    // ──────────────────────────────────────────────────
    // 2. ContextMenuOverlay
    // ──────────────────────────────────────────────────

    describe('ContextMenuOverlay', () => {
        it('renders nothing when menu is closed', async () => {
            const { ContextMenuOverlay } = await import('../components/context-menu/ContextMenuOverlay');
            const { container } = render(<ContextMenuOverlay />);
            expect(container.innerHTML).toBe('');
        });

        it('renders menu items when open', async () => {
            useContextMenuStore.setState({
                isOpen: true,
                position: { x: 100, y: 100 },
                items: [
                    { id: 'item-1', label: 'First Item' },
                    { id: 'item-2', label: 'Second Item' },
                ],
            });

            const { ContextMenuOverlay } = await import('../components/context-menu/ContextMenuOverlay');
            render(<ContextMenuOverlay />);

            expect(screen.getByText('First Item')).toBeTruthy();
            expect(screen.getByText('Second Item')).toBeTruthy();
        });

        it('closes on backdrop click', async () => {
            useContextMenuStore.setState({
                isOpen: true,
                position: { x: 100, y: 100 },
                items: [{ id: 'test', label: 'Test' }],
            });

            const { ContextMenuOverlay } = await import('../components/context-menu/ContextMenuOverlay');
            render(<ContextMenuOverlay />);

            const overlay = screen.getByTestId('context-menu-overlay');
            fireEvent.click(overlay);

            expect(useContextMenuStore.getState().isOpen).toBe(false);
        });

        it('closes on Escape key', async () => {
            useContextMenuStore.setState({
                isOpen: true,
                position: { x: 100, y: 100 },
                items: [{ id: 'test', label: 'Test' }],
            });

            const { ContextMenuOverlay } = await import('../components/context-menu/ContextMenuOverlay');
            render(<ContextMenuOverlay />);

            fireEvent.keyDown(document, { key: 'Escape' });
            expect(useContextMenuStore.getState().isOpen).toBe(false);
        });

        it('calls item onClick and closes menu', async () => {
            const onClick = vi.fn();
            useContextMenuStore.setState({
                isOpen: true,
                position: { x: 100, y: 100 },
                items: [{ id: 'action', label: 'Do Something', onClick }],
            });

            const { ContextMenuOverlay } = await import('../components/context-menu/ContextMenuOverlay');
            render(<ContextMenuOverlay />);

            fireEvent.click(screen.getByText('Do Something'));
            expect(onClick).toHaveBeenCalled();
            expect(useContextMenuStore.getState().isOpen).toBe(false);
        });
    });

    // ──────────────────────────────────────────────────
    // 3. ContextMenuItem
    // ──────────────────────────────────────────────────

    describe('ContextMenuItem', () => {
        it('renders label', async () => {
            const { ContextMenuItem } = await import('../components/context-menu/ContextMenuItem');
            render(<ContextMenuItem item={{ id: 'test', label: 'My Label' }} onClose={vi.fn()} />);
            expect(screen.getByText('My Label')).toBeTruthy();
        });

        it('renders separator', async () => {
            const { ContextMenuItem } = await import('../components/context-menu/ContextMenuItem');
            const { container } = render(
                <ContextMenuItem item={{ id: 'sep', separator: true }} onClose={vi.fn()} />
            );
            expect(container.querySelector('.context-menu-separator')).toBeTruthy();
        });

        it('applies danger class', async () => {
            const { ContextMenuItem } = await import('../components/context-menu/ContextMenuItem');
            render(<ContextMenuItem item={{ id: 'del', label: 'Delete', danger: true }} onClose={vi.fn()} />);
            const item = screen.getByTestId('context-menu-item-del');
            expect(item.classList.contains('danger')).toBe(true);
        });

        it('applies disabled class and prevents click', async () => {
            const onClick = vi.fn();
            const { ContextMenuItem } = await import('../components/context-menu/ContextMenuItem');
            render(
                <ContextMenuItem item={{ id: 'dis', label: 'Disabled', disabled: true, onClick }} onClose={vi.fn()} />
            );
            const item = screen.getByTestId('context-menu-item-dis');
            expect(item.classList.contains('disabled')).toBe(true);

            fireEvent.click(item);
            expect(onClick).not.toHaveBeenCalled();
        });

        it('renders right icon', async () => {
            const { ContextMenuItem } = await import('../components/context-menu/ContextMenuItem');
            render(
                <ContextMenuItem item={{ id: 'copy', label: 'Copy ID', rightIcon: '🆔' }} onClose={vi.fn()} />
            );
            expect(screen.getByText('🆔')).toBeTruthy();
        });

        it('renders description', async () => {
            const { ContextMenuItem } = await import('../components/context-menu/ContextMenuItem');
            render(
                <ContextMenuItem item={{ id: 'desc', label: 'Item', description: 'A description' }} onClose={vi.fn()} />
            );
            expect(screen.getByText('A description')).toBeTruthy();
        });
    });

    // ──────────────────────────────────────────────────
    // 4. buildGuildMenu
    // ──────────────────────────────────────────────────

    describe('buildGuildMenu', () => {
        it('includes Guild Settings for user with MANAGE_SERVER', async () => {
            const { buildGuildMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildGuildMenu({
                guildId: 'guild-1',
                guildName: 'Test Guild',
                currentPermissions: 0x2, // MANAGE_SERVER
                isOwner: false,
                token: 'test-token',
            });
            expect(items.find(i => i.label === 'Guild Settings')).toBeTruthy();
        });

        it('excludes Guild Settings for user without MANAGE_SERVER', async () => {
            const { buildGuildMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildGuildMenu({
                guildId: 'guild-1',
                guildName: 'Test Guild',
                currentPermissions: 0,
                isOwner: false,
                token: 'test-token',
            });
            expect(items.find(i => i.label === 'Guild Settings')).toBeFalsy();
        });

        it('shows Leave Guild for non-owner', async () => {
            const { buildGuildMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildGuildMenu({
                guildId: 'guild-1',
                guildName: 'Test Guild',
                currentPermissions: 0,
                isOwner: false,
                token: 'test-token',
            });
            expect(items.find(i => i.label === 'Leave Guild')).toBeTruthy();
            expect(items.find(i => i.label === 'Delete Guild')).toBeFalsy();
        });

        it('shows Delete Guild (danger) for owner, hides Leave Guild', async () => {
            const { buildGuildMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildGuildMenu({
                guildId: 'guild-1',
                guildName: 'Test Guild',
                currentPermissions: 0x3,
                isOwner: true,
                token: 'test-token',
            });
            const deleteItem = items.find(i => i.label === 'Delete Guild');
            expect(deleteItem).toBeTruthy();
            expect(deleteItem?.danger).toBe(true);
            expect(items.find(i => i.label === 'Leave Guild')).toBeFalsy();
        });

        it('always includes Copy Guild ID', async () => {
            const { buildGuildMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildGuildMenu({
                guildId: 'guild-1',
                guildName: 'Test Guild',
                currentPermissions: 0,
                isOwner: false,
                token: 'test-token',
            });
            expect(items.find(i => i.label === 'Copy Guild ID')).toBeTruthy();
        });
    });

    // ──────────────────────────────────────────────────
    // 5. contextActions.copyToClipboard
    // ──────────────────────────────────────────────────

    describe('contextActions', () => {
        it('copyToClipboard calls navigator.clipboard.writeText and shows toast', async () => {
            const writeTextMock = vi.fn().mockResolvedValue(undefined);
            Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

            const { copyToClipboard } = await import('../components/context-menu/contextActions');
            await copyToClipboard('test-id-123');

            expect(writeTextMock).toHaveBeenCalledWith('test-id-123');
            expect(useContextMenuStore.getState().toasts).toHaveLength(1);
            expect(useContextMenuStore.getState().toasts[0].message).toBe('Copied!');
        });
    });

    // ──────────────────────────────────────────────────
    // 6. GuildSidebar regression
    // ──────────────────────────────────────────────────

    describe('GuildSidebar regression', () => {
        it('right-click guild opens context menu through the new engine', async () => {
            const { GuildSidebar } = await import('../components/GuildSidebar');
            render(<GuildSidebar />);

            await waitFor(() => {
                expect(screen.getByText('TE')).toBeTruthy();
            });

            const guildIcon = screen.getByText('TE');
            await act(async () => {
                fireEvent.contextMenu(guildIcon);
            });

            // The context menu store should now be open
            const state = useContextMenuStore.getState();
            expect(state.isOpen).toBe(true);
            expect(state.items.length).toBeGreaterThan(0);
        });

        it('context menu includes Delete Guild for creator', async () => {
            const { GuildSidebar } = await import('../components/GuildSidebar');
            render(<GuildSidebar />);

            await waitFor(() => {
                expect(screen.getByText('TE')).toBeTruthy();
            });

            await act(async () => {
                fireEvent.contextMenu(screen.getByText('TE'));
            });

            const state = useContextMenuStore.getState();
            expect(state.items.find(i => i.label === 'Delete Guild')).toBeTruthy();
        });

        it('context menu includes Copy Guild ID', async () => {
            const { GuildSidebar } = await import('../components/GuildSidebar');
            render(<GuildSidebar />);

            await waitFor(() => {
                expect(screen.getByText('TE')).toBeTruthy();
            });

            await act(async () => {
                fireEvent.contextMenu(screen.getByText('TE'));
            });

            const state = useContextMenuStore.getState();
            expect(state.items.find(i => i.label === 'Copy Guild ID')).toBeTruthy();
        });

        it('context menu includes Guild Settings when user has MANAGE_SERVER', async () => {
            const { GuildSidebar } = await import('../components/GuildSidebar');
            render(<GuildSidebar />);

            await waitFor(() => {
                expect(screen.getByText('TE')).toBeTruthy();
            });

            // Set permission AFTER auto-select resets it
            await act(async () => {
                useAppStore.setState({ currentUserPermissions: 0x2 });
            });

            await act(async () => {
                fireEvent.contextMenu(screen.getByText('TE'));
            });

            const state = useContextMenuStore.getState();
            expect(state.items.find(i => i.label === 'Guild Settings')).toBeTruthy();
        });
    });
});
