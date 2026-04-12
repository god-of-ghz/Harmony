import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../src/app';

const testToken = generateToken('acc1');

// Mock DB Manager
const mockDbManager = vi.hoisted(() => ({
    allNodeQuery: vi.fn(),
    allServerQuery: vi.fn(),
    getServerQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([{ id: 'sv1' }]),
    nodeDbPath: 'mock_data_dir/node.db',
    DATA_DIR: 'mock_data_dir',
    SERVERS_DIR: 'mock_servers_dir',
}));

vi.mock('../src/database', () => ({
    SERVERS_DIR: 'mock_servers_dir',
    DATA_DIR: 'mock_data_dir',
    nodeDbPath: 'mock_data_dir/node.db',
    default: mockDbManager
}));

const mockBroadcast = vi.fn();
const app = createApp(mockDbManager, mockBroadcast);

describe('Search and Context Endpoints', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/servers/:serverId/search', () => {
        it('should return search results with user identities', async () => {
            const fakeMessages = [
                { id: 'm1', content: 'hello disease', channel_id: 'ch1', author_id: 'p1', channel_name: 'general', account_id: 'acc1' }
            ];
            mockDbManager.allServerQuery
                .mockResolvedValueOnce(fakeMessages)
                .mockResolvedValueOnce([]); // mock reactions
            mockDbManager.allNodeQuery.mockResolvedValueOnce([{ id: 'acc1', public_key: 'pub1' }]);

            const res = await request(app).get('/api/servers/sv1/search?query=disease').set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].content).toBe('hello disease');
            expect(res.body[0].public_key).toBe('pub1');
            expect(mockDbManager.allServerQuery).toHaveBeenCalledWith(
                'sv1',
                expect.stringContaining('m.content LIKE ?'),
                ['sv1', '%disease%']
            );
        });

        it('should return empty array if no query is provided', async () => {
            const res = await request(app).get('/api/servers/sv1/search').set('Authorization', `Bearer ${testToken}`);
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it('should handle DB errors gracefully', async () => {
            mockDbManager.allServerQuery.mockRejectedValueOnce(new Error('DB Error'));
            const res = await request(app).get('/api/servers/sv1/search?query=test').set('Authorization', `Bearer ${testToken}`);
            expect(res.status).toBe(500);
            expect(res.body.error).toBe('DB Error');
        });
    });

    describe('GET /api/channels/:channelId/messages/around/:messageId', () => {
        it('should return context messages centered on target', async () => {
            const targetMsg = { id: 'm2', timestamp: '2024-01-01T12:00:00Z', channel_id: 'ch1' };
            const beforeMsg = { id: 'm1', timestamp: '2024-01-01T11:59:00Z', channel_id: 'ch1' };
            const afterMsg = { id: 'm3', timestamp: '2024-01-01T12:01:00Z', channel_id: 'ch1' };

            // mock findServerId
            mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Mock Server' }]);
            mockDbManager.getServerQuery.mockImplementation(async (svr: string, query: string) => {
                if (query.includes('FROM channels')) return { server_id: 'sv1' };
                if (query.includes('FROM messages WHERE id = ?')) return targetMsg;
                return null;
            });

            // Mock before and after queries
            // Node: Context fetch returns 'before' list in DESC order, then 'after' in ASC
            mockDbManager.allServerQuery
                .mockResolvedValueOnce([targetMsg, beforeMsg]) // before
                .mockResolvedValueOnce([afterMsg]) // after
                .mockResolvedValueOnce([]); // mock reactions
            
            mockDbManager.allNodeQuery.mockResolvedValue([]);

            const res = await request(app).get('/api/channels/ch1/messages/around/m2').set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(3);
            expect(res.body[0].id).toBe('m1');
            expect(res.body[1].id).toBe('m2');
            expect(res.body[2].id).toBe('m3');
        });

        it('should return 404 if message not found', async () => {
            mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1' }]);
            mockDbManager.getServerQuery.mockImplementation(async (svr: string, query: string) => {
                if (query.includes('FROM channels')) return { server_id: 'sv1' };
                return null; // message not found
            });

            const res = await request(app).get('/api/channels/ch1/messages/around/mUnknown').set('Authorization', `Bearer ${testToken}`);
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Target message not found');
        });

        it('should return 404 if server context not found', async () => {
            mockDbManager.getAllLoadedServers.mockResolvedValue([]);
            const res = await request(app).get('/api/channels/chUnknown/messages/around/m1').set('Authorization', `Bearer ${testToken}`);
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Server context not found');
        });
    });
});
