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

const mockBroadcast = vi.fn();
const app = createApp(mockDbManager, mockBroadcast);
const testToken = generateToken('acc1');

describe('DMs Routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Mock Server' }]);
    });

    it('GET /api/dms should return DM channels with participants', async () => {
        const mockChannels = [
            { id: 'dm1', is_group: 0, name: null, owner_id: 'acc1' }
        ];
        // The route calls allDmsQuery first for channels, then runs it in a loop for each channel to get participants
        mockDbManager.allDmsQuery
            .mockResolvedValueOnce(mockChannels)
            .mockResolvedValueOnce([{ account_id: 'acc1' }, { account_id: 'acc2' }]);

        const res = await request(app)
            .get('/api/dms')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body[0].id).toBe('dm1');
        expect(res.body[0].participants).toEqual(['acc1', 'acc2']);
    });

    it('GET /api/dms should return empty array when no DMs', async () => {
        mockDbManager.allDmsQuery.mockResolvedValueOnce([]);

        const res = await request(app)
            .get('/api/dms')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('POST /api/dms should create new DM channel', async () => {
        // first query checks for existing channels
        mockDbManager.allDmsQuery.mockResolvedValueOnce([]);
        mockDbManager.runDmsQuery.mockResolvedValue(true); // INSERT into channels, then participants x2

        const res = await request(app)
            .post('/api/dms')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ targetAccountId: 'acc2' });

        expect(res.status).toBe(200);
        expect(res.body.id.startsWith('dm-')).toBe(true);
        expect(res.body.is_group).toBe(0);
        expect(res.body.participants).toEqual(['acc1', 'acc2']);
        
        expect(mockDbManager.runDmsQuery).toHaveBeenCalledTimes(3);
        expect(mockDbManager.runDmsQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO dm_channels'), expect.any(Array));
        expect(mockDbManager.runDmsQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO dm_participants'), [expect.any(String), 'acc1']);
        expect(mockDbManager.runDmsQuery).toHaveBeenNthCalledWith(3, expect.stringContaining('INSERT INTO dm_participants'), [expect.any(String), 'acc2']);
    });

    it('POST /api/dms should return existing DM if it already exists', async () => {
        // Return existing channel id from check query
        mockDbManager.allDmsQuery.mockResolvedValueOnce([{ channel_id: 'existing-dm' }]);
        mockDbManager.getDmsQuery.mockResolvedValueOnce({ id: 'existing-dm', is_group: 0, owner_id: 'acc1' });

        const res = await request(app)
            .post('/api/dms')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ targetAccountId: 'acc2' });

        expect(res.status).toBe(200);
        expect(res.body.id).toBe('existing-dm');
        expect(res.body.participants).toEqual(['acc1', 'acc2']);
        // Verify insert wasn't called
        expect(mockDbManager.runDmsQuery).not.toHaveBeenCalled();
    });

    it('POST /api/dms should reject missing targetAccountId (400)', async () => {
        const res = await request(app)
            .post('/api/dms')
            .set('Authorization', `Bearer ${testToken}`)
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Missing targetAccountId');
    });

    it('POST /api/dms should require authentication (401)', async () => {
        const res = await request(app)
            .post('/api/dms')
            .send({ targetAccountId: 'acc2' });

        expect(res.status).toBe(401);
    });
});
