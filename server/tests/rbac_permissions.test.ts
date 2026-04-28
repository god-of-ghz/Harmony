import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../src/app';

const mockDbManager = vi.hoisted(() => {
    const allQuery = vi.fn().mockResolvedValue([]);
    const getQuery = vi.fn();
    const runQuery = vi.fn();
    const getAllLoaded = vi.fn().mockResolvedValue([{ id: 'sv1' }]);
    const initBundle = vi.fn();
    const unloadInstance = vi.fn();
    const channelMap = { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set: vi.fn(), delete: vi.fn() };
    return {
        channelToServerId: channelMap,
        channelToGuildId: channelMap,
        allNodeQuery: vi.fn(),
        getNodeQuery: vi.fn(),
        runNodeQuery: vi.fn(),
        allServerQuery: allQuery,
        allGuildQuery: allQuery,
        getServerQuery: getQuery,
        getGuildQuery: getQuery,
        runServerQuery: runQuery,
        runGuildQuery: runQuery,
        getAllLoadedServers: getAllLoaded,
        getAllLoadedGuilds: getAllLoaded,
        initializeServerBundle: initBundle,
        initializeGuildBundle: initBundle,
        unloadServerInstance: unloadInstance,
        unloadGuildInstance: unloadInstance,
    };
});

vi.mock('../src/database', () => ({
    SERVERS_DIR: 'mock_servers_dir',
    GUILDS_DIR: 'mock_servers_dir',
    DATA_DIR: 'mock_data_dir',
    nodeDbPath: 'mock_data_dir/node.db',
    default: mockDbManager
}));

vi.mock('fs', () => ({
    default: {
        rmSync: vi.fn(),
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        readFileSync: vi.fn(),
        accessSync: vi.fn(),
    }
}));

const mockBroadcast = vi.fn();
const app = createApp(mockDbManager, mockBroadcast);

describe('RBAC Permission Model (Phase 1B)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Mock Server' }]);
    });

    // ====================================================================
    // 1. USER role with DEFAULT_USER_PERMS fallback
    // ====================================================================
    describe('DEFAULT_USER_PERMS fallback for USER role', () => {
        it('should allow USER-role to send messages when no @everyone role exists', async () => {
            const userToken = generateToken('user-acc');

            // Use persistent mocks for requireGuildAccess chain
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // requireGuildAccess + requireGuildPermission: active profile exists
            mockDbManager.getServerQuery.mockImplementation(async (serverId: string, query: string) => {
                if (query.includes('SELECT id, role FROM profiles') && query.includes('membership_status')) {
                    return { id: 'pUser', role: 'USER', account_id: 'user-acc' }; // requireGuildPermission: active profile with role
                }
                if (query.includes('SELECT id FROM profiles') && query.includes('membership_status')) {
                    return { id: 'pUser' }; // requireGuildAccess: active profile
                }
                if (query.includes('SELECT account_id FROM profiles')) {
                    return { account_id: 'user-acc' }; // Route handler: profile ownership check
                }
                if (query.includes('nickname')) {
                    return { username: 'TestUser', avatar: '', account_id: 'user-acc' }; // Route handler: author info
                }
                if (query.includes('FROM roles')) {
                    return null; // no @everyone role → DEFAULT_USER_PERMS
                }
                return null;
            });
            // No extra guild roles
            mockDbManager.allServerQuery.mockResolvedValue([]);

            // Message insertion mock chain
            mockDbManager.runServerQuery.mockResolvedValue(true);

            const res = await request(app)
                .post('/api/channels/ch1/messages?serverId=sv1')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ content: 'Hello from USER', authorId: 'pUser', is_encrypted: true });

            // DEFAULT_USER_PERMS includes SEND_MESSAGES, so this should succeed
            expect(res.status).toBe(200);
        });

        it('should deny MEMBER-role from MANAGE_CHANNELS when DEFAULT_USER_PERMS does not include it', async () => {
            const userToken = generateToken('user-acc');

            // requireGuildRole: not node creator, not deactivated
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // requireGuildRole: profile with MEMBER role — query now includes membership_status
            mockDbManager.getServerQuery.mockResolvedValue({ account_id: 'user-acc', role: 'MEMBER' });
            // requireGuildRole: no guild roles with manage permissions
            mockDbManager.allServerQuery.mockResolvedValue([]);

            const res = await request(app)
                .delete('/api/channels/ch1?serverId=sv1')
                .set('Authorization', `Bearer ${userToken}`);

            // MEMBER role can't manage channels, so 403
            expect(res.status).toBe(403);
        });
    });

    // ====================================================================
    // 2. OWNER role bypass
    // ====================================================================
    describe('OWNER role bypass', () => {
        it('should allow OWNER-role users to manage server roles', async () => {
            const ownerToken = generateToken('owner-acc');

            // requireGuildRole: not node creator, not deactivated
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // requireGuildRole: profile lookup returns OWNER
            mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'owner-acc', role: 'OWNER' });

            // Route logic: create role
            mockDbManager.runServerQuery.mockResolvedValue(true);
            mockDbManager.getServerQuery.mockResolvedValueOnce({
                id: 'r1', name: 'Moderator', permissions: 8, color: '#ff0000', position: 1
            });

            const res = await request(app)
                .post('/api/servers/sv1/roles')
                .set('Authorization', `Bearer ${ownerToken}`)
                .send({ name: 'Moderator', permissions: 8, color: '#ff0000', position: 1 });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe('Moderator');
        });
    });

    // ====================================================================
    // 3. Deactivated account rejection
    // ====================================================================
    describe('Deactivated account access denial', () => {
        it('should return 403 for deactivated accounts on requireGuildAccess', async () => {
            const deactivatedToken = generateToken('deactivated-acc');

            // requireGuildAccess: account is deactivated
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 1 });

            const res = await request(app)
                .get('/api/servers/sv1/emojis')
                .set('Authorization', `Bearer ${deactivatedToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('deactivated');
        });

        it('should allow non-deactivated accounts to pass requireGuildAccess', async () => {
            const activeToken = generateToken('active-acc');

            // requireGuildAccess: account exists, not deactivated, not creator
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // requireGuildAccess: active profile exists
            mockDbManager.getServerQuery.mockResolvedValue({ id: 'p1' });
            // Route logic: return emojis
            mockDbManager.allServerQuery.mockResolvedValue([{ id: 'e1', name: 'smile' }]);

            const res = await request(app)
                .get('/api/servers/sv1/emojis')
                .set('Authorization', `Bearer ${activeToken}`);

            expect(res.status).toBe(200);
        });
    });

    // ====================================================================
    // 4. Membership status (left) denial
    // P04 RBAC overhaul: requireGuildAccess NO LONGER has is_creator bypass.
    // Node creators must be actual guild members to access guild content.
    // ====================================================================
    describe('Membership status enforcement', () => {
        it('should return 403 for users with no active profile (left server)', async () => {
            const leftToken = generateToken('left-acc');

            // requireGuildAccess: account exists, not deactivated, not creator
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // requireGuildAccess: no ACTIVE profile found (membership_status != 'active')
            mockDbManager.getServerQuery.mockResolvedValue(null);

            const res = await request(app)
                .get('/api/servers/sv1/emojis')
                .set('Authorization', `Bearer ${leftToken}`);

            expect(res.status).toBe(403);
            // P04: error message changed from "do not have access" to guild membership message
            expect(res.body.error).toContain('member');
        });

        it('should also deny node creator without an active profile (P04 change)', async () => {
            const creatorToken = generateToken('creator-acc');

            // requireGuildAccess: account is creator BUT has no guild profile
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 1, is_deactivated: 0 });
            // requireGuildAccess: no active profile — P04 removed is_creator bypass
            mockDbManager.getServerQuery.mockResolvedValue(null);

            const res = await request(app)
                .get('/api/servers/sv1/emojis')
                .set('Authorization', `Bearer ${creatorToken}`);

            // P04: Node creators are NOT exempt from guild membership checks
            expect(res.status).toBe(403);
            expect(res.body.error).toContain('member');
        });
    });
});
