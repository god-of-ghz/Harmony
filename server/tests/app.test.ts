import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

// Mock DB
export const mockDb = {
    allQuery: vi.fn(),
    getQuery: vi.fn(),
    runQuery: vi.fn(),
};

vi.mock('../src/database', () => ({
    allQuery: (...args: any) => mockDb.allQuery(...args),
    getQuery: (...args: any) => mockDb.getQuery(...args),
    runQuery: (...args: any) => mockDb.runQuery(...args),
}));

const mockBroadcast = vi.fn();

const app = createApp(mockDb, mockBroadcast);

describe('Harmony Express App', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET /api/health should return ok', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });

    it('GET /api/servers should return servers from DB', async () => {
        const fakeServers = [{ id: '1', name: 'Server A' }];
        mockDb.allQuery.mockResolvedValue(fakeServers);

        const res = await request(app).get('/api/servers');
        expect(res.status).toBe(200);
        expect(res.body).toEqual(fakeServers);
        expect(mockDb.allQuery).toHaveBeenCalledWith('SELECT * FROM servers');
    });

    it('GET /api/servers/:serverId/channels should return channels', async () => {
        const fakeChannels = [{ id: '10', name: 'general' }];
        mockDb.allQuery.mockResolvedValue(fakeChannels);

        const res = await request(app).get('/api/servers/sv1/channels');
        expect(res.status).toBe(200);
        expect(res.body).toEqual(fakeChannels);
        expect(mockDb.allQuery).toHaveBeenCalledWith('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC', ['sv1']);
    });

    it('GET /api/channels/:channelId/messages should utilize cursor and limit pagination', async () => {
        const fakeMessages = [{ id: 'm1', content: 'test', timestamp: '2023' }];
        mockDb.allQuery.mockResolvedValue(fakeMessages);

        const res = await request(app).get('/api/channels/ch1/messages?limit=50&cursor=2024');
        expect(res.status).toBe(200);

        // Ensure SQL query contains timestamp check and limit
        const callArgs = mockDb.allQuery.mock.calls[0];
        expect(callArgs[0]).toContain('m.timestamp < ?');
        expect(callArgs[0]).toContain('LIMIT ?');
        expect(callArgs[1]).toEqual(['ch1', '2024', 50]);
    });

    it('GET /api/channels/:channelId/messages uses LEFT JOIN to prevent orphaned messages dropping', async () => {
        const fakeMessages = [{ id: 'm1', content: 'test', timestamp: '2023', username: 'UnknownProfileOrRole' }];
        mockDb.allQuery.mockResolvedValue(fakeMessages);

        const res = await request(app).get('/api/channels/ch1/messages');
        expect(res.status).toBe(200);
        expect(res.body[0].username).toBe('UnknownProfileOrRole');

        const callArgs = mockDb.allQuery.mock.calls[0];
        expect(callArgs[0]).toContain('LEFT JOIN profiles p');
        expect(callArgs[0]).toContain("COALESCE(p.nickname, 'UnknownProfileOrRole')");
    });

    it('POST /api/channels/:channelId/messages should broadcast and insert', async () => {
        mockDb.runQuery.mockResolvedValue(undefined);
        mockDb.getQuery.mockImplementation(async (query: string) => {
            if (query.includes('channels')) return { server_id: 'sv1' };
            if (query.includes('profiles')) return { username: 'bob', avatar: 'pic' };
            return null;
        });

        const payload = { content: 'hello', authorId: 'u1' };
        const res = await request(app).post('/api/channels/ch1/messages').send(payload);

        expect(res.status).toBe(200);
        expect(res.body.content).toBe('hello');
        expect(res.body.username).toBe('bob');
        expect(mockDb.runQuery).toHaveBeenCalled();
        expect(mockBroadcast).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'NEW_MESSAGE',
                data: expect.objectContaining({ content: 'hello' })
            })
        );
    });

    it('DELETE /api/servers/:serverId should delete the server from DB', async () => {
        mockDb.runQuery.mockResolvedValue(undefined);
        mockDb.getQuery.mockImplementation(async (query: string) => {
            if (query.includes('accounts')) return { is_creator: 0 };
            if (query.includes('profiles')) return { role: 'OWNER' };
            return null;
        });

        const res = await request(app)
            .delete('/api/servers/sv1')
            .set('X-Account-Id', 'acc1');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockDb.runQuery).toHaveBeenCalledWith('DELETE FROM servers WHERE id = ?', ['sv1']);
    });

    it('PUT /api/accounts/password should hash and save new password', async () => {
        mockDb.runQuery.mockResolvedValue(undefined);
        const res = await request(app).put('/api/accounts/password').send({ email: 'test@test.com', newPassword: 'newpassword' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockDb.runQuery).toHaveBeenCalledWith('UPDATE accounts SET password_hash = ? WHERE email = ?', [expect.any(String), 'test@test.com']);
    });

    it('POST /api/accounts/signup should create account', async () => {
        mockDb.runQuery.mockResolvedValue(undefined);
        mockDb.getQuery.mockResolvedValue({ id: 'acc1', email: 'test@test.com', is_creator: 0 });
        const res = await request(app).post('/api/accounts/signup').send({ email: 'test@test.com', password: 'password' });
        expect(res.status).toBe(200);
        expect(res.body.email).toBe('test@test.com');
    });

    it('POST /api/accounts/login should return account', async () => {
        mockDb.getQuery.mockResolvedValue({ id: 'acc1', email: 'test@test.com', is_creator: 0 });
        const res = await request(app).post('/api/accounts/login').send({ email: 'test@test.com', password: 'password' });
        expect(res.status).toBe(200);
        expect(res.body.email).toBe('test@test.com');
    });

    it('GET /api/accounts/:accountId/profiles should return profiles from DB', async () => {
        const fakeProfiles = [{ id: 'p1', username: 'bob' }];
        mockDb.allQuery.mockResolvedValue(fakeProfiles);

        const res = await request(app).get('/api/accounts/acc1/profiles');
        expect(res.status).toBe(200);
        expect(res.body).toEqual(fakeProfiles);
        expect(mockDb.allQuery).toHaveBeenCalledWith('SELECT * FROM profiles WHERE account_id = ?', ['acc1']);
    });
});
