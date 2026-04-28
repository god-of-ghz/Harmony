/**
 * permission_model.test.ts
 *
 * Validates the complete Harmony RBAC permission model after the federation overhaul.
 *
 * Scenarios tested:
 *   1. OWNER permissions — server creator can manage server, channels, roles
 *   2. USER permissions (no @everyone role) — can send messages via DEFAULT_USER_PERMS
 *   3. USER permissions (with @everyone role) — permissions come from the @everyone role bitfield
 *   4. Non-member — gets 403 on server-scoped permission checks (no profile = denied)
 *   5. Deactivated account — is_deactivated=1 gets 403 on ALL middleware (requirePermission, requireRole, requireServerAccess)
 *   6. Node creator bypass — is_creator=1 bypasses all checks regardless of role
 *   7. Left/banned members — membership_status != 'active' gets 403 on requirePermission and requireRole
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../src/app';

/**
 * IMPORTANT: The RBAC middleware (requirePermission, requireRole, requireServerAccess)
 * imports `dbManager` directly from `../src/database` at module scope. The vi.mock()
 * below replaces that module-level default export, so these middleware functions use
 * our mockDbManager. The `db` parameter passed to createApp() is used by route handlers
 * for data operations (queries, inserts) but NOT by the middleware.
 */
const mockDbManager = vi.hoisted(() => ({
    channelToServerId: {
        get: (id: string) => {
            // Map ch1 → sv1 to simulate server context resolution
            if (id === 'ch1' || id === 'ch-target') return 'sv1';
            return null;
        },
    channelToGuildId: { get: (id) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} },
        set: vi.fn(),
        delete: vi.fn()
    },
    allNodeQuery: vi.fn(),
    getNodeQuery: vi.fn(),
    runNodeQuery: vi.fn(),
    allServerQuery: vi.fn().mockResolvedValue([]),
    allGuildQuery: vi.fn().mockResolvedValue([]),
    getServerQuery: vi.fn(),
    getGuildQuery: vi.fn(),
    runServerQuery: vi.fn(),
    runGuildQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([{ id: 'sv1',
    getAllLoadedGuilds: vi.fn().mockResolvedValue([]), name: 'Mock Server' }]),
    initializeServerBundle: vi.fn(),
    initializeGuildBundle: vi.fn(),
    unloadServerInstance: vi.fn(),
    unloadGuildInstance: vi.fn(),
}));

vi.mock('../src/database', () => ({
    SERVERS_DIR: 'mock_servers_dir',
    GUILDS_DIR: 'mock_servers_dir',
    DATA_DIR: 'mock_data_dir',
    nodeDbPath: 'mock_data_dir/node.db',
    default: mockDbManager
}));

// P18 FIX: Wire guild methods as aliases of server methods
if (typeof mockDbManager !== "undefined") {
    mockDbManager.allGuildQuery = mockDbManager.allServerQuery;
    mockDbManager.getGuildQuery = mockDbManager.getServerQuery;
    mockDbManager.runGuildQuery = mockDbManager.runServerQuery;
    mockDbManager.getAllLoadedGuilds = mockDbManager.getAllLoadedServers;
    mockDbManager.initializeGuildBundle = mockDbManager.initializeServerBundle;
    mockDbManager.unloadGuildInstance = mockDbManager.unloadServerInstance;
    mockDbManager.channelToGuildId = mockDbManager.channelToServerId;
}

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

describe('Permission Model — Full RBAC Coverage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Mock Server' }]);
    });

    // ================================================================
    // 1. OWNER permissions
    // ================================================================
    describe('OWNER role permissions', () => {
        it('should allow OWNER to create channels (requireRole OWNER/ADMIN)', async () => {
            const token = generateToken('owner-acc');
            // requireRole checks: getNodeQuery for is_creator+is_deactivated, then getServerQuery for profile role with membership_status='active'
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            mockDbManager.getServerQuery
                // requireRole profile check (now includes membership_status='active')
                .mockResolvedValueOnce({ account_id: 'owner-acc', role: 'OWNER' })
                // Route handler: get new channel
                .mockResolvedValueOnce({ id: 'ch-new', server_id: 'sv1', name: 'new-channel', type: 'text', position: 0, category_id: null });
            mockDbManager.runServerQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .post('/api/servers/sv1/channels')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'new-channel', type: 'text' });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe('new-channel');
        });

        it('should allow OWNER to create roles', async () => {
            const token = generateToken('owner-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            mockDbManager.getServerQuery
                // requireRole profile check (with membership_status='active')
                .mockResolvedValueOnce({ account_id: 'owner-acc', role: 'OWNER' })
                // Route handler: get new role
                .mockResolvedValueOnce({ id: 'role-new', server_id: 'sv1', name: 'Mod', permissions: 8, color: '#ff0', position: 1 });
            mockDbManager.runServerQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .post('/api/servers/sv1/roles')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Mod', permissions: 8, color: '#ff0', position: 1 });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe('Mod');
        });

        it('should allow OWNER to delete server', async () => {
            const token = generateToken('owner-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // requireRole(['OWNER']) checks profile with membership_status='active'
            mockDbManager.getServerQuery.mockResolvedValue({ account_id: 'owner-acc', role: 'OWNER' });
            mockDbManager.runServerQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .delete('/api/servers/sv1')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
        });
    });

    // ================================================================
    // 2. USER permissions WITHOUT @everyone role
    // ================================================================
    describe('USER role with DEFAULT_USER_PERMS (no @everyone)', () => {
        it('should allow USER to send messages via DEFAULT_USER_PERMS', async () => {
            const token = generateToken('user-acc');
            // requirePermission(SEND_MESSAGES) chain:
            // 1. getNodeQuery - is_creator check
            mockDbManager.getNodeQuery.mockImplementation(async (_q: string) => {
                return { is_creator: 0, is_deactivated: 0, public_key: '' };
            });
            // 2. getServerQuery - profile check (with membership_status=active), then @everyone, then message profile check
            mockDbManager.getServerQuery.mockImplementation(async (_svr: string, query: string) => {
                if (query.includes('SELECT id, role FROM profiles') && query.includes('membership_status')) {
                    return { id: 'p-user', role: 'USER', account_id: 'user-acc' };
                }
                if (query.includes('FROM roles') && query.includes('name')) {
                    return null; // No @everyone → DEFAULT_USER_PERMS
                }
                if (query.includes('SELECT account_id FROM profiles')) {
                    return { account_id: 'user-acc' };
                }
                if (query.includes('nickname')) {
                    return { username: 'TestUser', avatar: '', account_id: 'user-acc' };
                }
                return null;
            });
            // 3. allServerQuery - assigned roles
            mockDbManager.allServerQuery.mockResolvedValue([]);
            mockDbManager.runServerQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .post('/api/channels/ch1/messages')
                .set('Authorization', `Bearer ${token}`)
                .send({ content: 'Hello', authorId: 'p-user', is_encrypted: true });

            expect(res.status).toBe(200);
            expect(res.body.content).toBe('Hello');
        });

        it('should deny USER from managing channels (MANAGE_CHANNELS not in DEFAULT_USER_PERMS)', async () => {
            const token = generateToken('user-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // requirePermission(MANAGE_CHANNELS): profile found with active membership, but no matching permission
            mockDbManager.getServerQuery.mockImplementation(async (_svr: string, query: string) => {
                if (query.includes('SELECT id, role FROM profiles') && query.includes('membership_status')) {
                    return { id: 'p-user', role: 'USER', account_id: 'user-acc' };
                }
                if (query.includes('FROM roles')) return null;
                return null;
            });
            mockDbManager.allServerQuery.mockResolvedValue([]);

            const res = await request(app)
                .delete('/api/channels/ch1?serverId=sv1')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Forbidden');
        });

        it('should deny USER from creating roles (requireRole OWNER/ADMIN)', async () => {
            const token = generateToken('user-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // requireRole(['OWNER', 'ADMIN']): profile has role=USER (active) → denied
            mockDbManager.getServerQuery.mockResolvedValue({ account_id: 'user-acc', role: 'USER' });

            const res = await request(app)
                .post('/api/servers/sv1/roles')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Evil', permissions: 1, color: '#000', position: 0 });

            expect(res.status).toBe(403);
        });

        it('should deny USER from deleting the server (requireRole OWNER)', async () => {
            const token = generateToken('user-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            mockDbManager.getServerQuery.mockResolvedValue({ account_id: 'user-acc', role: 'USER' });

            const res = await request(app)
                .delete('/api/servers/sv1')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
        });
    });

    // ================================================================
    // 3. USER permissions WITH @everyone role
    // ================================================================
    describe('USER role with @everyone role permissions', () => {
        it('should grant permissions from @everyone bitfield', async () => {
            const token = generateToken('user-acc');
            mockDbManager.getNodeQuery.mockImplementation(async () => ({ is_creator: 0, is_deactivated: 0, public_key: '' }));
            mockDbManager.getServerQuery.mockImplementation(async (_svr: string, query: string) => {
                if (query.includes('SELECT id, role FROM profiles') && query.includes('membership_status')) {
                    return { id: 'p-user', role: 'USER', account_id: 'user-acc' };
                }
                if (query.includes('FROM roles') && query.includes('name')) {
                    // SEND_MESSAGES (128) + MANAGE_MESSAGES (64)
                    return { permissions: 128 | 64 };
                }
                if (query.includes('SELECT account_id FROM profiles')) {
                    return { account_id: 'user-acc' };
                }
                if (query.includes('nickname')) {
                    return { username: 'TestUser', avatar: '', account_id: 'user-acc' };
                }
                return null;
            });
            mockDbManager.allServerQuery.mockResolvedValue([]);
            mockDbManager.runServerQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .post('/api/channels/ch1/messages')
                .set('Authorization', `Bearer ${token}`)
                .send({ content: 'With @everyone', authorId: 'p-user', is_encrypted: true });

            expect(res.status).toBe(200);
        });

        it('should sanitize oversized Discord-imported @everyone permissions (falls back to DEFAULT_USER_PERMS)', async () => {
            const token = generateToken('user-acc');
            mockDbManager.getNodeQuery.mockImplementation(async () => ({ is_creator: 0, is_deactivated: 0, public_key: '' }));
            mockDbManager.getServerQuery.mockImplementation(async (_svr: string, query: string) => {
                if (query.includes('SELECT id, role FROM profiles') && query.includes('membership_status')) {
                    return { id: 'p-user', role: 'USER', account_id: 'user-acc' };
                }
                if (query.includes('FROM roles') && query.includes('name')) {
                    // Massive Discord integer — should be ignored
                    return { permissions: 1071698660929 };
                }
                if (query.includes('SELECT account_id FROM profiles')) {
                    return { account_id: 'user-acc' };
                }
                if (query.includes('nickname')) {
                    return { username: 'TestUser', avatar: '', account_id: 'user-acc' };
                }
                return null;
            });
            mockDbManager.allServerQuery.mockResolvedValue([]);
            mockDbManager.runServerQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .post('/api/channels/ch1/messages')
                .set('Authorization', `Bearer ${token}`)
                .send({ content: 'Discord imported', authorId: 'p-user', is_encrypted: true });

            expect(res.status).toBe(200);
        });
    });

    // ================================================================
    // 4. Non-member (no profile on server)
    // ================================================================
    describe('Non-member access denial', () => {
        it('should return 403 for sending messages (no profile found)', async () => {
            const token = generateToken('outsider-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // requirePermission: no active profile → 403
            mockDbManager.getServerQuery.mockResolvedValue(null);
            mockDbManager.allServerQuery.mockResolvedValue([]);

            const res = await request(app)
                .post('/api/channels/ch1/messages')
                .set('Authorization', `Bearer ${token}`)
                .send({ content: 'Intruder', authorId: 'fake', is_encrypted: true });

            expect(res.status).toBe(403);
        });

        it('should return 403 for creating channels (no profile = no role match)', async () => {
            const token = generateToken('outsider-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            mockDbManager.getServerQuery.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/servers/sv1/channels')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'hacked-channel' });

            expect(res.status).toBe(403);
        });

        it('should return 403 for deleting server (no profile)', async () => {
            const token = generateToken('outsider-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            mockDbManager.getServerQuery.mockResolvedValue(null);

            const res = await request(app)
                .delete('/api/servers/sv1')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
        });

        it('should return 403 for requireServerAccess endpoints (emojis)', async () => {
            const token = generateToken('outsider-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            mockDbManager.getServerQuery.mockResolvedValue(null); // no active profile

            const res = await request(app)
                .get('/api/servers/sv1/emojis')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('do not have access');
        });
    });

    // ================================================================
    // 5. Deactivated account
    // ================================================================
    describe('Deactivated account access denial', () => {
        it('should return 403 on requireServerAccess for deactivated account', async () => {
            const token = generateToken('deact-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 1 });

            const res = await request(app)
                .get('/api/servers/sv1/emojis')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('deactivated');
        });

        it('should return 403 on requireServerAccess for deactivated even with active profile', async () => {
            const token = generateToken('deact-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 1 });
            // Even if profile exists, deactivation check happens first
            mockDbManager.getServerQuery.mockResolvedValue({ id: 'p-deact' });

            const res = await request(app)
                .get('/api/servers/sv1/emojis')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('deactivated');
        });

        it('should return 403 on requirePermission for deactivated account (send messages)', async () => {
            const token = generateToken('deact-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 1 });
            // Even if profile exists, deactivation check happens first in requirePermission
            mockDbManager.getServerQuery.mockResolvedValue({ id: 'p-deact', role: 'USER' });
            mockDbManager.allServerQuery.mockResolvedValue([]);

            const res = await request(app)
                .post('/api/channels/ch1/messages')
                .set('Authorization', `Bearer ${token}`)
                .send({ content: 'Should be blocked', authorId: 'p-deact', is_encrypted: true });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('deactivated');
        });

        it('should return 403 on requireRole for deactivated account (create channel)', async () => {
            const token = generateToken('deact-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 1 });
            // Even if profile exists with OWNER role, deactivation check happens first in requireRole
            mockDbManager.getServerQuery.mockResolvedValue({ role: 'OWNER' });

            const res = await request(app)
                .post('/api/servers/sv1/channels')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'deact-channel', type: 'text' });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('deactivated');
        });

        it('should return 403 on requireRole for deactivated account (delete server)', async () => {
            const token = generateToken('deact-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 1 });

            const res = await request(app)
                .delete('/api/servers/sv1')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('deactivated');
        });
    });

    // ================================================================
    // 6. Node creator bypass (is_creator=1)
    // ================================================================
    describe('Node creator bypass', () => {
        it('should allow is_creator=1 to create channels (bypasses requireRole)', async () => {
            const token = generateToken('creator-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 1 });
            // requireRole: is_creator check returns 1 → bypass
            mockDbManager.getServerQuery.mockResolvedValueOnce({ id: 'ch-new', server_id: 'sv1', name: 'new-chan', type: 'text' });
            mockDbManager.runServerQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .post('/api/servers/sv1/channels')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'new-chan', type: 'text' });

            expect(res.status).toBe(200);
        });

        it('should allow is_creator=1 to delete servers', async () => {
            const token = generateToken('creator-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 1 });

            const res = await request(app)
                .delete('/api/servers/sv1')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
        });

        it('should allow is_creator=1 to access requireServerAccess endpoints', async () => {
            const token = generateToken('creator-acc');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 1, is_deactivated: 0 });
            mockDbManager.allServerQuery.mockResolvedValue([{ id: 'e1', name: 'emoji', url: '/e.png', animated: false }]);

            const res = await request(app)
                .get('/api/servers/sv1/emojis')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
        });

        it('should allow is_creator=1 to send messages (bypasses requirePermission)', async () => {
            const token = generateToken('creator-acc');
            mockDbManager.getNodeQuery.mockImplementation(async () => ({ is_creator: 1, public_key: '' }));
            // requirePermission: is_creator=1 → bypass
            // Route handler needs profile check for authorId validation
            mockDbManager.getServerQuery.mockImplementation(async (_svr: string, query: string) => {
                if (query.includes('SELECT account_id FROM profiles')) {
                    return { account_id: 'creator-acc' };
                }
                if (query.includes('nickname')) {
                    return { username: 'Creator', avatar: '', account_id: 'creator-acc' };
                }
                return null;
            });
            mockDbManager.runServerQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .post('/api/channels/ch1/messages')
                .set('Authorization', `Bearer ${token}`)
                .send({ content: 'Creator msg', authorId: 'p-creator', is_encrypted: true });

            expect(res.status).toBe(200);
        });
    });

    // ================================================================
    // 7. Left/banned member enforcement
    // ================================================================
    describe('Left/banned member enforcement on requirePermission and requireRole', () => {
        it('should return 403 on requirePermission when membership_status is left', async () => {
            const token = generateToken('left-user');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // Profile exists but is NOT returned because membership_status != 'active'
            mockDbManager.getServerQuery.mockResolvedValue(null);
            mockDbManager.allServerQuery.mockResolvedValue([]);

            const res = await request(app)
                .post('/api/channels/ch1/messages')
                .set('Authorization', `Bearer ${token}`)
                .send({ content: 'Left user msg', authorId: 'p-left', is_encrypted: true });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Forbidden');
        });

        it('should return 403 on requireRole when membership_status is left', async () => {
            const token = generateToken('left-owner');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // Profile with OWNER role exists but membership_status='left' so query returns null
            mockDbManager.getServerQuery.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/servers/sv1/channels')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'left-owner-channel', type: 'text' });

            expect(res.status).toBe(403);
        });

        it('should return 403 on requireRole when membership_status is banned', async () => {
            const token = generateToken('banned-owner');
            mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });
            // Banned profile — query with membership_status='active' returns null
            mockDbManager.getServerQuery.mockResolvedValue(null);

            const res = await request(app)
                .delete('/api/servers/sv1')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
        });
    });
});
