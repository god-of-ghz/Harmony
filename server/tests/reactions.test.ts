import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../src/app';

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
const validToken = generateToken('acc1');

describe('Reactions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getServerQuery.mockImplementation(async (server, query) => {
            if (query.includes('FROM channels') && !query.includes('server_id')) return { server_id: 'sv1' };
            if (query.includes('FROM profiles')) return { id: 'p1' };
            return null;
        });
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Mock Server' }]);
    });

    it('POST /api/channels/:channelId/messages/:messageId/reactions adds a reaction', async () => {
        mockDbManager.runServerQuery.mockResolvedValue(undefined);
        const res = await request(app)
            .post('/api/channels/c1/messages/m1/reactions')
            .set('Authorization', `Bearer ${validToken}`)
            .send({ emoji: '👍' });
        expect(res.status).toBe(200);
        expect(res.body.emoji).toBe('👍');
        expect(res.body.author_id).toBe('p1');
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('INSERT OR IGNORE INTO message_reactions'), ['m1', 'p1', '👍']);
        expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'REACTION_ADD', data: { message_id: 'm1', author_id: 'p1', emoji: '👍', channel_id: 'c1' } }));
    });

    it('DELETE /api/channels/:channelId/messages/:messageId/reactions/:emoji removes a reaction', async () => {
        mockDbManager.runServerQuery.mockResolvedValue(undefined);
        const res = await request(app)
            .delete('/api/channels/c1/messages/m1/reactions/👍')
            .set('Authorization', `Bearer ${validToken}`);
        expect(res.status).toBe(200);
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('DELETE FROM message_reactions'), ['m1', 'p1', '👍']);
        expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'REACTION_REMOVE', data: { message_id: 'm1', author_id: 'p1', emoji: '👍', channel_id: 'c1' } }));
    });

    it('should reject spoofed x-account-id without a valid token (401)', async () => {
        const res = await request(app)
            .post('/api/channels/c1/messages/m1/reactions')
            .set('x-account-id', 'other-acc')
            .send({ emoji: '🔥' });
        expect(res.status).toBe(401);
    });
});
