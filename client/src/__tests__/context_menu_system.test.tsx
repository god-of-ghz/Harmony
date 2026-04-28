/**
 * Phase 5 — Context Menu System Integration Tests (Capstone)
 *
 * 30 test cases across 8 categories validating the entire context menu pipeline:
 *   A. Identity Resolution Consistency (1-3)
 *   B. Guild Menu Pipeline (4-7)
 *   C. Channel Menu Pipeline (8-10)
 *   D. Category Menu Pipeline (11-12)
 *   E. User Menu Pipeline (13-17)
 *   F. Message Menu Pipeline (18-22)
 *   G. Profile Popup (23-25)
 *   H. Context Actions (26-30)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';
import { useAppStore, Permission } from '../store/appStore';
import { useContextMenuStore } from '../store/contextMenuStore';
import type { Profile, RoleData, Account, Relationship } from '../store/appStore';

// ── Common Mocks ──

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
    Volume2: () => 'VolumeIcon',
    Pencil: () => 'PencilIcon',
    Trash2: () => 'TrashIcon',
    MessageSquareReply: () => 'ReplyIcon',
    Smile: () => 'SmileIcon',
    PhoneCall: () => 'PhoneCallIcon',
    Search: () => 'SearchIcon',
}));

vi.mock('../utils/keyStore', () => ({
    clearSessionKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/slaTracker', () => ({
    loadSlaCache: vi.fn().mockReturnValue({}),
}));

vi.mock('../utils/crypto', () => ({
    signPayload: vi.fn().mockResolvedValue('mock-sig'),
    deriveSharedKey: vi.fn().mockResolvedValue('mock-key'),
    decryptMessageContent: vi.fn().mockImplementation((c: string) => Promise.resolve(c)),
}));

vi.mock('../utils/url', () => ({
    convertToWsUrl: vi.fn().mockReturnValue('ws://localhost:3001'),
}));

const mockApiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({
    apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Test Fixtures ──

const mockAccount: Account = {
    id: 'acc-me',
    email: 'test@test.com',
    is_creator: true,
    is_admin: true,
    token: 'test-token',
    primary_server_url: 'http://localhost:3001',
};

const myProfile: Profile = {
    id: 'p-me',
    server_id: 'guild-1',
    account_id: 'acc-me',
    original_username: 'Me',
    nickname: 'MyNick',
    avatar: '',
    role: 'ADMIN',
    aliases: '',
    primary_role_color: '#5865F2',
};

const otherProfile: Profile = {
    id: 'p-other',
    server_id: 'guild-1',
    account_id: 'acc-other',
    original_username: 'Other',
    nickname: 'OtherNick',
    avatar: '',
    role: 'USER',
    aliases: '',
    primary_role_color: null,
};

const ownerProfile: Profile = {
    id: 'p-owner',
    server_id: 'guild-1',
    account_id: 'acc-owner',
    original_username: 'OwnerTarget',
    nickname: 'OwnerBoss',
    avatar: '',
    role: 'OWNER',
    aliases: '',
    primary_role_color: '#e74c3c',
};

const mockRoles: RoleData[] = [
    { id: 'role-admin', server_id: 'guild-1', name: 'ADMIN', color: '#e74c3c', permissions: 0x3, position: 2 },
    { id: 'role-user', server_id: 'guild-1', name: 'USER', color: '', permissions: 0, position: 0 },
    { id: 'role-everyone', server_id: 'guild-1', name: '@everyone', color: '', permissions: 0, position: -1 },
];

function resetStores(overrides: Record<string, any> = {}) {
    useAppStore.setState({
        activeGuildId: 'guild-1',
        activeServerId: 'guild-1',
        activeChannelId: 'ch-1',
        activeChannelName: 'general',
        currentAccount: mockAccount,
        connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
        guildMap: { 'guild-1': 'http://localhost:3001' },
        serverMap: { 'guild-1': 'http://localhost:3001' },
        guildProfiles: [myProfile, otherProfile, ownerProfile],
        serverProfiles: [myProfile, otherProfile, ownerProfile],
        guildRoles: mockRoles,
        serverRoles: mockRoles,
        presenceMap: {
            'acc-me': { accountId: 'acc-me', status: 'online', lastUpdated: Date.now() },
            'acc-other': { accountId: 'acc-other', status: 'online', lastUpdated: Date.now() },
        },
        claimedProfiles: [myProfile],
        currentUserPermissions: 0xFFFFFFFF,
        unreadChannels: new Set(),
        relationships: [],
        nodeStatus: {},
        serverStatus: {},
        profilesLoaded: true,
        dismissedGlobalClaim: true,
        isGuestSession: false,
        showGuildSettings: false,
        showUserSettings: false,
        readStates: {},
        searchStateByGuild: {},
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

describe('Phase 5 — Context Menu System Integration (30 Cases)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStores();
        mockApiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ════════════════════════════════════════
    // A. Identity Resolution Consistency (1-3)
    // ════════════════════════════════════════

    describe('A. Identity Resolution Consistency', () => {
        it('1. same user, different surfaces: resolveUserContext is deterministic', async () => {
            const { resolveUserContext } = await import('../types/UserTarget');
            const target = { profileId: 'p-other', accountId: 'acc-other', guildId: 'guild-1' };

            const ctx1 = resolveUserContext(target);
            const ctx2 = resolveUserContext(target);

            expect(ctx1.targetNickname).toBe(ctx2.targetNickname);
            expect(ctx1.targetRole).toBe(ctx2.targetRole);
            expect(ctx1.isSelf).toBe(ctx2.isSelf);
            expect(ctx1.isFriend).toBe(ctx2.isFriend);
            expect(ctx1.isHigherRank).toBe(ctx2.isHigherRank);
            expect(ctx1.canKick).toBe(ctx2.canKick);
            expect(ctx1.canBan).toBe(ctx2.canBan);
        });

        it('2. self detection: isSelf is true when profileId matches current profile', async () => {
            const { resolveUserContext } = await import('../types/UserTarget');
            const target = { profileId: 'p-me', guildId: 'guild-1' };

            const ctx = resolveUserContext(target);
            expect(ctx.isSelf).toBe(true);
            expect(ctx.targetNickname).toBe('MyNick');
        });

        it('3. rank comparison: target ADMIN < current ADMIN equal, target OWNER > current ADMIN', async () => {
            const { resolveUserContext } = await import('../types/UserTarget');

            // Target is USER, current is ADMIN → not higher rank (USER=1 < ADMIN=2)
            const ctxLower = resolveUserContext({ profileId: 'p-other', guildId: 'guild-1' });
            expect(ctxLower.isHigherRank).toBe(false);

            // Target is OWNER, current is ADMIN → higher rank (OWNER=3 >= ADMIN=2)
            const ctxHigher = resolveUserContext({ profileId: 'p-owner', guildId: 'guild-1' });
            expect(ctxHigher.isHigherRank).toBe(true);
        });
    });

    // ════════════════════════════════════════
    // B. Guild Menu Pipeline (4-7)
    // ════════════════════════════════════════

    describe('B. Guild Menu Pipeline', () => {
        it('4. admin guild menu: MANAGE_SERVER → Guild Settings present', async () => {
            const { buildGuildMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildGuildMenu({
                guildId: 'guild-1',
                guildName: 'Test Guild',
                currentPermissions: Permission.MANAGE_SERVER,
                isOwner: false,
                token: 'test-token',
            });
            expect(items.find(i => i.label === 'Guild Settings')).toBeTruthy();
        });

        it('5. non-admin guild menu: no MANAGE_SERVER → Guild Settings absent', async () => {
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

        it('6. owner sees Delete, non-owner sees Leave', async () => {
            const { buildGuildMenu } = await import('../components/context-menu/menuBuilders');

            const ownerItems = buildGuildMenu({
                guildId: 'guild-1', guildName: 'Test', currentPermissions: 0xFFFFFFFF,
                isOwner: true, token: 'test-token',
            });
            expect(ownerItems.find(i => i.label === 'Delete Guild')).toBeTruthy();
            expect(ownerItems.find(i => i.label === 'Leave Guild')).toBeFalsy();

            const memberItems = buildGuildMenu({
                guildId: 'guild-1', guildName: 'Test', currentPermissions: 0,
                isOwner: false, token: 'test-token',
            });
            expect(memberItems.find(i => i.label === 'Leave Guild')).toBeTruthy();
            expect(memberItems.find(i => i.label === 'Delete Guild')).toBeFalsy();
        });

        it('7. Copy Guild ID calls clipboard and shows toast', async () => {
            const { buildGuildMenu } = await import('../components/context-menu/menuBuilders');
            const writeText = vi.fn().mockResolvedValue(undefined);
            Object.assign(navigator, { clipboard: { writeText } });

            const items = buildGuildMenu({
                guildId: 'guild-42', guildName: 'Test', currentPermissions: 0,
                isOwner: false, token: 'test-token',
            });

            const copyItem = items.find(i => i.label === 'Copy Guild ID');
            expect(copyItem).toBeTruthy();
            await act(async () => { copyItem!.onClick!(); });

            expect(writeText).toHaveBeenCalledWith('guild-42');
            await waitFor(() => {
                expect(useContextMenuStore.getState().toasts.length).toBeGreaterThan(0);
            });
        });
    });

    // ════════════════════════════════════════
    // C. Channel Menu Pipeline (8-10)
    // ════════════════════════════════════════

    describe('C. Channel Menu Pipeline', () => {
        it('8. channel menu with MANAGE_CHANNELS: Edit/Create/Delete present', async () => {
            const { buildChannelMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildChannelMenu({
                channelId: 'ch-1', channelName: 'general', guildId: 'guild-1',
                currentPermissions: Permission.MANAGE_CHANNELS, isUnread: false,
            });
            expect(items.find(i => i.label === 'Edit Channel')).toBeTruthy();
            expect(items.find(i => i.label === 'Create Text Channel')).toBeTruthy();
            expect(items.find(i => i.label === 'Delete Channel')).toBeTruthy();
        });

        it('9. channel menu without permissions: only Copy Channel ID', async () => {
            const { buildChannelMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildChannelMenu({
                channelId: 'ch-1', channelName: 'general', guildId: 'guild-1',
                currentPermissions: 0, isUnread: false,
            });
            expect(items.find(i => i.label === 'Edit Channel')).toBeFalsy();
            expect(items.find(i => i.label === 'Copy Channel ID')).toBeTruthy();
        });

        it('10. same channel identity: sidebar vs header produce identical items', async () => {
            const { buildChannelMenu } = await import('../components/context-menu/menuBuilders');
            const ctx = {
                channelId: 'ch-1', channelName: 'general', guildId: 'guild-1',
                currentPermissions: Permission.ADMINISTRATOR, isUnread: true,
            };
            const sidebarItems = buildChannelMenu(ctx);
            const headerItems = buildChannelMenu(ctx);
            expect(sidebarItems.length).toBe(headerItems.length);
            sidebarItems.forEach((item, i) => {
                expect(item.id).toBe(headerItems[i].id);
                expect(item.label).toBe(headerItems[i].label);
            });
        });
    });

    // ════════════════════════════════════════
    // D. Category Menu Pipeline (11-12)
    // ════════════════════════════════════════

    describe('D. Category Menu Pipeline', () => {
        it('11. category menu with MANAGE_CHANNELS: Edit/Delete present', async () => {
            const { buildCategoryMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildCategoryMenu({
                categoryId: 'cat-1', categoryName: 'Text Channels', guildId: 'guild-1',
                currentPermissions: Permission.MANAGE_CHANNELS,
                isCollapsed: false, hasUnreadChannels: false,
                onToggleCollapse: vi.fn(), onCollapseAll: vi.fn(),
            });
            expect(items.find(i => i.label === 'Edit Category')).toBeTruthy();
            expect(items.find(i => i.label === 'Delete Category')).toBeTruthy();
        });

        it('12. collapse toggle: flips label between Collapse/Expand', async () => {
            const { buildCategoryMenu } = await import('../components/context-menu/menuBuilders');
            const base = {
                categoryId: 'cat-1', categoryName: 'Text', guildId: 'guild-1',
                currentPermissions: 0, hasUnreadChannels: false,
                onToggleCollapse: vi.fn(), onCollapseAll: vi.fn(),
            };

            const expanded = buildCategoryMenu({ ...base, isCollapsed: false });
            expect(expanded.find(i => i.label === 'Collapse Category')).toBeTruthy();

            const collapsed = buildCategoryMenu({ ...base, isCollapsed: true });
            expect(collapsed.find(i => i.label === 'Expand Category')).toBeTruthy();
        });
    });

    // ════════════════════════════════════════
    // E. User Menu Pipeline (13-17)
    // ════════════════════════════════════════

    describe('E. User Menu Pipeline', () => {
        it('13. self menu: Profile + Mention present, Kick/Ban/Message absent', async () => {
            const { resolveUserContext } = await import('../types/UserTarget');
            const { buildUserMenu } = await import('../components/context-menu/menuBuilders');
            const ctx = resolveUserContext({ profileId: 'p-me', guildId: 'guild-1' });
            expect(ctx.isSelf).toBe(true);
            const items = buildUserMenu(ctx);
            expect(items.find(i => i.label === 'Profile')).toBeTruthy();
            expect(items.find(i => i.label === 'Mention')).toBeTruthy();
            expect(items.find(i => i.label === 'Message')).toBeFalsy();
            expect(items.find(i => i.id === 'user-kick')).toBeFalsy();
            expect(items.find(i => i.id === 'user-ban')).toBeFalsy();
        });

        it('14. other lower rank: admin can Kick/Ban a USER', async () => {
            const { resolveUserContext } = await import('../types/UserTarget');
            const { buildUserMenu } = await import('../components/context-menu/menuBuilders');
            resetStores({ currentUserPermissions: Permission.ADMINISTRATOR });
            const ctx = resolveUserContext({ profileId: 'p-other', guildId: 'guild-1' });
            expect(ctx.isHigherRank).toBe(false); // USER < ADMIN
            const items = buildUserMenu(ctx);
            expect(items.find(i => i.id === 'user-kick')).toBeTruthy();
            expect(items.find(i => i.id === 'user-ban')).toBeTruthy();
        });

        it('15. other higher rank: Kick/Ban hidden entirely', async () => {
            const { resolveUserContext } = await import('../types/UserTarget');
            const { buildUserMenu } = await import('../components/context-menu/menuBuilders');
            resetStores({ currentUserPermissions: Permission.ADMINISTRATOR });
            const ctx = resolveUserContext({ profileId: 'p-owner', guildId: 'guild-1' });
            expect(ctx.isHigherRank).toBe(true); // OWNER >= ADMIN
            const items = buildUserMenu(ctx);
            expect(items.find(i => i.id === 'user-kick')).toBeFalsy();
            expect(items.find(i => i.id === 'user-ban')).toBeFalsy();
        });

        it('16. friend detection: Remove Friend appears for friends', async () => {
            const { resolveUserContext } = await import('../types/UserTarget');
            const { buildUserMenu } = await import('../components/context-menu/menuBuilders');
            resetStores({
                relationships: [{
                    account_id: 'acc-me', target_id: 'acc-other',
                    status: 'friend', timestamp: Date.now(),
                }],
            });
            const ctx = resolveUserContext({ profileId: 'p-other', accountId: 'acc-other', guildId: 'guild-1' });
            expect(ctx.isFriend).toBe(true);
            const items = buildUserMenu(ctx);
            expect(items.find(i => i.label === 'Remove Friend')).toBeTruthy();
            expect(items.find(i => i.label === 'Add Friend')).toBeFalsy();
        });

        it('17. Mention action dispatches harmony-insert-mention event', async () => {
            const { resolveUserContext } = await import('../types/UserTarget');
            const { buildUserMenu } = await import('../components/context-menu/menuBuilders');
            const ctx = resolveUserContext({ profileId: 'p-other', guildId: 'guild-1' });
            const items = buildUserMenu(ctx);
            const mentionItem = items.find(i => i.label === 'Mention');
            expect(mentionItem).toBeTruthy();

            let receivedDetail: any = null;
            const handler = (e: Event) => { receivedDetail = (e as CustomEvent).detail; };
            window.addEventListener('harmony-insert-mention', handler);
            mentionItem!.onClick!();
            window.removeEventListener('harmony-insert-mention', handler);

            expect(receivedDetail).toEqual({ nickname: 'OtherNick' });
        });
    });

    // ════════════════════════════════════════
    // F. Message Menu Pipeline (18-22)
    // ════════════════════════════════════════

    describe('F. Message Menu Pipeline', () => {
        const msgCtx = (overrides: Record<string, any> = {}) => ({
            messageId: 'msg-1', messageContent: 'Hello', authorProfileId: 'p-other',
            isOwnMessage: false, currentPermissions: 0,
            channelId: 'ch-1', guildId: 'guild-1',
            onEdit: vi.fn(), onReply: vi.fn(), onDelete: vi.fn(),
            onCopyLink: vi.fn(), onAddReaction: vi.fn(),
            ...overrides,
        });

        it('18. own message: Edit present, Report absent', async () => {
            const { buildMessageMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildMessageMenu(msgCtx({ isOwnMessage: true }));
            expect(items.find(i => i.label === 'Edit Message')).toBeTruthy();
            expect(items.find(i => i.label === 'Report Message')).toBeFalsy();
        });

        it('19. other message: Edit absent, Report present', async () => {
            const { buildMessageMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildMessageMenu(msgCtx({ isOwnMessage: false }));
            expect(items.find(i => i.label === 'Edit Message')).toBeFalsy();
            expect(items.find(i => i.label === 'Report Message')).toBeTruthy();
        });

        it('20. admin delete on other message: MANAGE_MESSAGES → Delete present', async () => {
            const { buildMessageMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildMessageMenu(msgCtx({
                isOwnMessage: false,
                currentPermissions: Permission.MANAGE_MESSAGES,
            }));
            expect(items.find(i => i.label === 'Delete Message')).toBeTruthy();
        });

        it('21. non-admin cannot delete other message', async () => {
            const { buildMessageMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildMessageMenu(msgCtx({ isOwnMessage: false, currentPermissions: 0 }));
            expect(items.find(i => i.label === 'Delete Message')).toBeFalsy();
        });

        it('22. QuickReactBar: first item has customComponent', async () => {
            const { buildMessageMenu } = await import('../components/context-menu/menuBuilders');
            const items = buildMessageMenu(msgCtx());
            const quickReact = items.find(i => i.id === 'quick-react');
            expect(quickReact).toBeTruthy();
            expect(quickReact!.customComponent).toBeTruthy();
        });
    });

    // ════════════════════════════════════════
    // G. Profile Popup (23-25)
    // ════════════════════════════════════════

    describe('G. Profile Popup', () => {
        it('23. profile popup renders on store state', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'acc-other', profileId: 'p-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });
            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);
            expect(screen.getByTestId('profile-popup-nickname')).toBeTruthy();
            expect(screen.getByTestId('profile-popup-nickname').textContent).toBe('OtherNick');
        });

        it('24. profile popup closes on Escape', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'acc-other', profileId: 'p-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });
            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);
            expect(screen.getByTestId('profile-popup')).toBeTruthy();

            await act(async () => {
                fireEvent.keyDown(document, { key: 'Escape' });
            });

            expect(useContextMenuStore.getState().profilePopup).toBeNull();
        });

        it('25. Edit Profile dropdown for self', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'acc-me', profileId: 'p-me', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });
            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            // Self should see "Edit Profile" button
            const editBtn = screen.getByTestId('profile-popup-edit-btn');
            expect(editBtn).toBeTruthy();

            // Click to open dropdown
            await act(async () => { fireEvent.click(editBtn); });

            // Dropdown should appear
            expect(screen.getByTestId('edit-profile-dropdown')).toBeTruthy();
            expect(screen.getByTestId('edit-guild-profile')).toBeTruthy();
            expect(screen.getByTestId('edit-global-profile')).toBeTruthy();
        });
    });

    // ════════════════════════════════════════
    // H. Context Actions (26-30)
    // ════════════════════════════════════════

    describe('H. Context Actions', () => {
        it('26. copyToClipboard: calls writeText and shows toast', async () => {
            const { copyToClipboard } = await import('../components/context-menu/contextActions');
            const writeText = vi.fn().mockResolvedValue(undefined);
            Object.assign(navigator, { clipboard: { writeText } });

            await copyToClipboard('test-id-123');

            expect(writeText).toHaveBeenCalledWith('test-id-123');
            expect(useContextMenuStore.getState().toasts.some(t => t.message === 'Copied!')).toBe(true);
        });

        it('27. leaveGuild: POST to /api/guilds/{id}/leave', async () => {
            const { leaveGuild } = await import('../components/context-menu/contextActions');
            mockApiFetch.mockResolvedValue({ ok: true });

            await leaveGuild('guild-1', 'test-token');

            expect(mockApiFetch).toHaveBeenCalledWith(
                'http://localhost:3001/api/guilds/guild-1/leave',
                expect.objectContaining({ method: 'POST' })
            );
        });

        it('28. deleteGuild: DELETE to /api/guilds/{id}', async () => {
            const { deleteGuild } = await import('../components/context-menu/contextActions');
            mockApiFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ success: true }),
            });

            await deleteGuild('guild-1', 'test-token');

            expect(mockApiFetch).toHaveBeenCalledWith(
                'http://localhost:3001/api/guilds/guild-1',
                expect.objectContaining({ method: 'DELETE' })
            );
        });

        it('29. insertMention: dispatches harmony-insert-mention event', async () => {
            const { insertMention } = await import('../components/context-menu/contextActions');
            let receivedNickname = '';
            const handler = (e: Event) => {
                receivedNickname = (e as CustomEvent).detail.nickname;
            };
            window.addEventListener('harmony-insert-mention', handler);
            insertMention('TestUser');
            window.removeEventListener('harmony-insert-mention', handler);

            expect(receivedNickname).toBe('TestUser');
        });

        it('30. markChannelAsRead: updates readStates and removes unreadChannel', async () => {
            const { markChannelAsRead } = await import('../components/context-menu/contextActions');
            useAppStore.setState({
                unreadChannels: new Set(['ch-99']),
                readStates: {},
            });

            markChannelAsRead('ch-99');

            const state = useAppStore.getState();
            expect(state.readStates['ch-99']).toBeTruthy();
            expect(state.readStates['ch-99']).toMatch(/^read-/);
            expect(state.unreadChannels.has('ch-99')).toBe(false);
        });
    });
});
