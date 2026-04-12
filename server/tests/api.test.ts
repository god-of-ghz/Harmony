import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../src/app';

// Mock DB
const mockDbManager = vi.hoisted(() => ({
    allNodeQuery: vi.fn(),
    getNodeQuery: vi.fn(),
    runNodeQuery: vi.fn(),
    allServerQuery: vi.fn(),
    getServerQuery: vi.fn(),
    runServerQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([{ id: 'sv1' }]),
}));

vi.mock('../src/database', () => ({
    DATA_DIR: 'mock_data_dir',
    SERVERS_DIR: 'mock_servers_dir',
    default: mockDbManager
}));

const mockBroadcast = vi.fn();
const app = createApp(mockDbManager, mockBroadcast);
const testToken = generateToken('acc1');

describe('Custom Emojis API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET /api/servers/:serverId/emojis should return 401 without token', async () => {
        const res = await request(app).get('/api/servers/sv1/emojis');
        expect(res.status).toBe(401);
    });

    it('GET /api/servers/:serverId/emojis should return 403 if user not in server', async () => {
        mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_admin: 0 }); // Not global admin
        mockDbManager.getServerQuery.mockResolvedValue(null); // No profile on server
        
        const res = await request(app).get('/api/servers/sv1/emojis').set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error).toContain('access to this server');
    });

    it('GET /api/servers/:serverId/emojis should return emojis if user has access', async () => {
        mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_admin: 0 });
        mockDbManager.getServerQuery.mockResolvedValue({ id: 'p1' }); // Profile exists
        
        const fakeEmojis = [
            { id: 'e1', name: 'smile', url: '/smile.png', animated: 0 },
            { id: 'e2', name: 'dance', url: '/dance.gif', animated: 1 }
        ];
        mockDbManager.allServerQuery.mockResolvedValue(fakeEmojis);

        const res = await request(app).get('/api/servers/sv1/emojis').set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual(fakeEmojis);
        expect(mockDbManager.allServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('SELECT id, name, url, animated FROM server_emojis'), ['sv1']);
    });

    it('GET /api/servers/:serverId/emojis should return 200 (even if empty array) for global admins even without profile', async () => {
        mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 1, is_admin: 1 }); // Global admin
        mockDbManager.allServerQuery.mockResolvedValue([]);

        const res = await request(app).get('/api/servers/sv1/emojis').set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});
