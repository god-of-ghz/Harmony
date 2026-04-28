import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../src/app';

// Mock DB — uses shared vi.fn() references so server/guild aliases work
const mockDbManager = vi.hoisted(() => {
    const allQuery = vi.fn().mockResolvedValue([]);
    const getQuery = vi.fn();
    const runQuery = vi.fn();
    const getAllLoaded = vi.fn().mockResolvedValue([{ id: 'sv1' }]);
    const initBundle = vi.fn();
    const unloadInstance = vi.fn();
    const channelMap = { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set: () => {}, delete: () => {} };
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
        mkdirSync: vi.fn()
    }
}));

const mockBroadcast = vi.fn();
const app = createApp(mockDbManager, mockBroadcast);
const testToken = generateToken('acc1');
const otherToken = generateToken('acc2');

describe('Membership Lifecycle Endpoints', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Mock Server' }]);
    });

    // ─── LEAVE ──────────────────────────────────────────────

    describe('POST /api/servers/:serverId/leave', () => {
        it('should allow an active user to leave, updating membership_status', async () => {
            mockDbManager.getServerQuery.mockImplementation(async (_svr: string, query: string, params?: any[]) => {
                if (query.includes('FROM profiles') && query.includes('membership_status') && params && params.includes('active')) {
                    return { id: 'profile1' };
                }
                return null;
            });
            mockDbManager.runServerQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .post('/api/servers/sv1/leave')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockDbManager.runServerQuery).toHaveBeenCalledWith(
                'sv1',
                expect.stringContaining("membership_status = ?"),
                expect.arrayContaining(['left', expect.any(Number), 'profile1', 'sv1'])
            );
            // P16/P18: broadcast now includes guildId at top-level and uses guildId in data
            expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
                type: 'MEMBER_LEAVE',
                data: expect.objectContaining({ profileId: 'profile1', accountId: 'acc1' })
            }));
        });

        it('should return 404 if user already left the server', async () => {
            mockDbManager.getServerQuery.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/servers/sv1/leave')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(404);
            expect(res.body.error).toContain('No active membership');
        });

        it('should return 404 for a non-member user', async () => {
            mockDbManager.getServerQuery.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/servers/sv1/leave')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(404);
        });
    });

    // ─── REJOIN ─────────────────────────────────────────────

    describe('POST /api/servers/:serverId/rejoin', () => {
        it('should reactivate a left user and return the profile', async () => {
            const leftProfile = { id: 'profile1', server_id: 'sv1', account_id: 'acc1', membership_status: 'left', nickname: 'TestUser' };
            const reactivated = { ...leftProfile, membership_status: 'active', left_at: null };

            mockDbManager.getServerQuery.mockImplementation(async (_svr: string, query: string, params?: any[]) => {
                if (query.includes('FROM profiles') && query.includes('membership_status')) {
                    if (params && params.includes('active')) return null;
                    if (params && params.includes('left')) return leftProfile;
                }
                if (query.includes('FROM profiles') && query.includes('WHERE id = ?') && !query.includes('membership_status')) {
                    return reactivated;
                }
                return null;
            });
            mockDbManager.runServerQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .post('/api/servers/sv1/rejoin')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.membership_status).toBe('active');
            expect(mockDbManager.runServerQuery).toHaveBeenCalledWith(
                'sv1',
                expect.stringContaining("membership_status = ?"),
                expect.arrayContaining(['active', 'profile1', 'sv1'])
            );
            // P16/P18: broadcast now includes guildId
            expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
                type: 'MEMBER_JOIN',
                data: expect.objectContaining({ id: 'profile1', membership_status: 'active' })
            }));
        });

        it('should return 409 if user is already an active member', async () => {
            mockDbManager.getServerQuery.mockImplementation(async (_svr: string, query: string, params?: any[]) => {
                if (query.includes('FROM profiles') && query.includes('membership_status') && params && params.includes('active')) {
                    return { id: 'profile1' };
                }
                return null;
            });

            const res = await request(app)
                .post('/api/servers/sv1/rejoin')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(409);
            expect(res.body.error).toContain('Already an active member');
        });

        it('should return needs_profile:true for a never-joined user', async () => {
            mockDbManager.getServerQuery.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/servers/sv1/rejoin')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.needs_profile).toBe(true);
        });
    });

    // ─── ACCOUNT STATE ──────────────────────────────────────

    describe('GET /api/accounts/:accountId/state', () => {
        it('should return correct server list and account metadata', async () => {
            mockDbManager.allNodeQuery.mockResolvedValue([
                { server_url: 'http://server1.local', trust_level: 'trusted', status: 'active' },
                { server_url: 'http://server2.local', trust_level: 'untrusted', status: 'active' }
            ]);
            mockDbManager.getNodeQuery.mockResolvedValue({
                dismissed_global_claim: 1,
                authority_role: 'primary',
                primary_server_url: null
            });

            const res = await request(app)
                .get('/api/accounts/acc1/state')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.servers).toHaveLength(2);
            expect(res.body.servers[0]).toEqual({ url: 'http://server1.local', trust_level: 'trusted', status: 'active' });
            expect(res.body.servers[1]).toEqual({ url: 'http://server2.local', trust_level: 'untrusted', status: 'active' });
            expect(res.body.dismissed_global_claim).toBe(true);
            expect(res.body.authority_role).toBe('primary');
            expect(res.body.primary_server_url).toBeNull();
        });

        it('should return 403 when trying to fetch another user\'s state', async () => {
            const res = await request(app)
                .get('/api/accounts/acc2/state')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Cannot access');
        });
    });

    // ─── ADD SERVER ─────────────────────────────────────────

    describe('POST /api/accounts/:accountId/servers', () => {
        it('should insert a server with trust_level=untrusted', async () => {
            mockDbManager.runNodeQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .post('/api/accounts/acc1/servers')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ serverUrl: 'http://new-server.local' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockDbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT OR IGNORE'),
                ['acc1', 'http://new-server.local', 'untrusted', 'active']
            );
        });

        it('should return 400 if serverUrl is missing', async () => {
            const res = await request(app)
                .post('/api/accounts/acc1/servers')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            expect(res.status).toBe(400);
        });
    });

    // ─── LOGIN RESPONSE FORMAT ──────────────────────────────

    describe('POST /api/accounts/login', () => {
        it('should include full server list with trust_level in response', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc1', email: 'test@test.com', is_creator: 0,
                auth_verifier: 'authkey', public_key: 'pub',
                encrypted_private_key: 'enc', key_iv: 'iv', key_salt: 'salt',
                authority_role: 'primary', primary_server_url: null,
                dismissed_global_claim: 0
            });
            mockDbManager.allNodeQuery.mockResolvedValue([
                { server_url: 'http://trusted', trust_level: 'trusted', status: 'active' },
                { server_url: 'http://untrusted', trust_level: 'untrusted', status: 'active' }
            ]);

            const res = await request(app)
                .post('/api/accounts/login')
                .send({ email: 'test@test.com', serverAuthKey: 'authkey' });

            expect(res.status).toBe(200);
            expect(res.body.servers).toBeDefined();
            expect(res.body.servers).toHaveLength(2);
            expect(res.body.servers[0]).toEqual({ url: 'http://trusted', trust_level: 'trusted', status: 'active' });
            expect(res.body.dismissed_global_claim).toBe(false);
            expect(Array.isArray(res.body.trusted_servers)).toBe(true);
        });

        it('should reject a deactivated account with 403', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc1', email: 'test@test.com', is_creator: 0,
                auth_verifier: 'authkey', public_key: 'pub',
                encrypted_private_key: 'enc', key_iv: 'iv', key_salt: 'salt',
                is_deactivated: 1, authority_role: 'primary'
            });
            mockDbManager.allNodeQuery.mockResolvedValue([]);

            const res = await request(app)
                .post('/api/accounts/login')
                .send({ email: 'test@test.com', serverAuthKey: 'authkey' });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('deactivated');
        });

        it('should not fall back primary_server_url to selfUrl for replica accounts', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc1', email: 'test@test.com', is_creator: 0,
                auth_verifier: 'authkey', public_key: 'pub',
                encrypted_private_key: 'enc', key_iv: 'iv', key_salt: 'salt',
                authority_role: 'replica', primary_server_url: null,
                dismissed_global_claim: 0
            });
            mockDbManager.allNodeQuery.mockResolvedValue([]);

            const res = await request(app)
                .post('/api/accounts/login')
                .send({ email: 'test@test.com', serverAuthKey: 'authkey' });

            expect(res.status).toBe(200);
            expect(res.body.primary_server_url).toBeNull();
        });
    });
});
