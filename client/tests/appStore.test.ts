import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../src/store/appStore';

describe('appStore', () => {
    beforeEach(() => {
        // Reset store before each test
        useAppStore.setState({
            knownServers: [],
            relationships: [],
            activeServerId: null,
            activeChannelId: null,
            activeChannelName: '',
            unreadChannels: new Set(),
        });
        localStorage.clear();
    });

    it('addKnownServer appends unique URLs and persists to localStorage', () => {
        const state = useAppStore.getState();
        
        state.addKnownServer('http://server1.com');
        expect(useAppStore.getState().knownServers).toContain('http://server1.com');
        expect(JSON.parse(localStorage.getItem('harmony_known_servers') || '[]')).toContain('http://server1.com');

        state.addKnownServer('http://server1.com'); // Duplicate
        expect(useAppStore.getState().knownServers.length).toBe(1);
    });

    it('updateRelationship merges status updates or removes none status', () => {
        const state = useAppStore.getState();
        const rel1 = { account_id: 'a', target_id: 'b', status: 'friend' as const, timestamp: 123 };
        
        state.updateRelationship(rel1);
        expect(useAppStore.getState().relationships).toContainEqual(rel1);

        const rel1Update = { account_id: 'a', target_id: 'b', status: 'blocked' as const, timestamp: 456 };
        state.updateRelationship(rel1Update);
        expect(useAppStore.getState().relationships).toContainEqual(rel1Update);
        expect(useAppStore.getState().relationships.length).toBe(1);

        state.updateRelationship({ account_id: 'a', target_id: 'b', status: 'none' as const, timestamp: 789 });
        expect(useAppStore.getState().relationships.length).toBe(0);
    });

    it('setActiveServerId clears activeChannelId and activeChannelName', () => {
        const state = useAppStore.getState();
        
        state.setActiveChannelId('chan1', 'General');
        expect(useAppStore.getState().activeChannelId).toBe('chan1');

        state.setActiveServerId('server1');
        expect(useAppStore.getState().activeChannelId).toBeNull();
        expect(useAppStore.getState().activeChannelName).toBe('');
    });

    it('addUnreadChannel and removeUnreadChannel modify the unreadChannels Set', () => {
        const state = useAppStore.getState();
        
        state.addUnreadChannel('chan1');
        expect(useAppStore.getState().unreadChannels.has('chan1')).toBe(true);

        state.removeUnreadChannel('chan1');
        expect(useAppStore.getState().unreadChannels.has('chan1')).toBe(false);
    });
});
