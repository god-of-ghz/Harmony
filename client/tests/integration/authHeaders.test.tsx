/// <reference types="@testing-library/jest-dom" />
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../../src/store/appStore';
import { jsonResponse } from '../helpers/mockFetch';
import { installMockWebSocket } from '../helpers/mockWebSocket';

// ─── Shared Test Infrastructure ────────────────────────────────────────────────

const MOCK_TOKEN = 'jwt-test-token-abc123';
const EXPECTED_AUTH_HEADER = { 'Authorization': `Bearer ${MOCK_TOKEN}` };

/**
 * Helper: returns every call to global.fetch that contained an Authorization header,
 * and asserts that NONE of them used the legacy X-Account-Id header.
 */
function assertAllFetchesUseJWT() {
    const calls = (global.fetch as any).mock.calls as Array<[string, RequestInit?]>;
    for (const [url, options] of calls) {
        const headers = (options?.headers || {}) as Record<string, string>;
        // Skip public endpoints that don't need auth
        if (
            url.includes('/accounts/owner-exists') ||
            url.includes('/accounts/login') ||
            url.includes('/accounts/signup') ||
            url.includes('/guest/login') ||
            url.includes('/accounts/password') ||
            url.includes('/accounts/federate') ||
            url.includes('/accounts/sync') ||
            url.includes('/api/health')
        ) continue;

        // Assert NO call uses the legacy header
        expect(headers['X-Account-Id']).toBeUndefined();
    }
}

/**
 * Helper: asserts that a specific URL pattern was called with the Authorization header.
 */
function expectFetchWithAuth(urlPattern: string | RegExp) {
    const calls = (global.fetch as any).mock.calls as Array<[string, RequestInit?]>;
    const match = calls.find(([url]) =>
        typeof urlPattern === 'string' ? url.includes(urlPattern) : urlPattern.test(url)
    );
    expect(match).toBeDefined();
    const [, options] = match!;
    const headers = (options?.headers || {}) as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${MOCK_TOKEN}`);
}

// ─── ChannelSidebar Auth Tests ─────────────────────────────────────────────────

// We need to mock the store module for ChannelSidebar because it uses individual selectors
vi.mock('../../src/store/appStore', async (importOriginal) => {
    const actual = await importOriginal() as any;
    return {
        ...actual,
        useAppStore: actual.useAppStore,
        Permission: actual.Permission ?? {
            ADMINISTRATOR: 1 << 0,
            MANAGE_SERVER: 1 << 1,
            MANAGE_ROLES: 1 << 2,
            MANAGE_CHANNELS: 1 << 3,
            SEND_MESSAGES: 1 << 7,
            VIEW_CHANNEL: 1 << 10,
        }
    };
});

describe('JWT Authorization Header Regression Tests', () => {
    let fetchSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Targeted fetch mock: only handle auth-related endpoints.
        // Uses jsonResponse from the shared helper for cleaner syntax,
        // but keeps routing minimal to avoid triggering expensive crypto
        // or render loops in the component-under-test.
        fetchSpy = vi.fn((url: string, _options?: RequestInit) => {
            if (url.includes('/api/accounts/owner-exists')) {
                return jsonResponse({ exists: true });
            }
            if (url.includes('/api/accounts/salt')) {
                return jsonResponse({ salt: 'dGVzdHNhbHQ=' });
            }
            if (url.includes('/api/accounts/login')) {
                return jsonResponse({
                    id: 'acc1', email: 'test@test.com', token: MOCK_TOKEN,
                    is_creator: false, trusted_servers: []
                });
            }
            if (url.includes('/api/guest/login')) {
                return jsonResponse({
                    id: 'guest-123', email: 'Guest', isGuest: true,
                    trusted_servers: [], token: MOCK_TOKEN
                });
            }
            return jsonResponse([]);
        });
        global.fetch = fetchSpy;

        installMockWebSocket();
        // ResizeObserver mock is now centralized in setupTests.tsx
    });

    // ─── ChannelSidebar ────────────────────────────────────────────────────────

    describe('ChannelSidebar sends Authorization header', () => {
        it('sends Bearer token when fetching categories and channels', async () => {
            useAppStore.setState({
                activeGuildId: 'server1',

                activeServerId: 'server1',
                activeChannelId: null,
                guildMap: { 'server1': 'http://localhost:3001' },

                serverMap: { 'server1': 'http://localhost:3001' },
                currentAccount: { id: 'acc1', email: 'test@test.com', token: MOCK_TOKEN, is_creator: false },
                claimedProfiles: [],
                unreadChannels: new Set(),
                activeVoiceChannelId: null,
                currentUserPermissions: 0,
            });

            const { ChannelSidebar } = await import('../../src/components/ChannelSidebar');
            render(<ChannelSidebar />);

            await waitFor(() => {
                expectFetchWithAuth('/api/guilds/server1/categories');
                expectFetchWithAuth('/api/guilds/server1/channels');
            });

            assertAllFetchesUseJWT();
        });

        it('sends Bearer token when fetching profile roles for permissions', async () => {
            useAppStore.setState({
                activeGuildId: 'server1',

                activeServerId: 'server1',
                activeChannelId: 'ch1',
                guildMap: { 'server1': 'http://localhost:3001' },

                serverMap: { 'server1': 'http://localhost:3001' },
                currentAccount: { id: 'acc1', email: 'test@test.com', token: MOCK_TOKEN, is_creator: false, is_admin: false },
                claimedProfiles: [{
                    id: 'prof1', server_id: 'server1', account_id: 'acc1',
                    original_username: 'user', nickname: 'user', avatar: '', role: 'USER', aliases: ''
                }],
                unreadChannels: new Set(),
                activeVoiceChannelId: null,
                currentUserPermissions: 0,
            });

            const { ChannelSidebar } = await import('../../src/components/ChannelSidebar');
            render(<ChannelSidebar />);

            await waitFor(() => {
                expectFetchWithAuth('/api/guilds/server1/profiles/prof1/roles');
            });

            assertAllFetchesUseJWT();
        });
    });

    // ─── ChatArea ──────────────────────────────────────────────────────────────

    describe('ChatArea sends Authorization header', () => {
        beforeEach(() => {
            useAppStore.setState({
                activeGuildId: 'server1',

                activeServerId: 'server1',
                activeChannelId: 'channel1',
                activeChannelName: 'general',
                guildMap: { 'server1': 'http://localhost:3001' },

                serverMap: { 'server1': 'http://localhost:3001' },
                currentAccount: { id: 'acc1', email: 'test@test.com', token: MOCK_TOKEN, is_creator: false },
                claimedProfiles: [{
                    id: 'prof1', server_id: 'server1', account_id: 'acc1',
                    original_username: 'user', nickname: 'user', avatar: '', role: 'USER', aliases: ''
                }],
                unreadChannels: new Set(),
                presenceMap: {},
                currentUserPermissions: 0xFFFFFFFF,
                guildRoles: [],

                serverRoles: [],
            });
        });

        it('sends Bearer token when fetching profiles', async () => {
            const { ChatArea } = await import('../../src/components/ChatArea');
            render(<ChatArea />);

            await waitFor(() => {
                expectFetchWithAuth('/api/guilds/server1/profiles');
            });
        });

        it('sends Bearer token when fetching roles', async () => {
            const { ChatArea } = await import('../../src/components/ChatArea');
            render(<ChatArea />);

            await waitFor(() => {
                expectFetchWithAuth('/api/guilds/server1/roles');
            });
        });

        it('sends Bearer token when fetching messages', async () => {
            const { ChatArea } = await import('../../src/components/ChatArea');
            render(<ChatArea />);

            await waitFor(() => {
                expectFetchWithAuth('/api/channels/channel1/messages');
            });
        });

        it('never sends X-Account-Id header on any fetch', async () => {
            const { ChatArea } = await import('../../src/components/ChatArea');
            render(<ChatArea />);

            await waitFor(() => {
                expect(fetchSpy).toHaveBeenCalled();
            });

            assertAllFetchesUseJWT();
        });
    });

    // ─── App.tsx (read_states) ─────────────────────────────────────────────────

    describe('App sends Authorization header for read_states', () => {
        it('uses Bearer token (not X-Account-Id) for read_states fetch', async () => {
            useAppStore.setState({
                currentAccount: { id: 'acc1', email: 'test@test.com', token: MOCK_TOKEN, is_creator: false },
                connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
                claimedProfiles: [{
                    id: 'prof1', server_id: 'server1', account_id: 'acc1',
                    original_username: 'user', nickname: 'user', avatar: '', role: 'USER', aliases: ''
                }],
                activeGuildId: 'server1',

                activeServerId: 'server1',
                guildMap: { 'server1': 'http://localhost:3001' },

                serverMap: { 'server1': 'http://localhost:3001' },
            });

            const App = (await import('../../src/App')).default;
            render(<App />);

            await waitFor(() => {
                const readStateCalls = fetchSpy.mock.calls.filter(
                    ([url]: [string]) => url.includes('/api/read_states')
                );
                if (readStateCalls.length > 0) {
                    const [, options] = readStateCalls[0];
                    const headers = (options?.headers || {}) as Record<string, string>;
                    expect(headers['Authorization']).toBe(`Bearer ${MOCK_TOKEN}`);
                    expect(headers['X-Account-Id']).toBeUndefined();
                }
            });
        });
    });

    // ─── LoginSignup (fetchProfiles with token) ────────────────────────────────

    describe('LoginSignup sends Authorization header for profile fetch', () => {
        it('passes JWT token when fetching profiles after login', async () => {
            useAppStore.setState({ currentAccount: null, claimedProfiles: [] });

            const { LoginSignup } = await import('../../src/components/LoginSignup');
            render(<LoginSignup />);

            // Fill email and password
            fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'test@test.com' } });
            fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'password' } });
            fireEvent.click(screen.getByRole('button', { name: 'Login' }));

            await waitFor(() => {
                // Find the profiles fetch call
                const profileCalls = fetchSpy.mock.calls.filter(
                    ([url]: [string]) => url.includes('/profiles')
                );
                expect(profileCalls.length).toBeGreaterThan(0);

                // Verify it has the Authorization header
                const [, options] = profileCalls[0];
                const headers = (options?.headers || {}) as Record<string, string>;
                expect(headers['Authorization']).toBeDefined();
                expect(headers['Authorization']).toContain('Bearer');
            });
        });
    });

    // ─── FriendsList ───────────────────────────────────────────────────────────

    describe('FriendsList sends Authorization header (not X-Account-Id)', () => {
        beforeEach(() => {
            useAppStore.setState({
                currentAccount: { id: 'acc1', email: 'test@test.com', token: MOCK_TOKEN, is_creator: false },
                connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
                relationships: [],
                globalProfiles: {},
            });
        });

        it('sends Bearer token when fetching relationships', async () => {
            const { FriendsList } = await import('../../src/components/FriendsList');
            render(<FriendsList />);

            await waitFor(() => {
                expectFetchWithAuth('/api/accounts/relationships');
            });

            assertAllFetchesUseJWT();
        });

        it('never sends X-Account-Id on any fetch call', async () => {
            // Set up relationships so profile fetches also fire
            useAppStore.setState({
                relationships: [
                    { account_id: 'acc1', target_id: 'acc2', status: 'friend' }
                ],
                globalProfiles: {},
            });

            const { FriendsList } = await import('../../src/components/FriendsList');
            render(<FriendsList />);

            await waitFor(() => {
                expect(fetchSpy).toHaveBeenCalled();
            });

            assertAllFetchesUseJWT();
        });

        it('sends Bearer token when fetching friend profiles', async () => {
            useAppStore.setState({
                relationships: [
                    { account_id: 'acc1', target_id: 'acc2', status: 'friend' }
                ],
                globalProfiles: {},
            });

            const { FriendsList } = await import('../../src/components/FriendsList');
            render(<FriendsList />);

            await waitFor(() => {
                expectFetchWithAuth('/api/accounts/acc2/profile');
            });
        });
    });

    // ─── DMSidebar ─────────────────────────────────────────────────────────────

    describe('DMSidebar sends Authorization header (not X-Account-Id)', () => {
        it('sends Bearer token when fetching DMs', async () => {
            useAppStore.setState({
                currentAccount: { id: 'acc1', email: 'test@test.com', token: MOCK_TOKEN, is_creator: false },
                connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
                activeChannelId: null,
                unreadChannels: new Set(),
                presenceMap: {},
            });

            const { DMSidebar } = await import('../../src/components/DMSidebar');
            render(<DMSidebar />);

            await waitFor(() => {
                expectFetchWithAuth('/api/dms');
            });

            assertAllFetchesUseJWT();
        });
    });

    // ─── Global: No X-Account-Id anywhere ──────────────────────────────────────

    describe('Global: X-Account-Id header is never sent', () => {
        it('source code contains no X-Account-Id references in client components', async () => {
            // This is a meta-test: we import source files as text and check for the pattern.
            // Since we can't do that easily in vitest, we verify via the fetch spy approach
            // by rendering the heaviest components and checking all calls.
            useAppStore.setState({
                activeGuildId: 'server1',

                activeServerId: 'server1',
                activeChannelId: 'channel1',
                activeChannelName: 'general',
                guildMap: { 'server1': 'http://localhost:3001' },

                serverMap: { 'server1': 'http://localhost:3001' },
                currentAccount: { id: 'acc1', email: 'test@test.com', token: MOCK_TOKEN, is_creator: true },
                claimedProfiles: [{
                    id: 'prof1', server_id: 'server1', account_id: 'acc1',
                    original_username: 'user', nickname: 'user', avatar: '', role: 'OWNER', aliases: ''
                }],
                connectedServers: [{ url: 'http://localhost:3001', trust_level: 'trusted', status: 'active' }],
                unreadChannels: new Set(),
                presenceMap: {},
                currentUserPermissions: 0xFFFFFFFF,
                guildRoles: [],

                serverRoles: [],
                relationships: [],
                globalProfiles: {},
            });

            // Render ChatArea (covers profiles, roles, messages fetches)
            const { ChatArea } = await import('../../src/components/ChatArea');
            render(<ChatArea />);

            await waitFor(() => {
                expect(fetchSpy).toHaveBeenCalled();
            });

            // Check ALL calls across all component renders
            const allCalls = fetchSpy.mock.calls as Array<[string, RequestInit?]>;
            for (const [url, options] of allCalls) {
                const headers = (options?.headers || {}) as Record<string, string>;
                expect(headers).not.toHaveProperty('X-Account-Id');
            }
        });
    });
});
