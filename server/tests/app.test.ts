import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
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
        const hash = crypto.createHash('sha256').update('password').digest('hex');
        mockDb.getQuery.mockResolvedValue({ id: 'acc1', email: 'test@test.com', is_creator: 0, password_hash: hash });
        mockDb.allQuery.mockResolvedValue([{ server_url: 'http://trusted' }]);

        const res = await request(app).post('/api/accounts/login').send({ email: 'test@test.com', password: 'password' });
        expect(res.status).toBe(200);
        expect(res.body.email).toBe('test@test.com');
        expect(res.body.trusted_servers).toEqual(['http://trusted']);
    });

    it('POST /api/accounts/login should try federating to initialServerUrl if local hash fails', async () => {
        mockDb.getQuery.mockResolvedValue(null); // Local user not found
        // mock trusted servers
        mockDb.allQuery.mockResolvedValue([]);
        // mock fetch
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ account: { id: 'acc2', email: 'test@test.com', password_hash: 'hash', is_creator: 0, updated_at: 100 }, trusted_servers: ['http://fed'] })
        });

        const res = await request(app).post('/api/accounts/login').send({ email: 'test@test.com', password: 'password', initialServerUrl: 'http://foo' });
        expect(res.status).toBe(200);
        expect(res.body.trusted_servers).toEqual(['http://fed']);
        expect(global.fetch).toHaveBeenCalledWith('http://foo/api/accounts/federate', expect.any(Object));
    });

    it('POST /api/guest/login should return a guest id', async () => {
        const res = await request(app).post('/api/guest/login');
        expect(res.status).toBe(200);
        expect(res.body.isGuest).toBe(true);
        expect(res.body.id).toContain('guest-');
    });

    it('GET /api/accounts/:accountId/profiles should return profiles from DB', async () => {
        const fakeProfiles = [{ id: 'p1', username: 'bob' }];
        mockDb.allQuery.mockResolvedValue(fakeProfiles);

        const res = await request(app).get('/api/accounts/acc1/profiles');
        expect(res.status).toBe(200);
        expect(res.body).toEqual(fakeProfiles);
        expect(mockDb.allQuery).toHaveBeenCalledWith('SELECT * FROM profiles WHERE account_id = ?', ['acc1']);
    });

    it('POST /api/accounts/federate should return account and trusted_servers on valid credentials', async () => {
        const hash = crypto.createHash('sha256').update('password').digest('hex');
        mockDb.getQuery.mockResolvedValue({ id: 'acc1', email: 'test@test.com', password_hash: hash });
        mockDb.allQuery.mockResolvedValue([{ server_url: 'http://trusted' }]);

        const res = await request(app).post('/api/accounts/federate').send({ email: 'test@test.com', password: 'password' });
        expect(res.status).toBe(200);
        expect(res.body.account.email).toBe('test@test.com');
        expect(res.body.trusted_servers).toEqual(['http://trusted']);
    });

    it('POST /api/accounts/federate should return 401 on invalid credentials', async () => {
        mockDb.getQuery.mockResolvedValue(null);
        const res = await request(app).post('/api/accounts/federate').send({ email: 'test@test.com', password: 'wrong' });
        expect(res.status).toBe(401);
    });

    it('POST /api/accounts/sync should update account if incoming is newer', async () => {
        mockDb.getQuery.mockResolvedValue({ updated_at: 100 });
        mockDb.runQuery.mockResolvedValue(undefined);

        const res = await request(app).post('/api/accounts/sync').send({
            account: { id: 'acc1', email: 'test@test.com', password_hash: 'hash', is_creator: 0, updated_at: 200 },
            trusted_servers: ['http://new']
        });
        expect(res.status).toBe(200);
        expect(mockDb.runQuery).toHaveBeenCalledWith(
            'UPDATE accounts SET email = ?, password_hash = ?, is_creator = ?, updated_at = ? WHERE id = ?',
            ['test@test.com', 'hash', 0, 200, 'acc1']
        );
    });

    it('POST /api/accounts/:accountId/trusted_servers should push identity sync to new server', async () => {
        mockDb.runQuery.mockResolvedValue(undefined);
        mockDb.getQuery.mockResolvedValue({ id: 'acc1', email: 'test@test.com' }); // full account
        mockDb.allQuery.mockResolvedValue([{ server_url: 'http://new' }]); // trusted list

        global.fetch = vi.fn().mockResolvedValue({ ok: true });

        const res = await request(app).post('/api/accounts/acc1/trusted_servers').send({ serverUrl: 'http://new' });
        expect(res.status).toBe(200);

        // Assert fetch was called to push sync
        expect(global.fetch).toHaveBeenCalledWith('http://new/api/accounts/sync', expect.objectContaining({
            method: 'POST'
        }));
    });

    it('POST /api/guest/merge should update profile account_id', async () => {
        mockDb.runQuery.mockResolvedValue(undefined);
        const res = await request(app).post('/api/guest/merge').send({ profileId: 'p1', serverId: 's1', accountId: 'acc1' });
        expect(res.status).toBe(200);
        expect(mockDb.runQuery).toHaveBeenCalledWith(
            'UPDATE profiles SET account_id = ? WHERE id = ? AND server_id = ?',
            ['acc1', 'p1', 's1']
        );
    });
});
