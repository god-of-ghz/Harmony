/**
 * Shared Zustand store fixtures for Harmony client tests.
 *
 * Many test files manually construct the same appStore state shapes
 * (logged-in user, guest, multi-server) with slight variations.
 * These presets provide consistent base states that can be extended
 * via spread/overrides.
 *
 * Usage:
 *   import { loggedInState } from './helpers/storeFixtures';
 *   import { useAppStore } from '../src/store/appStore';
 *
 *   beforeEach(() => {
 *     useAppStore.setState(loggedInState());
 *     // Or with overrides:
 *     useAppStore.setState(loggedInState({ currentUserPermissions: 0 }));
 *   });
 */

import { MOCK_TOKEN, MOCK_ACCOUNT_ID } from './mockFetch';

/** Re-export for convenience — tests often need the token for assertions. */
export { MOCK_TOKEN, MOCK_ACCOUNT_ID };

/** Default server URL used across fixtures. */
export const MOCK_SERVER_URL = 'http://localhost:3001';

/** Default server ID used across fixtures. */
export const MOCK_SERVER_ID = 'server1';

/** Default channel ID used across fixtures. */
export const MOCK_CHANNEL_ID = 'channel1';

/** Default profile ID used across fixtures. */
export const MOCK_PROFILE_ID = 'prof1';

/**
 * Returns a state snapshot representing a fully logged-in user with
 * one server, one profile, and full admin permissions (0xFFFFFFFF).
 *
 * This is the "happy path" state used by most component tests.
 */
export function loggedInState(overrides: Record<string, any> = {}) {
    return {
        currentAccount: {
            id: MOCK_ACCOUNT_ID,
            email: 'test@test.com',
            token: MOCK_TOKEN,
            is_creator: false,
        },
        activeGuildId: MOCK_SERVER_ID,
        activeServerId: MOCK_SERVER_ID,
        activeChannelId: MOCK_CHANNEL_ID,
        activeChannelName: 'general',
        guildMap: { [MOCK_SERVER_ID]: MOCK_SERVER_URL },
        serverMap: { [MOCK_SERVER_ID]: MOCK_SERVER_URL },
        claimedProfiles: [{
            id: MOCK_PROFILE_ID,
            server_id: MOCK_SERVER_ID,
            account_id: MOCK_ACCOUNT_ID,
            original_username: 'user',
            nickname: 'user',
            avatar: '',
            role: 'USER',
            aliases: '',
        }],
        connectedServers: [{ url: MOCK_SERVER_URL, trust_level: 'trusted', status: 'active' }],
        unreadChannels: new Set(),
        presenceMap: {},
        currentUserPermissions: 0xFFFFFFFF, // Full permissions
        guildRoles: [],
        serverRoles: [],
        ...overrides,
    };
}

/**
 * Returns a state snapshot for a guest session.
 * Guests have no claimed profiles and limited permissions.
 */
export function guestState(overrides: Record<string, any> = {}) {
    return {
        currentAccount: {
            id: 'guest-123',
            email: 'Guest',
            isGuest: true,
            token: MOCK_TOKEN,
            is_creator: false,
        },
        activeGuildId: MOCK_SERVER_ID,
        activeServerId: MOCK_SERVER_ID,
        activeChannelId: MOCK_CHANNEL_ID,
        activeChannelName: 'general',
        guildMap: { [MOCK_SERVER_ID]: MOCK_SERVER_URL },
        serverMap: { [MOCK_SERVER_ID]: MOCK_SERVER_URL },
        claimedProfiles: [],
        connectedServers: [{ url: MOCK_SERVER_URL, trust_level: 'trusted', status: 'active' }],
        unreadChannels: new Set(),
        presenceMap: {},
        currentUserPermissions: 0,
        guildRoles: [],
        serverRoles: [],
        ...overrides,
    };
}

/**
 * Returns a state snapshot for a user connected to multiple federated servers.
 * Useful for testing federation-specific UI (ServerSidebar, profile dedup, etc).
 */
export function multiServerState(overrides: Record<string, any> = {}) {
    return {
        currentAccount: {
            id: MOCK_ACCOUNT_ID,
            email: 'test@test.com',
            token: MOCK_TOKEN,
            is_creator: false,
        },
        activeGuildId: MOCK_SERVER_ID,
        activeServerId: MOCK_SERVER_ID,
        activeChannelId: MOCK_CHANNEL_ID,
        activeChannelName: 'general',
        guildMap: {
            [MOCK_SERVER_ID]: MOCK_SERVER_URL,
            'server2': 'http://localhost:3002',
        },
        serverMap: {
            [MOCK_SERVER_ID]: MOCK_SERVER_URL,
            'server2': 'http://localhost:3002',
        },
        claimedProfiles: [
            {
                id: MOCK_PROFILE_ID,
                server_id: MOCK_SERVER_ID,
                account_id: MOCK_ACCOUNT_ID,
                original_username: 'user',
                nickname: 'user',
                avatar: '',
                role: 'USER',
                aliases: '',
            },
            {
                id: 'prof2',
                server_id: 'server2',
                account_id: MOCK_ACCOUNT_ID,
                original_username: 'user',
                nickname: 'user-on-server2',
                avatar: '',
                role: 'USER',
                aliases: '',
            },
        ],
        connectedServers: [
            { url: MOCK_SERVER_URL, trust_level: 'trusted', status: 'active' },
            { url: 'http://localhost:3002', trust_level: 'untrusted', status: 'active' }
        ],
        unreadChannels: new Set(),
        presenceMap: {},
        currentUserPermissions: 0xFFFFFFFF,
        guildRoles: [],
        serverRoles: [],
        ...overrides,
    };
}

/**
 * Returns a minimal empty/unauthenticated state.
 * Useful for testing login screens and auth transitions.
 */
export function emptyState(overrides: Record<string, any> = {}) {
    return {
        currentAccount: null,
        claimedProfiles: [],
        connectedServers: [],
        activeGuildId: null,
        activeServerId: null,
        activeChannelId: null,
        activeChannelName: '',
        guildMap: {},
        serverMap: {},
        unreadChannels: new Set(),
        presenceMap: {},
        currentUserPermissions: 0,
        guildRoles: [],
        serverRoles: [],
        ...overrides,
    };
}
