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
    const channelMap = { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} };
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
        allDmsQuery: vi.fn().mockResolvedValue([]),
        getDmsQuery: vi.fn(),
        runDmsQuery: vi.fn(),
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
const testToken = generateToken('acc1');

describe('Categories Routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Mock Server' }]);
        mockDbManager.getServerQuery.mockResolvedValue(null);
        mockDbManager.allServerQuery.mockResolvedValue([]);
        mockDbManager.runServerQuery.mockResolvedValue(true);
    });

    it('GET /api/servers/:serverId/categories should return ordered categories', async () => {
        const mockCategories = [{ id: 'cat1', name: 'General', position: 0 }, { id: 'cat2', name: 'Voice', position: 1 }];
        mockDbManager.allServerQuery.mockResolvedValueOnce(mockCategories);

        const res = await request(app)
            .get('/api/servers/sv1/categories')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual(mockCategories);
        expect(mockDbManager.allServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('ORDER BY position ASC'), ['sv1']);
    });

    it('GET /api/servers/:serverId/categories should return empty array if none', async () => {
        mockDbManager.allServerQuery.mockResolvedValueOnce([]);

        const res = await request(app)
            .get('/api/servers/sv1/categories')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('POST /api/servers/:serverId/categories should create category', async () => {
        const newCat = { id: 'cat1', server_id: 'sv1', name: 'NewCat', position: 0 };
        // requireRole checks: 1) account is_creator, 2) profile role
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ is_creator: 0 }); // Not node creator
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1', role: 'OWNER' });
        mockDbManager.runServerQuery.mockResolvedValueOnce(true); // Insert
        mockDbManager.getServerQuery.mockResolvedValueOnce(newCat); // Select back

        const res = await request(app)
            .post('/api/servers/sv1/categories')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ name: 'NewCat', position: 0 });

        expect(res.status).toBe(200);
        expect(res.body).toEqual(newCat);
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('INSERT INTO channel_categories'), [expect.any(String), 'sv1', 'NewCat', 0]);
    });

    it('POST /api/servers/:serverId/categories should reject non-owner/admin (403)', async () => {
        // requireRole checks account first, then profile
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ is_creator: 0 }); // Not node creator
        // Return a profile with MEMBER role
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1', role: 'MEMBER' });
        // allServerQuery for guild roles in requireRole middleware (no admin roles either)
        mockDbManager.allServerQuery.mockResolvedValueOnce([]);

        const res = await request(app)
            .post('/api/servers/sv1/categories')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ name: 'NewCat', position: 0 });

        expect(res.status).toBe(403);
        expect(res.body).toHaveProperty('error');
    });

    it('PUT /api/categories/:categoryId should rename category', async () => {
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ is_creator: 0 }); // Not node creator
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1', role: 'ADMIN' });
        mockDbManager.runServerQuery.mockResolvedValueOnce(true);

        const res = await request(app)
            .put('/api/categories/cat1')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ name: 'RenamedCat', serverId: 'sv1' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true });
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('UPDATE channel_categories SET name = ?'), ['RenamedCat', 'cat1']);
    });

    it('DELETE /api/categories/:categoryId should remove category', async () => {
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ is_creator: 0 }); // Not node creator
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1', role: 'OWNER' });
        mockDbManager.runServerQuery.mockResolvedValueOnce(true);

        const res = await request(app)
            .delete('/api/categories/cat1')
            .set('Authorization', `Bearer ${testToken}`)
            .query({ serverId: 'sv1' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, message: 'Category deleted' });
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('DELETE FROM channel_categories'), ['cat1']);
    });

    it('DELETE /api/categories/:categoryId should propagate errors', async () => {
        mockDbManager.getNodeQuery.mockResolvedValueOnce({ is_creator: 0 }); // Not node creator
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1', role: 'OWNER' });
        mockDbManager.runServerQuery.mockRejectedValueOnce(new Error('DB error'));

        const res = await request(app)
            .delete('/api/categories/cat1?serverId=sv1')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('DB error');
    });
});
