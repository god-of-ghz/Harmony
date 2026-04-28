import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/appStore';

describe('Search State Guild Scoping', () => {
    beforeEach(() => {
        useAppStore.setState({
            searchStateByGuild: {},
            activeGuildId: null,
            activeServerId: null
        });
    });

    it('isolates search state between guilds', () => {
        const store = useAppStore.getState();
        
        // Setup Guild A
        useAppStore.getState().setActiveGuildId('guild-A');
        useAppStore.getState().setSearchSidebarOpen(true);
        useAppStore.getState().setSearchQuery('hello world');
        useAppStore.getState().setSearchResults([{ id: 1, content: 'hello world' }]);

        let state = useAppStore.getState();
        expect(state.searchStateByGuild['guild-A'].isOpen).toBe(true);
        expect(state.searchStateByGuild['guild-A'].query).toBe('hello world');
        expect(state.searchStateByGuild['guild-A'].results).toHaveLength(1);

        // Switch to Guild B
        useAppStore.getState().setActiveGuildId('guild-B');
        useAppStore.getState().setSearchSidebarOpen(false); // Default or explicit close
        useAppStore.getState().setSearchQuery('test query');
        
        state = useAppStore.getState();
        expect(state.searchStateByGuild['guild-B'].isOpen).toBe(false);
        expect(state.searchStateByGuild['guild-B'].query).toBe('test query');

        // Guild A state should remain untouched
        expect(state.searchStateByGuild['guild-A'].isOpen).toBe(true);
        expect(state.searchStateByGuild['guild-A'].query).toBe('hello world');
        expect(state.searchStateByGuild['guild-A'].results).toHaveLength(1);
    });

    it('does not leak state when navigating to a new guild', () => {
        const store = useAppStore.getState();
        
        // Setup Guild A
        useAppStore.getState().setActiveGuildId('guild-A');
        useAppStore.getState().setSearchSidebarOpen(true);
        
        // Switch to Guild C (never visited before)
        useAppStore.getState().setActiveGuildId('guild-C');
        
        const state = useAppStore.getState();
        // It shouldn't have an entry yet, or it should be undefined
        expect(state.searchStateByGuild['guild-C']).toBeUndefined();
    });
});
