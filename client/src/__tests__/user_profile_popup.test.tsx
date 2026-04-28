/**
 * User Profile Popup Tests
 *
 * Validates:
 * 1. Renders when profilePopup state is set
 * 2. Shows nickname and global display name
 * 3. Shows role pills with correct colors
 * 4. Shows "Edit Profile" for self
 * 5. Shows "Message" for others
 * 6. Closes on outside click
 * 7. EditProfileDropdown renders two options
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useContextMenuStore } from '../store/contextMenuStore';
import { useAppStore } from '../store/appStore';
import type { Profile, RoleData, GlobalProfile } from '../store/appStore';

// ── Test Data ──

const mockProfiles: Profile[] = [
    {
        id: 'profile-self',
        server_id: 'guild-1',
        account_id: 'account-self',
        original_username: 'SelfUser',
        nickname: 'MySelf',
        avatar: '',
        role: 'ADMIN',
        aliases: '',
        primary_role_color: '#e74c3c',
    },
    {
        id: 'profile-other',
        server_id: 'guild-1',
        account_id: 'account-other',
        original_username: 'OtherUser',
        nickname: 'OtherNick',
        avatar: '',
        role: 'USER',
        aliases: '',
        primary_role_color: '#3498db',
    },
];

const mockRoles: RoleData[] = [
    { id: 'role-mod', server_id: 'guild-1', name: 'Moderator', color: '#e74c3c', permissions: 0, position: 2 },
    { id: 'role-member', server_id: 'guild-1', name: 'Member', color: '#2ecc71', permissions: 0, position: 1 },
    { id: 'role-everyone', server_id: 'guild-1', name: '@everyone', color: '', permissions: 0, position: 0 },
];

const mockGlobalProfiles: Record<string, GlobalProfile> = {
    'account-self': {
        account_id: 'account-self',
        display_name: 'Self Global',
        bio: 'Hello, I am self!',
        status_message: '',
        avatar_url: '',
        banner_url: '',
    },
    'account-other': {
        account_id: 'account-other',
        display_name: 'Other Global',
        bio: 'I am someone else.',
        status_message: '',
        avatar_url: '',
        banner_url: '',
    },
};

describe('User Profile Popup', () => {
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
            currentAccount: { id: 'account-self', email: 'self@test.com', is_creator: false, token: 'test-token' },
            claimedProfiles: [mockProfiles[0]],
            guildProfiles: mockProfiles,
            serverProfiles: mockProfiles,
            globalProfiles: mockGlobalProfiles,
            guildRoles: mockRoles,
            serverRoles: mockRoles,
            presenceMap: {
                'account-self': { accountId: 'account-self', status: 'online', lastUpdated: Date.now() },
                'account-other': { accountId: 'account-other', status: 'idle', lastUpdated: Date.now() },
            },
            activeGuildId: 'guild-1',
            activeServerId: 'guild-1',
            guildMap: { 'guild-1': 'http://localhost:3001' },
            serverMap: { 'guild-1': 'http://localhost:3001' },
            relationships: [],
            showUserSettings: false,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ──────────────────────────────────────────────────
    // 1. Renders when profilePopup state is set
    // ──────────────────────────────────────────────────

    describe('rendering', () => {
        it('renders nothing when profilePopup is null', async () => {
            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            const { container } = render(<UserProfilePopup />);
            expect(container.innerHTML).toBe('');
        });

        it('renders popup when profilePopup state is set', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-other', profileId: 'profile-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            expect(screen.getByTestId('profile-popup')).toBeTruthy();
        });
    });

    // ──────────────────────────────────────────────────
    // 2. Shows nickname and global display name
    // ──────────────────────────────────────────────────

    describe('name display', () => {
        it('shows nickname and global display name', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-other', profileId: 'profile-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            expect(screen.getByTestId('profile-popup-nickname').textContent).toBe('OtherNick');
            expect(screen.getByTestId('profile-popup-global-name').textContent).toBe('Other Global');
        });

        it('does not show global name if same as nickname', async () => {
            // Override global profile to match nickname
            useAppStore.setState({
                globalProfiles: {
                    ...mockGlobalProfiles,
                    'account-other': { ...mockGlobalProfiles['account-other'], display_name: 'OtherNick' },
                },
            });

            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-other', profileId: 'profile-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            expect(screen.queryByTestId('profile-popup-global-name')).toBeFalsy();
        });
    });

    // ──────────────────────────────────────────────────
    // 3. Shows role pills
    // ──────────────────────────────────────────────────

    describe('role pills', () => {
        it('shows role pills with correct colors (excludes @everyone)', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-other', profileId: 'profile-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            const rolesContainer = screen.getByTestId('profile-popup-roles');
            expect(rolesContainer).toBeTruthy();

            // Should have Moderator and Member, but not @everyone
            expect(screen.getByTestId('role-pill-role-mod')).toBeTruthy();
            expect(screen.getByTestId('role-pill-role-member')).toBeTruthy();
            expect(screen.queryByTestId('role-pill-role-everyone')).toBeFalsy();
        });
    });

    // ──────────────────────────────────────────────────
    // 4. Shows "Edit Profile" for self
    // ──────────────────────────────────────────────────

    describe('action buttons — self', () => {
        it('shows Edit Profile button for self', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-self', profileId: 'profile-self', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            expect(screen.getByTestId('profile-popup-edit-btn')).toBeTruthy();
            expect(screen.getByTestId('profile-popup-edit-btn').textContent).toBe('Edit Profile');
        });

        it('does not show Message button for self', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-self', profileId: 'profile-self', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            expect(screen.queryByTestId('profile-popup-message-btn')).toBeFalsy();
        });
    });

    // ──────────────────────────────────────────────────
    // 5. Shows "Message" for others
    // ──────────────────────────────────────────────────

    describe('action buttons — others', () => {
        it('shows Message button for other users', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-other', profileId: 'profile-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            expect(screen.getByTestId('profile-popup-message-btn')).toBeTruthy();
            expect(screen.getByTestId('profile-popup-message-btn').textContent).toBe('Message');
        });

        it('shows Add Friend button for other users', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-other', profileId: 'profile-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            expect(screen.getByTestId('profile-popup-friend-btn')).toBeTruthy();
        });

        it('does not show Edit Profile button for other users', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-other', profileId: 'profile-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            expect(screen.queryByTestId('profile-popup-edit-btn')).toBeFalsy();
        });
    });

    // ──────────────────────────────────────────────────
    // 6. Closes on outside click
    // ──────────────────────────────────────────────────

    describe('closing behavior', () => {
        it('closes on overlay click', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-other', profileId: 'profile-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            const overlay = screen.getByTestId('profile-popup-overlay');
            fireEvent.click(overlay);

            expect(useContextMenuStore.getState().profilePopup).toBeNull();
        });

        it('closes on Escape key', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-other', profileId: 'profile-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            fireEvent.keyDown(document, { key: 'Escape' });
            expect(useContextMenuStore.getState().profilePopup).toBeNull();
        });

        it('does not close when clicking inside popup', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-other', profileId: 'profile-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            const popup = screen.getByTestId('profile-popup');
            fireEvent.click(popup);

            expect(useContextMenuStore.getState().profilePopup).not.toBeNull();
        });
    });

    // ──────────────────────────────────────────────────
    // 7. EditProfileDropdown
    // ──────────────────────────────────────────────────

    describe('EditProfileDropdown', () => {
        it('renders two options', async () => {
            const { EditProfileDropdown } = await import('../components/context-menu/EditProfileDropdown');
            render(<EditProfileDropdown guildId="guild-1" onClose={vi.fn()} />);

            expect(screen.getByTestId('edit-guild-profile')).toBeTruthy();
            expect(screen.getByTestId('edit-global-profile')).toBeTruthy();
            expect(screen.getByTestId('edit-guild-profile').textContent).toBe('Edit Per-Guild Profile');
            expect(screen.getByTestId('edit-global-profile').textContent).toBe('Edit Global Profile');
        });

        it('Edit Global Profile sets showUserSettings in appStore', async () => {
            const { EditProfileDropdown } = await import('../components/context-menu/EditProfileDropdown');
            const onClose = vi.fn();
            render(<EditProfileDropdown guildId="guild-1" onClose={onClose} />);

            fireEvent.click(screen.getByTestId('edit-global-profile'));

            expect(useAppStore.getState().showUserSettings).toBe(true);
            expect(onClose).toHaveBeenCalled();
        });
    });

    // ──────────────────────────────────────────────────
    // 8. Bio display
    // ──────────────────────────────────────────────────

    describe('bio display', () => {
        it('shows bio from global profile', async () => {
            useContextMenuStore.setState({
                profilePopup: {
                    target: { accountId: 'account-other', profileId: 'profile-other', guildId: 'guild-1' },
                    anchorRect: { top: 100, left: 100, width: 40, height: 40 },
                },
            });

            const { UserProfilePopup } = await import('../components/context-menu/UserProfilePopup');
            render(<UserProfilePopup />);

            const bio = screen.getByTestId('profile-popup-bio');
            expect(bio).toBeTruthy();
            expect(bio.textContent).toContain('I am someone else.');
        });
    });
});
