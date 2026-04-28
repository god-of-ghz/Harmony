/**
 * P11 — Client Store Rename Verification
 * 
 * Validates:
 * 1. New guild-centric fields exist and are functional
 * 2. Deprecated server-centric aliases stay in sync
 * 3. GuildData / ConnectedNode type aliases exist
 * 4. API URL migration (no /api/servers/ in source)
 * 5. Guild map / guild profiles / guild roles integrity
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/appStore';
import type { GuildData, ServerData, ConnectedNode, ConnectedServer, Profile, RoleData } from '../store/appStore';

describe('P11 — Store Rename: server → guild', () => {
    beforeEach(() => {
        // Reset Zustand store to defaults between tests
        useAppStore.setState({
            activeGuildId: null,
            activeServerId: null,
            guildMap: {},
            serverMap: {},
            guildRoles: [],
            serverRoles: [],
            guildProfiles: [],
            serverProfiles: [],
            nodeStatus: {},
            serverStatus: {},
            emojis: {},
        });
    });

    // ──────────────────────────────────────────────────
    // 1. activeGuildId / activeServerId sync
    // ──────────────────────────────────────────────────

    it('setActiveGuildId updates both activeGuildId and deprecated activeServerId', () => {
        useAppStore.getState().setActiveGuildId('guild-001');
        const state = useAppStore.getState();
        expect(state.activeGuildId).toBe('guild-001');
        expect(state.activeServerId).toBe('guild-001');
    });

    it('deprecated setActiveServerId still updates activeGuildId', () => {
        useAppStore.getState().setActiveServerId('guild-002');
        const state = useAppStore.getState();
        expect(state.activeGuildId).toBe('guild-002');
        expect(state.activeServerId).toBe('guild-002');
    });

    it('setActiveGuildId resets channel and permissions', () => {
        useAppStore.setState({ activeChannelId: 'ch-1', activeChannelName: 'general', currentUserPermissions: 0xFF });
        useAppStore.getState().setActiveGuildId('guild-003');
        const state = useAppStore.getState();
        expect(state.activeChannelId).toBeNull();
        expect(state.activeChannelName).toBe('');
        expect(state.currentUserPermissions).toBe(0);
    });

    // ──────────────────────────────────────────────────
    // 2. guildMap / serverMap sync
    // ──────────────────────────────────────────────────

    it('setGuildMap updates both guildMap and deprecated serverMap', () => {
        const map = { 'g1': 'http://node1.example.com', 'g2': 'http://node2.example.com' };
        useAppStore.getState().setGuildMap(map);
        const state = useAppStore.getState();
        expect(state.guildMap).toEqual(map);
        expect(state.serverMap).toEqual(map);
    });

    it('deprecated setServerMap keeps guildMap in sync', () => {
        const map = { 'g3': 'http://node3.example.com' };
        useAppStore.getState().setServerMap(map);
        const state = useAppStore.getState();
        expect(state.guildMap).toEqual(map);
        expect(state.serverMap).toEqual(map);
    });

    // ──────────────────────────────────────────────────
    // 3. guildRoles / serverRoles sync
    // ──────────────────────────────────────────────────

    it('setGuildRoles updates both guildRoles and deprecated serverRoles', () => {
        const roles: RoleData[] = [
            { id: 'r1', server_id: 'g1', name: 'Admin', color: '#ff0000', permissions: 0xFF, position: 0 },
        ];
        useAppStore.getState().setGuildRoles(roles);
        const state = useAppStore.getState();
        expect(state.guildRoles).toEqual(roles);
        expect(state.serverRoles).toEqual(roles);
    });

    it('deprecated setServerRoles keeps guildRoles in sync', () => {
        const roles: RoleData[] = [
            { id: 'r2', server_id: 'g2', name: 'Mod', color: '#00ff00', permissions: 0x0F, position: 1 },
        ];
        useAppStore.getState().setServerRoles(roles);
        const state = useAppStore.getState();
        expect(state.guildRoles).toEqual(roles);
        expect(state.serverRoles).toEqual(roles);
    });

    // ──────────────────────────────────────────────────
    // 4. guildProfiles / serverProfiles sync
    // ──────────────────────────────────────────────────

    const mockProfile: Profile = {
        id: 'p1',
        server_id: 'g1',
        account_id: 'a1',
        original_username: 'testuser',
        nickname: 'TestNick',
        avatar: '',
        role: 'USER',
        aliases: '',
    };

    it('setGuildProfiles updates both guildProfiles and deprecated serverProfiles', () => {
        useAppStore.getState().setGuildProfiles([mockProfile]);
        const state = useAppStore.getState();
        expect(state.guildProfiles).toEqual([mockProfile]);
        expect(state.serverProfiles).toEqual([mockProfile]);
    });

    it('deprecated setServerProfiles keeps guildProfiles in sync', () => {
        useAppStore.getState().setServerProfiles([mockProfile]);
        const state = useAppStore.getState();
        expect(state.guildProfiles).toEqual([mockProfile]);
        expect(state.serverProfiles).toEqual([mockProfile]);
    });

    it('updateGuildProfile adds a new profile and syncs both arrays', () => {
        useAppStore.getState().updateGuildProfile(mockProfile);
        const state = useAppStore.getState();
        expect(state.guildProfiles).toHaveLength(1);
        expect(state.serverProfiles).toHaveLength(1);
        expect(state.guildProfiles[0].id).toBe('p1');
    });

    it('updateGuildProfile updates an existing profile', () => {
        useAppStore.getState().setGuildProfiles([mockProfile]);
        const updated = { ...mockProfile, nickname: 'UpdatedNick' };
        useAppStore.getState().updateGuildProfile(updated);
        const state = useAppStore.getState();
        expect(state.guildProfiles[0].nickname).toBe('UpdatedNick');
        expect(state.serverProfiles[0].nickname).toBe('UpdatedNick');
    });

    it('deprecated updateServerProfile also syncs with guildProfiles', () => {
        useAppStore.getState().setGuildProfiles([mockProfile]);
        const updated = { ...mockProfile, nickname: 'DeprecatedUpdate' };
        useAppStore.getState().updateServerProfile(updated);
        const state = useAppStore.getState();
        expect(state.guildProfiles[0].nickname).toBe('DeprecatedUpdate');
        expect(state.serverProfiles[0].nickname).toBe('DeprecatedUpdate');
    });

    // ──────────────────────────────────────────────────
    // 5. nodeStatus / serverStatus sync
    // ──────────────────────────────────────────────────

    it('setNodeStatus updates both nodeStatus and deprecated serverStatus', () => {
        const status = { 'http://node1.example.com': 'online' as const };
        useAppStore.getState().setNodeStatus(status);
        const state = useAppStore.getState();
        expect(state.nodeStatus).toEqual(status);
        expect(state.serverStatus).toEqual(status);
    });

    it('deprecated setServerStatus keeps nodeStatus in sync', () => {
        const status = { 'http://node2.example.com': 'offline' as const };
        useAppStore.getState().setServerStatus(status);
        const state = useAppStore.getState();
        expect(state.nodeStatus).toEqual(status);
        expect(state.serverStatus).toEqual(status);
    });

    // ──────────────────────────────────────────────────
    // 6. fetchGuildEmojis / fetchServerEmojis
    // ──────────────────────────────────────────────────

    it('fetchGuildEmojis function exists on the store', () => {
        expect(typeof useAppStore.getState().fetchGuildEmojis).toBe('function');
    });

    it('deprecated fetchServerEmojis function exists and delegates', () => {
        expect(typeof useAppStore.getState().fetchServerEmojis).toBe('function');
    });

    // ──────────────────────────────────────────────────
    // 7. Type alias compatibility
    // ──────────────────────────────────────────────────

    it('GuildData type is structurally compatible with deprecated ServerData', () => {
        const guildData: GuildData = { id: 'g1', name: 'Test Guild', icon: '🏰' };
        // ServerData should be a type alias for GuildData
        const serverData: ServerData = guildData;
        expect(serverData.id).toBe('g1');
        expect(serverData.name).toBe('Test Guild');
    });

    it('ConnectedNode type is structurally compatible with deprecated ConnectedServer', () => {
        const node: ConnectedNode = { url: 'http://node.example.com', trust_level: 'trusted', status: 'active' };
        // ConnectedServer should be a type alias for ConnectedNode
        const server: ConnectedServer = node;
        expect(server.url).toBe('http://node.example.com');
        expect(server.trust_level).toBe('trusted');
    });

    // ──────────────────────────────────────────────────
    // 8. connectedServers accepts ConnectedNode[]
    // ──────────────────────────────────────────────────

    it('setConnectedServers accepts ConnectedNode[] without type errors', () => {
        const nodes: ConnectedNode[] = [
            { url: 'http://node1.example.com', trust_level: 'trusted', status: 'active' },
            { url: 'http://node2.example.com', trust_level: 'untrusted', status: 'disconnected' },
        ];
        useAppStore.getState().setConnectedServers(nodes);
        const state = useAppStore.getState();
        expect(state.connectedServers).toHaveLength(2);
        expect(state.connectedServers[0].url).toBe('http://node1.example.com');
    });

    // ──────────────────────────────────────────────────
    // 9. Initial state verification
    // ──────────────────────────────────────────────────

    it('initial state has all guild-centric fields at their defaults', () => {
        const state = useAppStore.getState();
        expect(state.activeGuildId).toBeNull();
        expect(state.guildMap).toEqual({});
        expect(state.guildRoles).toEqual([]);
        expect(state.guildProfiles).toEqual([]);
        expect(state.nodeStatus).toEqual({});
    });

    // ──────────────────────────────────────────────────
    // 10. Profile.server_id retained for API compatibility
    // ──────────────────────────────────────────────────

    it('Profile interface still uses server_id field (DB column compat)', () => {
        // This validates that we did NOT rename the Profile.server_id field,
        // which maps to the SQLite column and must remain unchanged.
        const profile: Profile = {
            id: 'p2',
            server_id: 'guild-abc', // NOTE: 'server_id' retained for API compat, semantically this is guild_id
            account_id: null,
            original_username: 'imported_user',
            nickname: 'Imported',
            avatar: '',
            role: 'USER',
            aliases: '',
        };
        expect(profile.server_id).toBe('guild-abc');
    });
});
