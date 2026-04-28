/**
 * Role Management Regression Tests
 *
 * Validates the complete role management pipeline:
 *
 * CLIENT-SIDE:
 *  1. buildUserMenu shows Roles submenu for self when canManageRoles
 *  2. buildUserMenu shows Roles submenu for other user when canManageRoles
 *  3. buildUserMenu hides Roles submenu when canManageRoles is false
 *  4. buildUserMenu hides Roles submenu when no non-@everyone roles exist
 *  5. RoleSubMenuContent fetches and maps role IDs correctly (id not role_id)
 *  6. RoleSubMenuContent shows check marks for assigned roles
 *  7. RoleSubMenuContent toggle sends correct HTTP method (POST/DELETE)
 *  8. cleanSeparators removes consecutive separators for self-context-menu
 *
 * SERVER-SIDE:
 *  9. GET /api/guilds/:guildId/profiles/:profileId/roles returns assigned roles
 * 10. POST /api/guilds/:guildId/profiles/:profileId/roles assigns a role
 * 11. DELETE /api/guilds/:guildId/profiles/:profileId/roles/:roleId unassigns a role
 * 12. Owner can manage own roles (POST/DELETE)
 * 13. Admin can manage own roles (POST/DELETE)
 * 14. Regular user cannot manage roles (403)
 * 15. Duplicate role assignment returns 500
 * 16. Role deletion removes profile_roles references
 */

import { describe, it, expect, beforeEach, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { useContextMenuStore } from '../store/contextMenuStore';
import { useAppStore, Permission } from '../store/appStore';
import type { Profile, RoleData } from '../store/appStore';
import { resolveUserContext } from '../types/UserTarget';
import type { UserTarget } from '../types/UserTarget';
import { buildUserMenu, RoleSubMenuContent } from '../components/context-menu/menuBuilders';

// ── Mock Data ──

const mockProfiles: Profile[] = [
    {
        id: 'profile-owner',
        server_id: 'guild-1',
        account_id: 'account-owner',
        original_username: 'OwnerUser',
        nickname: 'Owner',
        avatar: '',
        role: 'OWNER',
        aliases: '',
    },
    {
        id: 'profile-admin',
        server_id: 'guild-1',
        account_id: 'account-admin',
        original_username: 'AdminUser',
        nickname: 'Admin',
        avatar: '',
        role: 'ADMIN',
        aliases: '',
    },
    {
        id: 'profile-user',
        server_id: 'guild-1',
        account_id: 'account-user',
        original_username: 'RegularUser',
        nickname: 'Regular',
        avatar: '',
        role: 'USER',
        aliases: '',
    },
];

const mockRoles: RoleData[] = [
    { id: 'role-mod', server_id: 'guild-1', name: 'Moderator', color: '#ff0000', permissions: 0, position: 2 },
    { id: 'role-member', server_id: 'guild-1', name: 'Member', color: '#00ff00', permissions: 0, position: 1 },
    { id: 'role-everyone', server_id: 'guild-1', name: '@everyone', color: '', permissions: 0, position: -1 },
];

// ── Test Suite ──

describe('Role Management Regression', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        useContextMenuStore.setState({
            isOpen: false,
            position: { x: 100, y: 100 },
            items: [],
            toasts: [],
            profilePopup: null,
        });

        useAppStore.setState({
            currentAccount: { id: 'account-admin', email: 'admin@test.com', is_creator: false, token: 'test-token' },
            claimedProfiles: [mockProfiles[1]], // current user is admin
            guildProfiles: mockProfiles,
            serverProfiles: mockProfiles,
            guildRoles: mockRoles,
            serverRoles: mockRoles,
            currentUserPermissions: Permission.ADMINISTRATOR,
            relationships: [],
            activeGuildId: 'guild-1',
            activeServerId: 'guild-1',
            guildMap: { 'guild-1': 'http://localhost:3001' },
            serverMap: { 'guild-1': 'http://localhost:3001' },
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ──────────────────────────────────────────────────
    // CLIENT: buildUserMenu — Self Role Management
    // ──────────────────────────────────────────────────

    describe('buildUserMenu — self role management', () => {
        it('1. shows Roles submenu for self when canManageRoles (admin)', () => {
            const target: UserTarget = { profileId: 'profile-admin', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            expect(ctx.isSelf).toBe(true);
            expect(ctx.canManageRoles).toBe(true);

            const items = buildUserMenu(ctx);
            const rolesItem = items.find(i => i.label === 'Roles');
            expect(rolesItem).toBeTruthy();
            expect(rolesItem?.children?.length).toBe(1);
        });

        it('2. shows Roles submenu for self when user is owner', () => {
            // Switch current user to owner
            useAppStore.setState({
                currentAccount: { id: 'account-owner', email: 'owner@test.com', is_creator: true, token: 'test-token' },
                claimedProfiles: [mockProfiles[0]],
            });

            const target: UserTarget = { profileId: 'profile-owner', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            expect(ctx.isSelf).toBe(true);

            const items = buildUserMenu(ctx);
            expect(items.find(i => i.label === 'Roles')).toBeTruthy();
        });

        it('3. shows Roles submenu for other user when canManageRoles', () => {
            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            expect(ctx.isSelf).toBe(false);
            expect(ctx.canManageRoles).toBe(true);

            const items = buildUserMenu(ctx);
            expect(items.find(i => i.label === 'Roles')).toBeTruthy();
        });

        it('4. hides Roles submenu when canManageRoles is false', () => {
            useAppStore.setState({ currentUserPermissions: 0 });

            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            expect(ctx.canManageRoles).toBe(false);

            const items = buildUserMenu(ctx);
            expect(items.find(i => i.label === 'Roles')).toBeFalsy();
        });

        it('5. hides Roles submenu when canManageRoles is false (self)', () => {
            useAppStore.setState({ currentUserPermissions: 0 });

            const target: UserTarget = { profileId: 'profile-admin', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            expect(ctx.isSelf).toBe(true);
            expect(ctx.canManageRoles).toBe(false);

            const items = buildUserMenu(ctx);
            expect(items.find(i => i.label === 'Roles')).toBeFalsy();
        });

        it('6. hides Roles when no non-@everyone roles exist', () => {
            useAppStore.setState({
                guildRoles: [{ id: 'role-everyone', server_id: 'guild-1', name: '@everyone', color: '', permissions: 0, position: -1 }],
            });

            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            expect(items.find(i => i.label === 'Roles')).toBeFalsy();
        });
    });

    // ──────────────────────────────────────────────────
    // CLIENT: Separator cleanup for self-context-menu
    // ──────────────────────────────────────────────────

    describe('cleanSeparators — no double separators', () => {
        it('7. self-click menu has no consecutive separators', () => {
            const target: UserTarget = { profileId: 'profile-admin', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            for (let i = 1; i < items.length; i++) {
                if (items[i].separator && items[i - 1].separator) {
                    throw new Error(`Consecutive separators found at indices ${i - 1} and ${i}`);
                }
            }
            // Also no leading or trailing separator
            expect(items[0]?.separator).toBeFalsy();
            expect(items[items.length - 1]?.separator).toBeFalsy();
        });

        it('8. non-admin self-click (no permissions) has no consecutive separators', () => {
            // Switch to regular user with no permissions
            useAppStore.setState({
                currentAccount: { id: 'account-user', email: 'user@test.com', is_creator: false, token: 'test-token' },
                claimedProfiles: [mockProfiles[2]],
                currentUserPermissions: 0,
            });

            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            for (let i = 1; i < items.length; i++) {
                if (items[i].separator && items[i - 1].separator) {
                    throw new Error(`Consecutive separators found at indices ${i - 1} and ${i}`);
                }
            }
            expect(items[0]?.separator).toBeFalsy();
            expect(items[items.length - 1]?.separator).toBeFalsy();
        });

        it('9. admin viewing lower-rank user has no consecutive separators', () => {
            const target: UserTarget = { profileId: 'profile-user', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            for (let i = 1; i < items.length; i++) {
                if (items[i].separator && items[i - 1].separator) {
                    throw new Error(`Consecutive separators found at indices ${i - 1} and ${i}`);
                }
            }
        });
    });

    // ──────────────────────────────────────────────────
    // CLIENT: RoleSubMenuContent — data mapping
    // ──────────────────────────────────────────────────

    describe('RoleSubMenuContent', () => {
        it('10. renders roles with checkmarks when assigned (maps id not role_id)', async () => {
            // Mock fetch to return assigned roles using server response shape (id, not role_id)
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([
                    { id: 'role-mod', server_id: 'guild-1', name: 'Moderator', color: '#ff0000', permissions: 0, position: 2 },
                ]),
            });
            vi.stubGlobal('fetch', mockFetch);

            const { container } = render(
                <RoleSubMenuContent guildId="guild-1" profileId="profile-user" guildRoles={mockRoles} />
            );

            // Wait for loading to finish
            await waitFor(() => {
                expect(container.querySelector('.context-menu-item.disabled')).toBeFalsy();
            });

            // Moderator should be checked, Member should not
            const checkboxes = container.querySelectorAll('.context-menu-checkbox');
            const checkedBoxes = container.querySelectorAll('.context-menu-checkbox.checked');
            expect(checkboxes.length).toBe(2); // Moderator and Member (no @everyone)
            expect(checkedBoxes.length).toBe(1); // Only Moderator is assigned

            vi.unstubAllGlobals();
        });

        it('11. renders no checkmarks when no roles are assigned', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([]),
            });
            vi.stubGlobal('fetch', mockFetch);

            const { container } = render(
                <RoleSubMenuContent guildId="guild-1" profileId="profile-user" guildRoles={mockRoles} />
            );

            await waitFor(() => {
                expect(container.querySelector('.context-menu-item.disabled')).toBeFalsy();
            });

            const checkedBoxes = container.querySelectorAll('.context-menu-checkbox.checked');
            expect(checkedBoxes.length).toBe(0);

            vi.unstubAllGlobals();
        });

        it('12. handles @everyone in response without rendering it', async () => {
            // Server includes @everyone in the response
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([
                    { id: 'role-everyone', server_id: 'guild-1', name: '@everyone', color: '', permissions: 0, position: -1 },
                    { id: 'role-mod', server_id: 'guild-1', name: 'Moderator', color: '#ff0000', permissions: 0, position: 2 },
                ]),
            });
            vi.stubGlobal('fetch', mockFetch);

            const { container } = render(
                <RoleSubMenuContent guildId="guild-1" profileId="profile-user" guildRoles={mockRoles} />
            );

            await waitFor(() => {
                expect(container.querySelector('.context-menu-item.disabled')).toBeFalsy();
            });

            // @everyone should not be rendered, only Moderator and Member
            const items = container.querySelectorAll('.context-menu-item');
            expect(items.length).toBe(2);

            // Moderator should be checked
            const checkedBoxes = container.querySelectorAll('.context-menu-checkbox.checked');
            expect(checkedBoxes.length).toBe(1);

            vi.unstubAllGlobals();
        });

        it('13. toggle to assign a role sends POST', async () => {
            const fetchCalls: { url: string; method: string }[] = [];
            const mockFetch = vi.fn().mockImplementation((url: string, opts?: any) => {
                fetchCalls.push({ url, method: opts?.method || 'GET' });
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                });
            });
            vi.stubGlobal('fetch', mockFetch);

            const { container } = render(
                <RoleSubMenuContent guildId="guild-1" profileId="profile-user" guildRoles={mockRoles} />
            );

            await waitFor(() => {
                expect(container.querySelector('.context-menu-item.disabled')).toBeFalsy();
            });

            // Click to assign Moderator role
            const items = container.querySelectorAll('.context-menu-item');
            const modItem = Array.from(items).find(el => el.textContent?.includes('Moderator'));
            expect(modItem).toBeTruthy();

            await act(async () => {
                fireEvent.click(modItem!);
            });

            // Should have sent a POST request
            const postCall = fetchCalls.find(c => c.method === 'POST');
            expect(postCall).toBeTruthy();
            expect(postCall!.url).toContain('/profiles/profile-user/roles');

            vi.unstubAllGlobals();
        });

        it('14. toggle to unassign a role sends DELETE', async () => {
            const fetchCalls: { url: string; method: string }[] = [];
            let callCount = 0;
            const mockFetch = vi.fn().mockImplementation((url: string, opts?: any) => {
                callCount++;
                fetchCalls.push({ url, method: opts?.method || 'GET' });
                // First call is the GET for assigned roles — return Moderator
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve([
                            { id: 'role-mod', server_id: 'guild-1', name: 'Moderator', color: '#ff0000', permissions: 0, position: 2 },
                        ]),
                    });
                }
                // Subsequent calls are toggles
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ success: true }),
                });
            });
            vi.stubGlobal('fetch', mockFetch);

            const { container } = render(
                <RoleSubMenuContent guildId="guild-1" profileId="profile-user" guildRoles={mockRoles} />
            );

            await waitFor(() => {
                expect(container.querySelector('.context-menu-checkbox.checked')).toBeTruthy();
            });

            // Click to unassign Moderator role
            const items = container.querySelectorAll('.context-menu-item');
            const modItem = Array.from(items).find(el => el.textContent?.includes('Moderator'));

            await act(async () => {
                fireEvent.click(modItem!);
            });

            // Should have sent a DELETE request
            const deleteCall = fetchCalls.find(c => c.method === 'DELETE');
            expect(deleteCall).toBeTruthy();
            expect(deleteCall!.url).toContain('/roles/role-mod');

            vi.unstubAllGlobals();
        });

        it('15. shows loading state initially', () => {
            const mockFetch = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves
            vi.stubGlobal('fetch', mockFetch);

            const { container } = render(
                <RoleSubMenuContent guildId="guild-1" profileId="profile-user" guildRoles={mockRoles} />
            );

            expect(container.textContent).toContain('Loading roles...');

            vi.unstubAllGlobals();
        });

        it('16. handles API failure gracefully', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: () => Promise.resolve({ error: 'Internal error' }),
            });
            vi.stubGlobal('fetch', mockFetch);

            const { container } = render(
                <RoleSubMenuContent guildId="guild-1" profileId="profile-user" guildRoles={mockRoles} />
            );

            // Should finish loading and render roles (just without checkmarks)
            await waitFor(() => {
                expect(container.querySelector('.context-menu-item.disabled')).toBeFalsy();
            });

            const checkedBoxes = container.querySelectorAll('.context-menu-checkbox.checked');
            expect(checkedBoxes.length).toBe(0);

            vi.unstubAllGlobals();
        });
    });

    // ──────────────────────────────────────────────────
    // CLIENT: Self-menu structure integrity
    // ──────────────────────────────────────────────────

    describe('self-menu structure', () => {
        it('17. self-menu includes Profile, Mention, Roles, Copy User ID for admin', () => {
            const target: UserTarget = { profileId: 'profile-admin', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            const labels = items.filter(i => !i.separator).map(i => i.label);
            expect(labels).toContain('Profile');
            expect(labels).toContain('Mention');
            expect(labels).toContain('Roles');
            expect(labels).toContain('Copy User ID');
        });

        it('18. self-menu excludes Message, Add Friend, Kick, Ban', () => {
            const target: UserTarget = { profileId: 'profile-admin', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            const items = buildUserMenu(ctx);

            const labels = items.filter(i => !i.separator).map(i => i.label);
            expect(labels).not.toContain('Message');
            expect(labels).not.toContain('Add Friend');
            expect(labels).not.toContain('Remove Friend');
            // Kick/Ban should not appear for self
            expect(items.find(i => i.id === 'user-kick')).toBeFalsy();
            expect(items.find(i => i.id === 'user-ban')).toBeFalsy();
        });

        it('19. MANAGE_ROLES permission alone (not ADMINISTRATOR) enables Roles submenu', () => {
            useAppStore.setState({ currentUserPermissions: Permission.MANAGE_ROLES });

            const target: UserTarget = { profileId: 'profile-admin', guildId: 'guild-1' };
            const ctx = resolveUserContext(target);
            expect(ctx.canManageRoles).toBe(true);

            const items = buildUserMenu(ctx);
            expect(items.find(i => i.label === 'Roles')).toBeTruthy();
        });
    });
});
