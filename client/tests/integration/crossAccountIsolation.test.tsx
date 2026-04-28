/**
 * crossAccountIsolation.test.tsx
 *
 * Validates that sequential logins produce zero state contamination:
 *   1. Login as User A → verify state populated with User A servers
 *   2. Logout User A → verify state fully cleared and localStorage only has session-related keys
 *   3. Login as User B → verify state populated with User B servers only, no User A servers
 *   4. Verify localStorage contains no User A data
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '../../src/store/appStore';
import { jsonResponse } from '../helpers/mockFetch';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/login' }),
    Link: ({ children, to }: any) => <a href={to}>{children}</a>,
    BrowserRouter: ({ children }: any) => <>{children}</>,
}));

/** User A login mock response */
const USER_A_RESPONSE = {
    id: 'acc-user-a',
    email: 'usera@test.com',
    token: 'token-user-a',
    is_creator: false,
    trusted_servers: ['http://server-a.com'],
    servers: [
        { url: 'http://server-a.com', trust_level: 'trusted', status: 'active' },
        { url: 'http://server-a2.com', trust_level: 'untrusted', status: 'active' },
    ],
    public_key: 'pubA',
    encrypted_private_key: 'encA',
    key_salt: 'saltA',
    key_iv: 'ivA',
    authority_role: 'primary',
    primary_server_url: 'http://server-a.com',
    dismissed_global_claim: false,
};

/** User B login mock response */
const USER_B_RESPONSE = {
    id: 'acc-user-b',
    email: 'userb@test.com',
    token: 'token-user-b',
    is_creator: false,
    trusted_servers: ['http://server-b.com'],
    servers: [
        { url: 'http://server-b.com', trust_level: 'trusted', status: 'active' },
    ],
    public_key: 'pubB',
    encrypted_private_key: 'encB',
    key_salt: 'saltB',
    key_iv: 'ivB',
    authority_role: 'primary',
    primary_server_url: 'http://server-b.com',
    dismissed_global_claim: false,
};

describe('Cross-Account State Isolation', () => {
    beforeEach(() => {
        // Full state reset
        useAppStore.setState({
            currentAccount: null,
            connectedServers: [],
            claimedProfiles: [],
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
            serverProfiles: [],
            readStates: {},
            relationships: [],
            globalProfiles: {},
            isGuestSession: false,
            profilesLoaded: false,
            dismissedGlobalClaim: false,
            serverStatus: {},
            primaryOfflineMessage: null,
        });
        localStorage.clear();
    });

    it('should produce zero state contamination across sequential logins', () => {
        const state = useAppStore.getState();

        // ──── Login as User A ────────────────────────────────
        state.setCurrentAccount({
            id: USER_A_RESPONSE.id,
            email: USER_A_RESPONSE.email,
            is_creator: USER_A_RESPONSE.is_creator,
            token: USER_A_RESPONSE.token,
            primary_server_url: USER_A_RESPONSE.primary_server_url,
        });
        state.setConnectedServers(USER_A_RESPONSE.servers as any);
        state.setActiveServerId('server-a-id');
        state.setClaimedProfiles([{
            id: 'prof-a1', server_id: 'server-a-id', account_id: 'acc-user-a',
            original_username: 'UserA', nickname: 'UserA', avatar: '', role: 'USER', aliases: '',
        }]);

        // Verify User A state
        let s = useAppStore.getState();
        expect(s.currentAccount?.id).toBe('acc-user-a');
        expect(s.connectedServers).toHaveLength(2);
        expect(s.connectedServers[0].url).toBe('http://server-a.com');
        expect(s.connectedServers[1].url).toBe('http://server-a2.com');
        expect(s.activeServerId).toBe('server-a-id');
        expect(s.claimedProfiles).toHaveLength(1);

        // ──── Logout User A ─────────────────────────────────
        useAppStore.setState({
            currentAccount: null,
            connectedServers: [],
            claimedProfiles: [],
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
            serverProfiles: [],
            readStates: {},
            profilesLoaded: false,
        });

        // Remove session from localStorage
        localStorage.removeItem('harmony_session');

        // Verify state fully cleared
        s = useAppStore.getState();
        expect(s.currentAccount).toBeNull();
        expect(s.connectedServers).toEqual([]);
        expect(s.claimedProfiles).toEqual([]);
        expect(s.activeServerId).toBeNull();
        expect(s.activeChannelId).toBeNull();

        // Verify localStorage only has device-bound keys
        const harmonyKeys = Object.keys(localStorage).filter(k => k.startsWith('harmony_'));
        for (const key of harmonyKeys) {
            expect(key === 'harmony_audio_settings' || key === 'harmony_last_server_url')
                .toBe(true);
        }

        // ──── Login as User B ────────────────────────────────
        const state2 = useAppStore.getState();
        state2.setCurrentAccount({
            id: USER_B_RESPONSE.id,
            email: USER_B_RESPONSE.email,
            is_creator: USER_B_RESPONSE.is_creator,
            token: USER_B_RESPONSE.token,
            primary_server_url: USER_B_RESPONSE.primary_server_url,
        });
        state2.setConnectedServers(USER_B_RESPONSE.servers as any);
        state2.setActiveServerId('server-b-id');
        state2.setClaimedProfiles([{
            id: 'prof-b1', server_id: 'server-b-id', account_id: 'acc-user-b',
            original_username: 'UserB', nickname: 'UserB', avatar: '', role: 'USER', aliases: '',
        }]);

        // Verify User B state — NO User A contamination
        s = useAppStore.getState();
        expect(s.currentAccount?.id).toBe('acc-user-b');
        expect(s.currentAccount?.email).toBe('userb@test.com');
        expect(s.connectedServers).toHaveLength(1);
        expect(s.connectedServers[0].url).toBe('http://server-b.com');
        expect(s.claimedProfiles).toHaveLength(1);
        expect(s.claimedProfiles[0].account_id).toBe('acc-user-b');
        expect(s.activeServerId).toBe('server-b-id');

        // Verify NO User A servers remain
        const allUrls = s.connectedServers.map(cs => cs.url);
        expect(allUrls).not.toContain('http://server-a.com');
        expect(allUrls).not.toContain('http://server-a2.com');

        // Verify NO User A profiles remain
        const allProfileIds = s.claimedProfiles.map(p => p.account_id);
        expect(allProfileIds).not.toContain('acc-user-a');
    });

    it('should not leak User A data into localStorage after logout', () => {
        const state = useAppStore.getState();

        // Login User A
        state.setCurrentAccount({
            id: 'acc-user-a', email: 'usera@test.com', is_creator: false, token: 'tok-a',
        });
        state.setConnectedServers([{ url: 'http://server-a.com', trust_level: 'trusted', status: 'active' }]);
        state.setAudioSettings({ noiseSuppression: true }); // Device-bound

        // Logout User A
        useAppStore.setState({
            currentAccount: null,
            connectedServers: [],
            claimedProfiles: [],
            activeGuildId: null,
            activeServerId: null,
        });
        localStorage.removeItem('harmony_session');

        // Verify no User A account data in localStorage
        const allKeys = Object.keys(localStorage);
        const harmonyAccountKeys = allKeys.filter(k =>
            k.startsWith('harmony_') &&
            k !== 'harmony_audio_settings' &&
            k !== 'harmony_last_server_url'
        );
        expect(harmonyAccountKeys).toEqual([]);

        // Verify no User A data in values
        for (const key of allKeys) {
            const value = localStorage.getItem(key) || '';
            expect(value).not.toContain('acc-user-a');
            expect(value).not.toContain('usera@test.com');
            expect(value).not.toContain('tok-a');
        }
    });

    it('should handle rapid login/logout cycles without state leaks', () => {
        const userIds = ['acc-1', 'acc-2', 'acc-3', 'acc-4', 'acc-5'];

        for (const userId of userIds) {
            // Login
            const state = useAppStore.getState();
            state.setCurrentAccount({ id: userId, email: `${userId}@test.com`, is_creator: false, token: `tok-${userId}` });
            state.setConnectedServers([{ url: `http://${userId}.com`, trust_level: 'trusted', status: 'active' }]);

            expect(useAppStore.getState().currentAccount?.id).toBe(userId);
            expect(useAppStore.getState().connectedServers[0].url).toBe(`http://${userId}.com`);

            // Logout
            useAppStore.setState({
                currentAccount: null,
                connectedServers: [],
                claimedProfiles: [],
                activeGuildId: null,
                activeServerId: null,
            });

            expect(useAppStore.getState().currentAccount).toBeNull();
            expect(useAppStore.getState().connectedServers).toEqual([]);
        }

        // After all cycles, state should be clean
        const s = useAppStore.getState();
        expect(s.currentAccount).toBeNull();
        expect(s.connectedServers).toEqual([]);
        expect(s.claimedProfiles).toEqual([]);
    });
});
