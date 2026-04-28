import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../../src/store/appStore';

describe('appStore — Federation Bug Regression Tests', () => {
    beforeEach(() => {
        useAppStore.setState({
            connectedServers: [],
            profilesLoaded: false,
            claimedProfiles: [],
        });
        localStorage.clear();
    });

    describe('connectedServers management', () => {
        it('setConnectedServers replaces the entire list in Zustand', () => {
            const state = useAppStore.getState();
            state.setConnectedServers([
                { url: 'http://server1.com', trust_level: 'trusted', status: 'active' },
                { url: 'http://server2.com', trust_level: 'untrusted', status: 'active' }
            ]);
            expect(useAppStore.getState().connectedServers).toHaveLength(2);
        });

        it('can update the entire list to replace servers (simulating remove)', () => {
            const state = useAppStore.getState();
            state.setConnectedServers([
                { url: 'http://server1.com', trust_level: 'trusted', status: 'active' },
                { url: 'http://server2.com', trust_level: 'trusted', status: 'active' }
            ]);
            expect(useAppStore.getState().connectedServers).toHaveLength(2);

            // Remove server1 by filtering
            const updated = useAppStore.getState().connectedServers.filter(s => s.url !== 'http://server1.com');
            state.setConnectedServers(updated);
            expect(useAppStore.getState().connectedServers).toHaveLength(1);
            expect(useAppStore.getState().connectedServers[0].url).toBe('http://server2.com');
        });

        it('handles setting an empty array (full disconnect)', () => {
            const state = useAppStore.getState();
            state.setConnectedServers([
                { url: 'http://server.com', trust_level: 'trusted', status: 'active' }
            ]);
            
            state.setConnectedServers([]);
            expect(useAppStore.getState().connectedServers).toEqual([]);
        });

        it('does NOT persist to localStorage (server-authoritative)', () => {
            const state = useAppStore.getState();
            state.setConnectedServers([
                { url: 'http://server.com', trust_level: 'trusted', status: 'active' }
            ]);

            expect(localStorage.getItem('harmony_connected_servers')).toBeNull();
            expect(localStorage.getItem('harmony_known_servers')).toBeNull();
            expect(localStorage.getItem('harmony_trusted_servers')).toBeNull();
        });
    });

    describe('profilesLoaded flag', () => {
        it('defaults to false', () => {
            expect(useAppStore.getState().profilesLoaded).toBe(false);
        });

        it('can be set to true', () => {
            useAppStore.getState().setProfilesLoaded(true);
            expect(useAppStore.getState().profilesLoaded).toBe(true);
        });

        it('can be reset back to false (for logout)', () => {
            useAppStore.getState().setProfilesLoaded(true);
            expect(useAppStore.getState().profilesLoaded).toBe(true);

            useAppStore.getState().setProfilesLoaded(false);
            expect(useAppStore.getState().profilesLoaded).toBe(false);
        });
    });

    describe('connectedServers trust_level separation', () => {
        it('a server can have trust_level=untrusted', () => {
            const state = useAppStore.getState();
            state.setConnectedServers([
                { url: 'http://untrusted.com', trust_level: 'untrusted', status: 'active' }
            ]);

            const s = useAppStore.getState();
            expect(s.connectedServers[0].trust_level).toBe('untrusted');
        });

        it('changing trust_level from trusted to untrusted keeps the server in the list', () => {
            const state = useAppStore.getState();
            state.setConnectedServers([
                { url: 'http://server.com', trust_level: 'trusted', status: 'active' }
            ]);

            // "Untrust" — update trust_level but keep in connectedServers
            const updated = useAppStore.getState().connectedServers.map(s =>
                s.url === 'http://server.com' ? { ...s, trust_level: 'untrusted' as const } : s
            );
            state.setConnectedServers(updated);

            const s = useAppStore.getState();
            expect(s.connectedServers).toHaveLength(1);
            expect(s.connectedServers[0].trust_level).toBe('untrusted');
        });

        it('removing a server from connectedServers fully disconnects it', () => {
            const state = useAppStore.getState();
            state.setConnectedServers([
                { url: 'http://server.com', trust_level: 'trusted', status: 'active' }
            ]);

            // Full disconnect
            state.setConnectedServers([]);
            expect(useAppStore.getState().connectedServers).toEqual([]);
        });
    });
});
