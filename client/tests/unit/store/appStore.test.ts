import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../../src/store/appStore';

describe('appStore', () => {
    beforeEach(() => {
        // Reset store before each test
        useAppStore.setState({
            connectedServers: [],
            relationships: [],
            activeGuildId: null,
            activeServerId: null,
            activeChannelId: null,
            activeChannelName: '',
            unreadChannels: new Set(),
            emojis: {},
        });
        localStorage.clear();
    });

    it('setConnectedServers stores server list in Zustand (no localStorage)', () => {
        const state = useAppStore.getState();
        
        state.setConnectedServers([
            { url: 'http://server1.com', trust_level: 'trusted', status: 'active' },
            { url: 'http://server2.com', trust_level: 'untrusted', status: 'active' }
        ]);
        expect(useAppStore.getState().connectedServers).toHaveLength(2);
        expect(useAppStore.getState().connectedServers[0].url).toBe('http://server1.com');
        expect(useAppStore.getState().connectedServers[0].trust_level).toBe('trusted');

        // Verify NO localStorage persistence (server-authoritative)
        expect(localStorage.getItem('harmony_connected_servers')).toBeNull();
        expect(localStorage.getItem('harmony_known_servers')).toBeNull();
        expect(localStorage.getItem('harmony_trusted_servers')).toBeNull();
    });

    it('setConnectedServers handles non-array input gracefully', () => {
        const state = useAppStore.getState();

        state.setConnectedServers(null as any);
        expect(useAppStore.getState().connectedServers).toEqual([]);

        state.setConnectedServers(undefined as any);
        expect(useAppStore.getState().connectedServers).toEqual([]);

        state.setConnectedServers('not-an-array' as any);
        expect(useAppStore.getState().connectedServers).toEqual([]);
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

    it('setActiveServerId clears activeChannelId and activeChannelName (no localStorage)', () => {
        const state = useAppStore.getState();
        
        state.setActiveChannelId('chan1', 'General');
        expect(useAppStore.getState().activeChannelId).toBe('chan1');

        state.setActiveServerId('server1');
        expect(useAppStore.getState().activeServerId).toBe('server1');
        expect(useAppStore.getState().activeChannelId).toBeNull();
        expect(useAppStore.getState().activeChannelName).toBe('');

        // Verify NO localStorage persistence for active server/channel
        expect(localStorage.getItem('harmony_active_server_id')).toBeNull();
        expect(localStorage.getItem('harmony_active_channel_id')).toBeNull();
    });

    it('setActiveChannelId sets channel in Zustand (no localStorage)', () => {
        const state = useAppStore.getState();
        
        state.setActiveChannelId('chan2', 'ChitChat');
        expect(useAppStore.getState().activeChannelId).toBe('chan2');
        expect(useAppStore.getState().activeChannelName).toBe('ChitChat');

        // Verify NO localStorage persistence
        expect(localStorage.getItem('harmony_active_channel_id')).toBeNull();
        expect(localStorage.getItem('harmony_active_channel_name')).toBeNull();
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

        expect(mockFetch).toHaveBeenCalledWith('/api/guilds/server1/emojis', expect.objectContaining({
            headers: { 'Authorization': 'Bearer fake-token' }
        }));
        expect(useAppStore.getState().emojis['server1']).toEqual(mockEmojis);

        // Test caching: call again, should not fetch
        await state.fetchServerEmojis('server1');
        expect(mockFetch).toHaveBeenCalledTimes(1);

        vi.unstubAllGlobals();
    });

    it('sets and persists audio settings correctly (device-bound localStorage)', () => {
        const state = useAppStore.getState();
        
        state.setIsMuted(true);
        expect(useAppStore.getState().isMuted).toBe(true);

        state.setIsDeafened(true);
        expect(useAppStore.getState().isDeafened).toBe(true);

        state.setAudioSettings({ noiseSuppression: false });
        expect(useAppStore.getState().audioSettings.noiseSuppression).toBe(false);
        
        // Audio settings ARE persisted — they are device-bound, not account-bound
        const storedSettings = JSON.parse(localStorage.getItem('harmony_audio_settings') || '{}');
        expect(storedSettings.noiseSuppression).toBe(false);
        
        // Assert defaults were preserved during partial update
        expect(storedSettings.echoCancellation).toBe(true);
        expect(useAppStore.getState().audioSettings.echoCancellation).toBe(true);
        expect(useAppStore.getState().audioSettings.inputMode).toBe('voiceActivity');

        // Test advanced settings
        state.setAudioSettings({ inputMode: 'pushToTalk', pttKey: 'Space', voiceActivityThreshold: -30 });
        expect(useAppStore.getState().audioSettings.inputMode).toBe('pushToTalk');
        expect(useAppStore.getState().audioSettings.pttKey).toBe('Space');
        expect(useAppStore.getState().audioSettings.voiceActivityThreshold).toBe(-30);
        
        const advancedStored = JSON.parse(localStorage.getItem('harmony_audio_settings') || '{}');
        expect(advancedStored.inputMode).toBe('pushToTalk');
        expect(advancedStored.pttKey).toBe('Space');
    });

    it('only audio settings persist to localStorage (no account-bound state)', () => {
        const state = useAppStore.getState();

        // Set various state
        state.setCurrentAccount({ id: '1', email: 'a@a.com', is_creator: false, token: 'tok' });
        state.setConnectedServers([{ url: 'http://a.com', trust_level: 'trusted', status: 'active' }]);
        state.setActiveServerId('srv1');
        state.setActiveChannelId('ch1', 'General');
        // Trigger an audio settings write
        state.setAudioSettings({ noiseSuppression: true });

        // Only audio settings should be in localStorage
        const keys = Object.keys(localStorage);
        const harmonyKeys = keys.filter(k => k.startsWith('harmony_'));
        expect(harmonyKeys).toEqual(['harmony_audio_settings']);
    });

    it('updateGlobalProfile stores display_name in globalProfiles', () => {
        const state = useAppStore.getState();

        state.updateGlobalProfile({
            account_id: 'acc-dn',
            display_name: 'GHz',
            bio: 'Test bio',
            status_message: 'online',
            avatar_url: 'http://avatar.png',
            banner_url: '',
        });

        const stored = useAppStore.getState().globalProfiles['acc-dn'];
        expect(stored).toBeDefined();
        expect(stored.display_name).toBe('GHz');
        expect(stored.bio).toBe('Test bio');
        expect(stored.avatar_url).toBe('http://avatar.png');
    });

    it('updateGlobalProfile with empty display_name does not overwrite existing', () => {
        const state = useAppStore.getState();

        // First set with display_name
        state.updateGlobalProfile({
            account_id: 'acc-dn2',
            display_name: 'InitialName',
            bio: '',
            status_message: '',
            avatar_url: '',
            banner_url: '',
        });
        expect(useAppStore.getState().globalProfiles['acc-dn2'].display_name).toBe('InitialName');

        // Update with a new display_name
        state.updateGlobalProfile({
            account_id: 'acc-dn2',
            display_name: 'UpdatedName',
            bio: 'new bio',
            status_message: '',
            avatar_url: '',
            banner_url: '',
        });
        expect(useAppStore.getState().globalProfiles['acc-dn2'].display_name).toBe('UpdatedName');
        expect(useAppStore.getState().globalProfiles['acc-dn2'].bio).toBe('new bio');
    });
});
