import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../src/app';

const mockDbManager = vi.hoisted(() => ({
    channelToServerId: { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set:vi.fn(), delete:vi.fn() },
    channelToGuildId: { get: (id) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} },
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
    unloadServerInstance: vi.fn()
,
    unloadGuildInstance: vi.fn()}));

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

describe('Channels Routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Mock Server' }]);
    });

    it('PATCH /api/channels/:channelId should update channel name/topic', async () => {
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ is_creator: 0 }); // Not node creator
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1', role: 'OWNER' }); // role check
        mockDbManager.runServerQuery.mockResolvedValueOnce(true); // actual update
        mockDbManager.getServerQuery.mockResolvedValueOnce({ id: 'ch1', name: 'Renamed Channel' }); // return updated channel

        const res = await request(app)
            .patch('/api/channels/ch1')
            .set('Authorization', `Bearer ${testToken}`)
            .query({ serverId: 'sv1' })
            .send({ name: 'Renamed Channel' });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Renamed Channel');
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('UPDATE channels SET name = ?'), ['Renamed Channel', 'ch1']);
    });

    it('PATCH /api/channels/:channelId should reject unauthorized user (403)', async () => {
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ is_creator: 0 }); // Not node creator
        // Return a profile with normal MEMBER role without permissions
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1', role: 'MEMBER' });
        mockDbManager.allServerQuery.mockResolvedValueOnce([]); // no extra roles
        
        const res = await request(app)
            .patch('/api/channels/ch1')
            .set('Authorization', `Bearer ${testToken}`)
            .query({ serverId: 'sv1' })
            .send({ name: 'Hacked' });

        expect(res.status).toBe(403);
    });

    it('DELETE /api/channels/:channelId should remove channel', async () => {
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ is_creator: 0 }); // Not node creator
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1', role: 'OWNER' });
        mockDbManager.runServerQuery.mockResolvedValueOnce(true);

        const res = await request(app)
            .delete('/api/channels/ch1')
            .set('Authorization', `Bearer ${testToken}`)
            .query({ serverId: 'sv1' });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Channel deleted');
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('DELETE FROM channels'), ['ch1']);
        expect(mockDbManager.channelToServerId.delete).toHaveBeenCalledWith('ch1');
    });

    it('DELETE /api/channels/:channelId should reject non-admin (403)', async () => {
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ is_creator: 0 }); // Not node creator
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1', role: 'MEMBER' });
        mockDbManager.allServerQuery.mockResolvedValueOnce([]); 

        const res = await request(app)
            .delete('/api/channels/ch1')
            .set('Authorization', `Bearer ${testToken}`)
            .query({ serverId: 'sv1' });

        expect(res.status).toBe(403);
    });

    it('PUT /api/channels/:channelId/category should assign channel category', async () => {
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ is_creator: 0 }); // Not node creator
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1', role: 'ADMIN' });
        mockDbManager.runServerQuery.mockResolvedValueOnce(true);

        const res = await request(app)
            .put('/api/channels/ch1/category')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ categoryId: 'cat2', serverId: 'sv1' });

        expect(res.status).toBe(200);
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('UPDATE channels SET category_id = ?'), ['cat2', 'ch1']);
    });

    it('PATCH /api/channels/:channelId should propagate DB errors (500)', async () => {
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ is_creator: 0 }); // Not node creator
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1', role: 'OWNER' });
        mockDbManager.runServerQuery.mockRejectedValueOnce(new Error('Fatal DB Error'));

        const res = await request(app)
            .patch('/api/channels/ch1')
            .set('Authorization', `Bearer ${testToken}`)
            .query({ serverId: 'sv1' })
            .send({ name: 'Crash' });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Fatal DB Error');
    });
});
