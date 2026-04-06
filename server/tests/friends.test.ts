import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

// Mock DB 
const mockDbManager = vi.hoisted(() => ({
    allNodeQuery: vi.fn(),
    getNodeQuery: vi.fn(),
    runNodeQuery: vi.fn(),
    allServerQuery: vi.fn().mockResolvedValue([]),
    getServerQuery: vi.fn(),
    runServerQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([{ id: 'sv1' }]),
}));
vi.mock('../src/database', () => ({
    SERVERS_DIR: 'mock_servers_dir',
    DATA_DIR: 'mock_data_dir',
    nodeDbPath: 'mock_data_dir/node.db',
    default: mockDbManager
}));
vi.mock('fs', () => ({ default: { rmSync: vi.fn(), existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn() } }));

const mockBroadcast = vi.fn();
const app = createApp(mockDbManager, mockBroadcast);

describe('Friends & Relationships (Node DB)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('POST /api/accounts/relationships/request sends a friend request', async () => {
        mockDbManager.getNodeQuery.mockResolvedValue(null);
        mockDbManager.runNodeQuery.mockResolvedValue(undefined);

        const res = await request(app).post('/api/accounts/relationships/request').set('x-account-id', 'acc1').send({ targetId: 'acc2' });
        expect(res.status).toBe(200);
        expect(mockDbManager.getNodeQuery).toHaveBeenCalled();
        expect(mockDbManager.runNodeQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO relationships'), ['acc1', 'acc2', 'pending', expect.any(Number)]);
        expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'RELATIONSHIP_UPDATE', data: { account_id: 'acc1', target_id: 'acc2', status: 'pending' } }));
    });

    it('PUT /api/accounts/relationships/accept accepts a friend request', async () => {
        mockDbManager.runNodeQuery.mockResolvedValue(undefined);

        const res = await request(app).put('/api/accounts/relationships/accept').set('x-account-id', 'acc1').send({ targetId: 'acc2' });
        expect(res.status).toBe(200);
        expect(mockDbManager.runNodeQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE relationships SET status'), ['friend', 'acc2', 'acc1', 'pending']);
        expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'RELATIONSHIP_UPDATE', data: { account_id: 'acc2', target_id: 'acc1', status: 'friend' } }));
    });

    it('DELETE /api/accounts/relationships/:targetId removes a relationship', async () => {
        mockDbManager.runNodeQuery.mockResolvedValue(undefined);

        const res = await request(app).delete('/api/accounts/relationships/acc2').set('x-account-id', 'acc1');
        expect(res.status).toBe(200);
        expect(mockDbManager.runNodeQuery).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM relationships'), ['acc1', 'acc2', 'acc2', 'acc1']);
        expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'RELATIONSHIP_UPDATE', data: { account_id: 'acc1', target_id: 'acc2', status: 'none' } }));
    });
});
