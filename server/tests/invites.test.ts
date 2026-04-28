import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../src/app';

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
    allDmsQuery: vi.fn().mockResolvedValue([]),
    getDmsQuery: vi.fn(),
    runDmsQuery: vi.fn(),
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

vi.mock('../src/utils/webhook', () => ({
    dispatchSecurityAlert: vi.fn()
}));

const mockBroadcast = vi.fn();
const app = createApp(mockDbManager, mockBroadcast);
const testToken = generateToken('acc1');

describe('Invites Routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Mock Server' }]);
    });

    it('POST /api/invites should generate a token with correct expiry defaults', async () => {
        mockDbManager.runNodeQuery.mockResolvedValueOnce(true);

        const res = await request(app)
            .post('/api/invites')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ serverId: 'sv1' });

        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
        // Default 1440 mins
        expect(res.body.expiresAt).toBeGreaterThan(Date.now());
        
        expect(mockDbManager.runNodeQuery).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO invites'),
            [res.body.token, expect.any(String), 'sv1', 1, 0, res.body.expiresAt]
        );
    });

    it('POST /api/invites should allow maxUses and expiresInMinutes overrides', async () => {
        mockDbManager.runNodeQuery.mockResolvedValueOnce(true);

        const res = await request(app)
            .post('/api/invites')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ serverId: 'sv1', maxUses: 5, expiresInMinutes: 60 });

        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
        
        expect(mockDbManager.runNodeQuery).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO invites'),
            [res.body.token, expect.any(String), 'sv1', 5, 0, res.body.expiresAt]
        );
    });

    it('POST /api/invites/consume should succeed for valid invite', async () => {
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ guild_id: 'sv1', host_uri: 'http://test.com' });

        const res = await request(app)
            .post('/api/invites/consume')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ token: 'test-token' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.guild_id).toBe('sv1');
        
        expect(mockDbManager.getNodeQuery).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE invites SET current_uses = current_uses + 1'),
            ['test-token', expect.any(Number)]
        );
    });

    it('POST /api/invites/consume should fail for expired/used up invite (400)', async () => {
        // RETURNING * doesn't return a row means it was dead
        mockDbManager.getNodeQuery.mockResolvedValueOnce(null);

        const res = await request(app)
            .post('/api/invites/consume')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ token: 'test-token' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invite is dead, full, or expired');
    });

    it('POST /api/invites/consume missing token (400)', async () => {
        const res = await request(app)
            .post('/api/invites/consume')
            .set('Authorization', `Bearer ${testToken}`)
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing token');
    });

    it('POST /api/invites should return 429 after 1000 requests', async () => {
        // Fast loop to hit rate limit
        const requests = [];
        for (let i = 0; i < 1000; i++) {
            requests.push(
                request(app)
                    .post('/api/invites')
                    .set('Authorization', `Bearer ${testToken}`)
                    .send({ serverId: 'sv1' })
            );
        }
        
        mockDbManager.runNodeQuery.mockResolvedValue(true); // just resolve for all
        await Promise.all(requests);

        // the 1001st request should be rejected
        const res = await request(app).post('/api/invites').set('Authorization', `Bearer ${testToken}`).send({ serverId: 'sv1' });
        
        expect(res.status).toBe(429);
        expect(res.body.error).toContain('Rate Limit Exceeded');
    });

    it('POST /api/invites rate limiting should reset after 60 seconds', async () => {
        // We know it is rate limited right now from the previous test.
        // We need to advance time or mock Date.now. 
        // We can use vi.setSystemTime
        vi.useFakeTimers();
        vi.setSystemTime(new Date(Date.now() + 61000));

        mockDbManager.runNodeQuery.mockResolvedValueOnce(true);

        const res = await request(app)
            .post('/api/invites')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ serverId: 'sv1' });

        expect(res.status).toBe(200);
        vi.useRealTimers();
    });
});
