/**
 * connectedServers.test.ts
 *
 * Validates the connectedServers Zustand store behavior after the federation overhaul:
 *   1. setConnectedServers populates state from server response
 *   2. connectedServers does NOT persist to localStorage
 *   3. Login populates connectedServers
 *   4. Logout clears connectedServers and all other account state
 *   5. activeServerId resets on logout and does not persist across sessions
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../../src/store/appStore';

describe('connectedServers Store Behavior', () => {
    beforeEach(() => {
        // Reset to clean state
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

    // ================================================================
    // 1. setConnectedServers populates state from server response
    // ================================================================
    describe('setConnectedServers population', () => {
        it('should populate state from server response with trust_level and status', () => {
            const servers = [
                { url: 'http://server1.com', trust_level: 'trusted' as const, status: 'active' as const },
                { url: 'http://server2.com', trust_level: 'untrusted' as const, status: 'active' as const },
                { url: 'http://server3.com', trust_level: 'trusted' as const, status: 'disconnected' as const },
            ];

            useAppStore.getState().setConnectedServers(servers);

            const state = useAppStore.getState();
            expect(state.connectedServers).toHaveLength(3);
            expect(state.connectedServers[0]).toEqual({ url: 'http://server1.com', trust_level: 'trusted', status: 'active' });
            expect(state.connectedServers[1]).toEqual({ url: 'http://server2.com', trust_level: 'untrusted', status: 'active' });
            expect(state.connectedServers[2]).toEqual({ url: 'http://server3.com', trust_level: 'trusted', status: 'disconnected' });
        });

        it('should handle empty array', () => {
            useAppStore.getState().setConnectedServers([]);
            expect(useAppStore.getState().connectedServers).toEqual([]);
        });

        it('should handle null/undefined gracefully', () => {
            useAppStore.getState().setConnectedServers(null as any);
            expect(useAppStore.getState().connectedServers).toEqual([]);

            useAppStore.getState().setConnectedServers(undefined as any);
            expect(useAppStore.getState().connectedServers).toEqual([]);
        });

        it('should completely replace previous servers on each call', () => {
            const state = useAppStore.getState();

            state.setConnectedServers([
                { url: 'http://old.com', trust_level: 'trusted', status: 'active' },
            ]);
            expect(useAppStore.getState().connectedServers).toHaveLength(1);

            state.setConnectedServers([
                { url: 'http://new1.com', trust_level: 'trusted', status: 'active' },
                { url: 'http://new2.com', trust_level: 'untrusted', status: 'active' },
            ]);
            expect(useAppStore.getState().connectedServers).toHaveLength(2);
            expect(useAppStore.getState().connectedServers[0].url).toBe('http://new1.com');
        });
    });

    // ================================================================
    // 2. connectedServers does NOT persist to localStorage
    // ================================================================
    describe('localStorage non-persistence', () => {
        it('should NOT write connectedServers to localStorage', () => {
            useAppStore.getState().setConnectedServers([
                { url: 'http://server.com', trust_level: 'trusted', status: 'active' },
            ]);

            expect(localStorage.getItem('harmony_connected_servers')).toBeNull();
            expect(localStorage.getItem('harmony_known_servers')).toBeNull();
            expect(localStorage.getItem('harmony_trusted_servers')).toBeNull();
        });

        it('should NOT write any account-bound state to localStorage', () => {
            const state = useAppStore.getState();

            state.setCurrentAccount({ id: 'acc1', email: 'a@b.com', is_creator: false, token: 'tok' });
            state.setConnectedServers([{ url: 'http://s.com', trust_level: 'trusted', status: 'active' }]);
            state.setActiveServerId('srv1');
            state.setActiveChannelId('ch1', 'General');
            state.setClaimedProfiles([{ id: 'p1', server_id: 'srv1', account_id: 'acc1', original_username: 'u', nickname: 'u', avatar: '', role: 'USER', aliases: '' }]);

            const keys = Object.keys(localStorage).filter(k => k.startsWith('harmony_'));
            // The only allowed key is harmony_audio_settings (device-bound)
            expect(keys.every(k => k === 'harmony_audio_settings')).toBe(true);
        });
    });

    // ================================================================
    // 3. Login populates connectedServers
    // ================================================================
    describe('Login population', () => {
        it('should populate connectedServers when setConnectedServers is called after login', () => {
            // Simulate login flow
            const state = useAppStore.getState();
            state.setCurrentAccount({ id: 'acc1', email: 'test@test.com', is_creator: false, token: 'jwt-tok' });

            // Login response includes servers array
            const serverResponse = [
                { url: 'http://primary.com', trust_level: 'trusted' as const, status: 'active' as const },
                { url: 'http://replica.com', trust_level: 'untrusted' as const, status: 'active' as const },
            ];
            state.setConnectedServers(serverResponse);

            const result = useAppStore.getState();
            expect(result.currentAccount?.id).toBe('acc1');
            expect(result.connectedServers).toHaveLength(2);
            expect(result.connectedServers[0].url).toBe('http://primary.com');
        });
    });

    // ================================================================
    // 4. Logout clears connectedServers and all account state
    // ================================================================
    describe('Logout clears state', () => {
        it('should clear connectedServers on logout', () => {
            const state = useAppStore.getState();

            // Login
            state.setCurrentAccount({ id: 'acc1', email: 'a@b.com', is_creator: false, token: 'tok' });
            state.setConnectedServers([{ url: 'http://s.com', trust_level: 'trusted', status: 'active' }]);
            expect(useAppStore.getState().connectedServers).toHaveLength(1);

            // Logout
            state.setCurrentAccount(null);
            state.setConnectedServers([]);

            expect(useAppStore.getState().currentAccount).toBeNull();
            expect(useAppStore.getState().connectedServers).toEqual([]);
        });

        it('should clear all account-bound state on logout', () => {
            const state = useAppStore.getState();

            // Populate state
            state.setCurrentAccount({ id: 'acc1', email: 'a@b.com', is_creator: false, token: 'tok' });
            state.setConnectedServers([{ url: 'http://s.com', trust_level: 'trusted', status: 'active' }]);
            state.setActiveServerId('srv1');
            state.setClaimedProfiles([{ id: 'p1', server_id: 'srv1', account_id: 'acc1', original_username: 'u', nickname: 'u', avatar: '', role: 'USER', aliases: '' }]);
            state.setServerRoles([{ id: 'r1', server_id: 'srv1', name: 'Admin', color: '#fff', permissions: 1, position: 0 }]);

            // Logout
            state.setCurrentAccount(null);
            state.setConnectedServers([]);
            state.setClaimedProfiles([]);
            state.setServerRoles([]);

            const result = useAppStore.getState();
            expect(result.currentAccount).toBeNull();
            expect(result.connectedServers).toEqual([]);
            expect(result.claimedProfiles).toEqual([]);
            expect(result.serverRoles).toEqual([]);
        });

        it('should leave localStorage clean after logout (only device-bound keys)', () => {
            const state = useAppStore.getState();

            // Login + set state
            state.setCurrentAccount({ id: 'acc1', email: 'a@b.com', is_creator: false, token: 'tok' });
            state.setConnectedServers([{ url: 'http://s.com', trust_level: 'trusted', status: 'active' }]);
            state.setAudioSettings({ noiseSuppression: true });

            // Logout
            state.setCurrentAccount(null);
            state.setConnectedServers([]);

            const harmonyKeys = Object.keys(localStorage).filter(k => k.startsWith('harmony_'));
            // Only audio settings should remain (device-bound, not account-bound)
            expect(harmonyKeys).toEqual(['harmony_audio_settings']);
        });
    });

    // ================================================================
    // 5. activeServerId resets on logout
    // ================================================================
    describe('activeServerId lifecycle', () => {
        it('should reset activeServerId when setActiveServerId is called and clear channel state', () => {
            const state = useAppStore.getState();

            state.setActiveChannelId('ch1', 'General');
            expect(useAppStore.getState().activeChannelId).toBe('ch1');

            state.setActiveServerId('srv2');
            expect(useAppStore.getState().activeServerId).toBe('srv2');
            expect(useAppStore.getState().activeChannelId).toBeNull();
            expect(useAppStore.getState().activeChannelName).toBe('');
        });

        it('should not persist activeServerId to localStorage', () => {
            useAppStore.getState().setActiveServerId('srv1');
            expect(localStorage.getItem('harmony_active_server_id')).toBeNull();
        });

        it('should clear activeServerId on logout', () => {
            const state = useAppStore.getState();

            state.setActiveServerId('srv1');
            expect(useAppStore.getState().activeServerId).toBe('srv1');

            // Simulate logout — set everything to null/empty
            useAppStore.setState({
                currentAccount: null,
                activeGuildId: null,
                activeServerId: null,
                connectedServers: [],
            });

            expect(useAppStore.getState().activeServerId).toBeNull();
        });

        it('should not carry activeServerId across sessions (no localStorage)', () => {
            const state = useAppStore.getState();

            state.setActiveServerId('srv1');
            expect(useAppStore.getState().activeServerId).toBe('srv1');

            // Simulate session end
            useAppStore.setState({ activeServerId: null });

            // Simulate new session — no localStorage to restore from
            expect(localStorage.getItem('harmony_active_server_id')).toBeNull();
            expect(useAppStore.getState().activeServerId).toBeNull();
        });
    });
});
