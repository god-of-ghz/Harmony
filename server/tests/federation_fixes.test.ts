import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../src/app';

// Mock DB
const mockDbManager = vi.hoisted(() => ({
    channelToServerId: { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{},
    channelToGuildId: { get: (id) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} }, delete:()=>{} },
    allNodeQuery: vi.fn(),
    getNodeQuery: vi.fn(),
    runNodeQuery: vi.fn(),
    allServerQuery: vi.fn().mockResolvedValue([]),
    allGuildQuery: vi.fn().mockResolvedValue([]),
    getServerQuery: vi.fn(),
    getGuildQuery: vi.fn(),
    runServerQuery: vi.fn(),
    runGuildQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([{ id: 'sv1' ,
    getAllLoadedGuilds: vi.fn().mockResolvedValue([])}]),
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
        mkdirSync: vi.fn()
    }
}));

const mockBroadcast = vi.fn();
const app = createApp(mockDbManager, mockBroadcast);
const testToken = generateToken('acc1');

describe('Federation Bug Fix Regression — Server Unit Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Mock Server' }]);
    });

    describe('POST /api/node/claim-ownership', () => {
        it('allows claiming an unclaimed node', async () => {
            // No existing owner
            mockDbManager.getNodeQuery.mockImplementation(async (query: string) => {
                if (query.includes('is_creator = 1')) return null;  // No owner
                return null;
            });
            mockDbManager.runNodeQuery.mockResolvedValue(undefined);

            const res = await request(app)
                .post('/api/node/claim-ownership')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(mockDbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining('is_creator = 1'),
                expect.arrayContaining(['acc1'])
            );
        });

        it('rejects claiming an already-owned node with 409', async () => {
            // Owner exists
            mockDbManager.getNodeQuery.mockImplementation(async (query: string) => {
                if (query.includes('is_creator = 1')) return { id: 'other-acc', is_creator: 1 };
                return null;
            });

            const res = await request(app)
                .post('/api/node/claim-ownership')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(409);
            expect(res.body.error).toContain('already has an owner');
        });

        it('rejects unauthenticated requests with 401', async () => {
            const res = await request(app)
                .post('/api/node/claim-ownership');

            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/accounts/:accountId/trusted_servers — requireAuth enforcement', () => {
        it('rejects unauthenticated POST to trusted_servers with 401', async () => {
            const res = await request(app)
                .post('/api/accounts/acc1/trusted_servers')
                .send({ serverUrl: 'http://evil.com' });

            expect(res.status).toBe(401);
        });

        it('rejects unauthenticated DELETE from trusted_servers with 401', async () => {
            const res = await request(app)
                .delete('/api/accounts/acc1/trusted_servers')
                .send({ serverUrl: 'http://target.com' });

            expect(res.status).toBe(401);
        });

        it('allows authenticated POST to trusted_servers', async () => {
            mockDbManager.runNodeQuery.mockResolvedValue(undefined);
            mockDbManager.getNodeQuery.mockResolvedValue({ id: 'acc1', email: 'test@test.com' });
            mockDbManager.allNodeQuery.mockResolvedValue([{ server_url: 'http://new' }]);
            global.fetch = vi.fn().mockResolvedValue({ ok: true });

            const res = await request(app)
                .post('/api/accounts/acc1/trusted_servers')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ serverUrl: 'http://new' });

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/accounts/login — delegation_cert in response', () => {
        it('includes delegation_cert and primary_server_url in login response', async () => {
            // Single mock returning a full account row (matching the existing app.test.ts pattern)
            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc1', email: 'test@test.com', is_creator: 0,
                auth_verifier: 'authkey',
                public_key: 'pub',
                encrypted_private_key: 'enc',
                key_iv: 'iv', key_salt: 'salt',
                delegation_cert: 'CERT_DATA_HERE',
                primary_server_url: 'http://primary.com'
            });
            mockDbManager.allNodeQuery.mockResolvedValue([{ server_url: 'http://trusted' }]);

            const res = await request(app)
                .post('/api/accounts/login')
                .send({ email: 'test@test.com', serverAuthKey: 'authkey' });

            expect(res.status).toBe(200);
            expect(res.body.delegation_cert).toBe('CERT_DATA_HERE');
            expect(res.body.primary_server_url).toBeDefined();
        });
    });

    describe('GET /api/node/status', () => {
        it('returns hasOwner: false when no server has an owner_id', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({ count: 0 });
            mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', owner_id: null }]);

            const res = await request(app).get('/api/node/status');
            expect(res.status).toBe(200);
            expect(res.body.hasOwner).toBe(false);
        });

        it('returns hasOwner: true when a server has an owner_id', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({ count: 1 });
            mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', owner_id: 'acc1' }]);

            const res = await request(app).get('/api/node/status');
            expect(res.status).toBe(200);
            expect(res.body.hasOwner).toBe(true);
        });
    });
});
