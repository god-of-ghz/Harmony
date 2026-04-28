/**
 * Context Menu Messages Tests
 *
 * Validates:
 * 1. buildMessageMenu: own message includes Edit, excludes Report
 * 2. buildMessageMenu: other's message excludes Edit, includes Report
 * 3. buildMessageMenu: admin can delete other's messages
 * 4. buildMessageMenu: non-admin cannot delete other's messages
 * 5. QuickReactBar: renders 4 emoji buttons
 * 6. Message body right-click opens message menu (not user menu)
 * 7. Avatar right-click still opens user menu (stopPropagation works)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useContextMenuStore } from '../store/contextMenuStore';
import { useAppStore, Permission } from '../store/appStore';
import type { Profile } from '../store/appStore';
import { buildMessageMenu } from '../components/context-menu/menuBuilders';
import type { MessageMenuContext } from '../components/context-menu/menuBuilders';

// ── Test Data ──

const mockProfiles: Profile[] = [
    {
        id: 'profile-author',
        server_id: 'guild-1',
        account_id: 'account-author',
        original_username: 'Author',
        nickname: 'Author',
        avatar: '',
        role: 'USER',
        aliases: '',
    },
    {
        id: 'profile-viewer',
        server_id: 'guild-1',
        account_id: 'account-viewer',
        original_username: 'Viewer',
        nickname: 'Viewer',
        avatar: '',
        role: 'USER',
        aliases: '',
    },
];

const makeMessageCtx = (overrides: Partial<MessageMenuContext> = {}): MessageMenuContext => ({
    messageId: 'msg-1',
    messageContent: 'Hello world',
    authorProfileId: 'profile-author',
    isOwnMessage: false,
    currentPermissions: 0,
    channelId: 'ch-1',
    guildId: 'guild-1',
    onEdit: vi.fn(),
    onReply: vi.fn(),
    onDelete: vi.fn(),
    onCopyLink: vi.fn(),
    onAddReaction: vi.fn(),
    ...overrides,
});

describe('Context Menu Messages', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        useContextMenuStore.setState({
            isOpen: false,
            position: { x: 0, y: 0 },
            items: [],
            toasts: [],
            profilePopup: null,
        });

        useAppStore.setState({
            currentAccount: { id: 'account-viewer', email: 'viewer@test.com', is_creator: false, token: 'test-token' },
            claimedProfiles: [mockProfiles[1]], // viewer
            guildProfiles: mockProfiles,
            serverProfiles: mockProfiles,
            currentUserPermissions: 0,
            activeGuildId: 'guild-1',
            activeServerId: 'guild-1',
            guildMap: { 'guild-1': 'http://localhost:3001' },
            serverMap: { 'guild-1': 'http://localhost:3001' },
            guildRoles: [],
            serverRoles: [],
            relationships: [],
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ──────────────────────────────────────────────────
    // 1. buildMessageMenu — own message
    // ──────────────────────────────────────────────────

    describe('buildMessageMenu — own message', () => {
        it('includes Edit Message for own message', () => {
            const ctx = makeMessageCtx({ isOwnMessage: true });
            const items = buildMessageMenu(ctx);

            expect(items.find(i => i.label === 'Edit Message')).toBeTruthy();
        });

        it('excludes Report Message for own message', () => {
            const ctx = makeMessageCtx({ isOwnMessage: true });
            const items = buildMessageMenu(ctx);

            expect(items.find(i => i.label === 'Report Message')).toBeFalsy();
        });

        it('includes Delete Message for own message', () => {
            const ctx = makeMessageCtx({ isOwnMessage: true });
            const items = buildMessageMenu(ctx);

            expect(items.find(i => i.label === 'Delete Message')).toBeTruthy();
            expect(items.find(i => i.id === 'msg-delete')?.danger).toBe(true);
        });
    });

    // ──────────────────────────────────────────────────
    // 2. buildMessageMenu — other's message
    // ──────────────────────────────────────────────────

    describe("buildMessageMenu — other's message", () => {
        it('excludes Edit Message for non-own message', () => {
            const ctx = makeMessageCtx({ isOwnMessage: false });
            const items = buildMessageMenu(ctx);

            expect(items.find(i => i.label === 'Edit Message')).toBeFalsy();
        });

        it('includes Report Message for non-own message', () => {
            const ctx = makeMessageCtx({ isOwnMessage: false });
            const items = buildMessageMenu(ctx);

            expect(items.find(i => i.label === 'Report Message')).toBeTruthy();
        });

        it('excludes Delete Message for non-admin, non-own', () => {
            const ctx = makeMessageCtx({ isOwnMessage: false, currentPermissions: 0 });
            const items = buildMessageMenu(ctx);

            expect(items.find(i => i.label === 'Delete Message')).toBeFalsy();
        });
    });

    // ──────────────────────────────────────────────────
    // 3. buildMessageMenu — admin permissions
    // ──────────────────────────────────────────────────

    describe('buildMessageMenu — admin permissions', () => {
        it('admin can delete others messages', () => {
            const ctx = makeMessageCtx({
                isOwnMessage: false,
                currentPermissions: Permission.ADMINISTRATOR,
            });
            const items = buildMessageMenu(ctx);

            expect(items.find(i => i.label === 'Delete Message')).toBeTruthy();
        });

        it('user with MANAGE_MESSAGES can delete others messages', () => {
            const ctx = makeMessageCtx({
                isOwnMessage: false,
                currentPermissions: Permission.MANAGE_MESSAGES,
            });
            const items = buildMessageMenu(ctx);

            expect(items.find(i => i.label === 'Delete Message')).toBeTruthy();
        });

        it('admin sees Pin Message', () => {
            const ctx = makeMessageCtx({
                currentPermissions: Permission.ADMINISTRATOR,
            });
            const items = buildMessageMenu(ctx);

            expect(items.find(i => i.label === 'Pin Message')).toBeTruthy();
        });

        it('non-admin does not see Pin Message', () => {
            const ctx = makeMessageCtx({
                currentPermissions: 0,
            });
            const items = buildMessageMenu(ctx);

            expect(items.find(i => i.label === 'Pin Message')).toBeFalsy();
        });
    });

    // ──────────────────────────────────────────────────
    // 4. buildMessageMenu — always-present items
    // ──────────────────────────────────────────────────

    describe('buildMessageMenu — always-present items', () => {
        it('always includes Reply', () => {
            const ctx = makeMessageCtx();
            const items = buildMessageMenu(ctx);
            expect(items.find(i => i.label === 'Reply')).toBeTruthy();
        });

        it('always includes Copy Text', () => {
            const ctx = makeMessageCtx();
            const items = buildMessageMenu(ctx);
            expect(items.find(i => i.label === 'Copy Text')).toBeTruthy();
        });

        it('always includes Copy Message Link', () => {
            const ctx = makeMessageCtx();
            const items = buildMessageMenu(ctx);
            expect(items.find(i => i.label === 'Copy Message Link')).toBeTruthy();
        });

        it('always includes Copy Message ID', () => {
            const ctx = makeMessageCtx();
            const items = buildMessageMenu(ctx);
            expect(items.find(i => i.label === 'Copy Message ID')).toBeTruthy();
        });

        it('always includes Mark Unread', () => {
            const ctx = makeMessageCtx();
            const items = buildMessageMenu(ctx);
            expect(items.find(i => i.label === 'Mark Unread')).toBeTruthy();
        });

        it('includes quick-react custom component', () => {
            const ctx = makeMessageCtx();
            const items = buildMessageMenu(ctx);
            const quickReact = items.find(i => i.id === 'quick-react');
            expect(quickReact).toBeTruthy();
            expect(quickReact?.customComponent).toBeTruthy();
        });
    });

    // ──────────────────────────────────────────────────
    // 5. QuickReactBar
    // ──────────────────────────────────────────────────

    describe('QuickReactBar', () => {
        it('renders 4 emoji buttons', async () => {
            const { QuickReactBar } = await import('../components/context-menu/QuickReactBar');
            const onAddReaction = vi.fn();

            render(<QuickReactBar onAddReaction={onAddReaction} />);

            const bar = screen.getByTestId('quick-react-bar');
            expect(bar).toBeTruthy();

            const buttons = bar.querySelectorAll('.quick-react-btn');
            expect(buttons.length).toBe(4);
        });

        it('calls onAddReaction with correct emoji on click', async () => {
            const { QuickReactBar } = await import('../components/context-menu/QuickReactBar');
            const onAddReaction = vi.fn();

            render(<QuickReactBar onAddReaction={onAddReaction} />);

            const thumbsUp = screen.getByTestId('quick-react-👍');
            fireEvent.click(thumbsUp);

            expect(onAddReaction).toHaveBeenCalledWith('👍');
        });

        it('closes context menu on emoji click', async () => {
            // Open the context menu first
            useContextMenuStore.setState({ isOpen: true, items: [{ id: 'test', label: 'Test' }] });

            const { QuickReactBar } = await import('../components/context-menu/QuickReactBar');
            render(<QuickReactBar onAddReaction={vi.fn()} />);

            fireEvent.click(screen.getByTestId('quick-react-❤️'));

            expect(useContextMenuStore.getState().isOpen).toBe(false);
        });
    });

    // ──────────────────────────────────────────────────
    // 6. contextActions — copyMessageLink
    // ──────────────────────────────────────────────────

    describe('contextActions', () => {
        it('copyMessageLink generates correct link and copies', async () => {
            const writeTextMock = vi.fn().mockResolvedValue(undefined);
            Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

            const { copyMessageLink } = await import('../components/context-menu/contextActions');
            await copyMessageLink('guild-1', 'ch-1', 'msg-1');

            expect(writeTextMock).toHaveBeenCalledWith(
                expect.stringContaining('/channels/guild-1/ch-1/msg-1')
            );
        });
    });
});
