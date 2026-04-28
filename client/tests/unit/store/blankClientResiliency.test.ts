import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../../src/store/appStore';

describe('appStore Resiliency', () => {
    beforeEach(() => {
        localStorage.clear();
        // Reset store manually to initial state
        useAppStore.setState({
            connectedServers: [],
            claimedProfiles: [],
        });
    });

    it('initializes connectedServers as empty array by default', () => {
        const { connectedServers } = useAppStore.getState();
        expect(Array.isArray(connectedServers)).toBe(true);
        expect(connectedServers).toEqual([]);
    });

    it('setConnectedServers forces input to be an array', () => {
        const { setConnectedServers } = useAppStore.getState();
        
        (setConnectedServers as any)(null);
        expect(useAppStore.getState().connectedServers).toEqual([]);

        (setConnectedServers as any)(undefined);
        expect(useAppStore.getState().connectedServers).toEqual([]);

        (setConnectedServers as any)({ not: 'an-array' });
        expect(useAppStore.getState().connectedServers).toEqual([]);

        setConnectedServers([{ url: 'http://server1.com', trust_level: 'trusted', status: 'active' }]);
        expect(useAppStore.getState().connectedServers).toHaveLength(1);
    });

    it('setConnectedServers is resilient to connectedServers being null/corrupted', () => {
        // Force state to an invalid one (simulating corruption)
        useAppStore.setState({ connectedServers: null as any });
        
        const { setConnectedServers } = useAppStore.getState();
        
        // This should not throw
        setConnectedServers([{ url: 'http://new.com', trust_level: 'trusted', status: 'active' }]);
        expect(useAppStore.getState().connectedServers).toHaveLength(1);
    });

    it('connectedServers does NOT persist to localStorage', () => {
        const { setConnectedServers } = useAppStore.getState();
        setConnectedServers([
            { url: 'http://server.com', trust_level: 'trusted', status: 'active' },
        ]);

        // No account-bound state in localStorage
        expect(localStorage.getItem('harmony_known_servers')).toBeNull();
        expect(localStorage.getItem('harmony_trusted_servers')).toBeNull();
        expect(localStorage.getItem('harmony_connected_servers')).toBeNull();
    });
});
