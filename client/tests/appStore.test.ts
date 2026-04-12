import { describe, it, expect, beforeEach, vi } from 'vitest';
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
            emojis: {},
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

    it('setActiveServerId clears activeChannelId and activeChannelName and persists to localStorage', () => {
        const state = useAppStore.getState();
        
        state.setActiveChannelId('chan1', 'General');
        expect(useAppStore.getState().activeChannelId).toBe('chan1');
        expect(localStorage.getItem('harmony_active_channel_id')).toBe('chan1');

        state.setActiveServerId('server1');
        expect(useAppStore.getState().activeServerId).toBe('server1');
        expect(localStorage.getItem('harmony_active_server_id')).toBe('server1');
        expect(useAppStore.getState().activeChannelId).toBeNull();
        expect(localStorage.getItem('harmony_active_channel_id')).toBeNull();
        expect(useAppStore.getState().activeChannelName).toBe('');
    });

    it('setActiveChannelId persists to localStorage', () => {
        const state = useAppStore.getState();
        
        state.setActiveChannelId('chan2', 'ChitChat');
        expect(useAppStore.getState().activeChannelId).toBe('chan2');
        expect(useAppStore.getState().activeChannelName).toBe('ChitChat');
        expect(localStorage.getItem('harmony_active_channel_id')).toBe('chan2');
        expect(localStorage.getItem('harmony_active_channel_name')).toBe('ChitChat');
    });

    it('addUnreadChannel and removeUnreadChannel modify the unreadChannels Set', () => {
        const state = useAppStore.getState();
        
        state.addUnreadChannel('chan1');
        expect(useAppStore.getState().unreadChannels.has('chan1')).toBe(true);

        state.removeUnreadChannel('chan1');
        expect(useAppStore.getState().unreadChannels.has('chan1')).toBe(false);
    });

    it('fetchServerEmojis fetches and caches emojis', async () => {
        const mockEmojis = [
            { id: '1', server_id: 'server1', name: 'cool_emoji', url: 'http://example.com/1.png', animated: false }
        ];

        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockEmojis
        });
        vi.stubGlobal('fetch', mockFetch);

        useAppStore.setState({
            currentAccount: { id: 'acc1', email: 'a@a.com', is_creator: false, token: 'fake-token' },
            emojis: {}
        });

        const state = useAppStore.getState();
        await state.fetchServerEmojis('server1');

        expect(mockFetch).toHaveBeenCalledWith('/api/servers/server1/emojis', expect.objectContaining({
            headers: { 'Authorization': 'Bearer fake-token' }
        }));
        expect(useAppStore.getState().emojis['server1']).toEqual(mockEmojis);

        // Test caching: call again, should not fetch
        await state.fetchServerEmojis('server1');
        expect(mockFetch).toHaveBeenCalledTimes(1);

        vi.unstubAllGlobals();
    });
});
