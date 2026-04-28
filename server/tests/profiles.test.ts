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
    getAllLoadedGuilds: vi.fn().mockResolvedValue([])}, { id: 'sv2' }]),
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

describe('Profiles Routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1' }, { id: 'sv2' }]);
    });

    it('POST /api/servers/:serverId/profiles should create profile for registered user', async () => {
        mockDbManager.runServerQuery.mockResolvedValueOnce(true);
        mockDbManager.getServerQuery.mockResolvedValueOnce({ id: 'p1', account_id: 'acc1', nickname: 'TestUser' });

        const res = await request(app)
            .post('/api/servers/sv1/profiles')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ nickname: 'TestUser' });

        expect(res.status).toBe(200);
        expect(res.body.id).toBe('p1');
        // Check exact params: id, server_id, account_id, original, nickname, avatar, role
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('INSERT INTO profiles'), [expect.any(String), 'sv1', 'acc1', 'TestUser', 'TestUser', '', 'USER']);
    });

    it('POST /api/servers/:serverId/profiles should create guest profile', async () => {
        mockDbManager.runServerQuery.mockResolvedValueOnce(true);
        mockDbManager.getServerQuery.mockResolvedValueOnce({ id: 'p2', account_id: null, nickname: 'Guest' });

        const res = await request(app)
            .post('/api/servers/sv1/profiles')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ nickname: 'Guest', isGuest: true });

        expect(res.status).toBe(200);
        // Ensure account_id is null for guest
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('INSERT INTO profiles'), [expect.any(String), 'sv1', null, 'Guest', 'Guest', '', 'USER']);
    });

    it('GET /api/servers/:serverId/profiles should return all profiles for a server', async () => {
        mockDbManager.allServerQuery.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]);

        const res = await request(app)
            .get('/api/servers/sv1/profiles')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
        expect(mockDbManager.allServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('SELECT * FROM profiles'), ['sv1']);
    });

    it('PATCH /api/servers/:serverId/profiles/:profileId should update nickname', async () => {
        // Auth check - requires own profile
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1' }); 
        mockDbManager.runServerQuery.mockResolvedValueOnce(true);
        mockDbManager.getServerQuery.mockResolvedValueOnce({ id: 'p1', nickname: 'NewNick' });

        const res = await request(app)
            .patch('/api/servers/sv1/profiles/p1')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ nickname: 'NewNick' });

        expect(res.status).toBe(200);
        expect(res.body.nickname).toBe('NewNick');
        // Ensure only nickname was updated
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('UPDATE profiles SET nickname = ? WHERE id = ?'), ['NewNick', 'p1']);
    });

    it('PATCH /api/servers/:serverId/profiles/:profileId should update avatar', async () => {
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc1' }); 
        mockDbManager.runServerQuery.mockResolvedValueOnce(true);
        mockDbManager.getServerQuery.mockResolvedValueOnce({ id: 'p1', avatar: 'http://pic' });

        const res = await request(app)
            .patch('/api/servers/sv1/profiles/p1')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ avatar: 'http://pic' });

        expect(res.status).toBe(200);
        expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('UPDATE profiles SET avatar = ? WHERE id = ?'), ['http://pic', 'p1']);
    });

    it('PATCH /api/servers/:serverId/profiles/:profileId should reject updating another user profile (403)', async () => {
        // Return someone else's account id
        mockDbManager.getServerQuery.mockResolvedValueOnce({ account_id: 'acc_other' });

        const res = await request(app)
            .patch('/api/servers/sv1/profiles/p1')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ nickname: 'Hacked' });

        expect(res.status).toBe(403);
    });

    it('GET /api/accounts/:accountId/profiles should return aggregated profiles from multiple servers', async () => {
        // Two loaded servers (sv1, sv2). allServerQuery should be called twice.
        mockDbManager.allServerQuery.mockResolvedValueOnce([{ id: 'p_sv1', server_id: 'sv1' }])
                                    .mockResolvedValueOnce([{ id: 'p_sv2', server_id: 'sv2' }]);

        const res = await request(app)
            .get('/api/accounts/acc1/profiles')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(2);
        expect(res.body[0].id).toBe('p_sv1');
        expect(res.body[1].id).toBe('p_sv2');
    });

    it('GET /api/accounts/:accountId/profile should return the first global profile found', async () => {
        // First server has no profile
        mockDbManager.getServerQuery.mockResolvedValueOnce(null)
                                    // Second server has a profile
                                    .mockResolvedValueOnce({ id: 'p_sv2', server_id: 'sv2' });

        const res = await request(app)
            .get('/api/accounts/acc1/profile')
            .set('Authorization', `Bearer ${testToken}`);

        expect(res.status).toBe(200);
        expect(res.body.id).toBe('p_sv2');
    });

    describe('Global Profiles & Federation', () => {
        it('PUT /api/profiles/global should convert relative avatar URL to absolute URL using primary_server_url', async () => {
            // Mock getting the current version
            mockDbManager.getNodeQuery.mockResolvedValueOnce({ version: 1 });
            // Mock getting the primary_server_url (for relative→absolute conversion)
            mockDbManager.getNodeQuery.mockResolvedValueOnce({ primary_server_url: 'http://my-primary.local' });
            // Mock returning the updated profile at the end
            mockDbManager.getNodeQuery.mockResolvedValueOnce({ account_id: 'acc1', avatar_url: 'http://my-primary.local/avatars/new.png' });
            // Mock account_servers query for federation push (return empty — no replicas)
            mockDbManager.allNodeQuery.mockResolvedValueOnce([]);

            const res = await request(app)
                .put('/api/profiles/global')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    bio: 'Testing',
                    avatar_url: '/avatars/new.png' // Relative URL
                });

            expect(res.status).toBe(200);
            
            // Verify runNodeQuery was called to UPSERT global_profiles
            const updateCall = mockDbManager.runNodeQuery.mock.calls.find((c: any[]) => c[0].includes('INSERT INTO global_profiles'));
            expect(updateCall).toBeDefined();
            
            // The params passed to the query: [accountId, bio, avatar, status, version, signature]
            // We expect the avatar param to be explicitly absolute
            expect(updateCall[1][2]).toBe('http://my-primary.local/avatars/new.png');
        });

        it('PUT /api/profiles/global should leave already absolute avatar URLs untouched', async () => {
            mockDbManager.getNodeQuery.mockResolvedValueOnce({ version: 1 });
            mockDbManager.getNodeQuery.mockResolvedValueOnce({ account_id: 'acc1', avatar_url: 'https://external.local/pic.png' });
            mockDbManager.allNodeQuery.mockResolvedValueOnce([]);

            const res = await request(app)
                .put('/api/profiles/global')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    bio: 'Testing',
                    avatar_url: 'https://external.local/pic.png' // Absolute URL
                });

            expect(res.status).toBe(200);
            
            const updateCall = mockDbManager.runNodeQuery.mock.calls.find((c: any[]) => c[0].includes('INSERT INTO global_profiles'));
            expect(updateCall[1][2]).toBe('https://external.local/pic.png');
        });

        it('PUT /api/profiles/global should push signed profile to all account_servers via federation', async () => {
            mockDbManager.getNodeQuery.mockResolvedValueOnce({ version: 1 });
            // Updated profile returned
            mockDbManager.getNodeQuery.mockResolvedValueOnce({ account_id: 'acc1', bio: 'Test', avatar_url: 'http://pic.com/a.png', version: 2 });
            // Return two replica servers in account_servers
            mockDbManager.allNodeQuery.mockResolvedValueOnce([
                { server_url: 'http://replica1.local' },
                { server_url: 'http://replica2.local' }
            ]);

            const res = await request(app)
                .put('/api/profiles/global')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    bio: 'Test',
                    avatar_url: 'http://pic.com/a.png'
                });

            expect(res.status).toBe(200);

            // The federation push is fire-and-forget async, so we need a brief delay
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify allNodeQuery was called to get account_servers
            expect(mockDbManager.allNodeQuery).toHaveBeenCalledWith(
                'SELECT server_url FROM account_servers WHERE account_id = ?',
                ['acc1']
            );
        });
    });

    describe('POST /api/federation/profile-update (receiving end)', () => {
        it('should reject with 400 if required fields are missing', async () => {
            const res = await request(app)
                .post('/api/federation/profile-update')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Missing required fields');
        });

        it('should reject with 401 if signature is invalid', async () => {
            const res = await request(app)
                .post('/api/federation/profile-update')
                .send({
                    profile: {
                        account_id: 'acc1',
                        bio: 'hacked',
                        avatar_url: 'http://evil.com/pic.png',
                        status_message: '',
                        version: 5,
                        signature: 'totally-fake-sig'
                    },
                    primaryPublicKey: 'also-fake'
                });

            expect(res.status).toBe(401);
            expect(res.body.error).toContain('Invalid signature');
        });

        it('should skip update if local version is already up to date', async () => {
            // Local version is already at 5
            mockDbManager.getNodeQuery.mockResolvedValueOnce({ version: 5 });

            // We need a real valid signature — use the pki module
            const crypto = await import('crypto');
            const testKey = crypto.generateKeyPairSync('ed25519');
            const { signDelegationPayload: sign } = await import('../src/crypto/pki');

            const payload = {
                account_id: 'acc1',
                bio: 'old',
                avatar_url: '',
                status_message: '',
                version: 3 // older than local version 5
            };
            const signature = sign(payload, testKey.privateKey);
            const pubKeyB64 = (testKey.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');

            const res = await request(app)
                .post('/api/federation/profile-update')
                .send({
                    profile: { ...payload, signature },
                    primaryPublicKey: pubKeyB64
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Already up to date');

            // Ensure NO upsert was performed
            expect(mockDbManager.runNodeQuery).not.toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO global_profiles'),
                expect.anything()
            );
        });

        it('should accept valid signed profile and update local cache + per-server profiles', async () => {
            const crypto = await import('crypto');
            const testKey = crypto.generateKeyPairSync('ed25519');
            const { signDelegationPayload: sign } = await import('../src/crypto/pki');

            const payload = {
                account_id: 'acc1',
                bio: 'new bio',
                avatar_url: 'http://primary.local/avatars/new.png',
                status_message: 'hello',
                version: 10
            };
            const signature = sign(payload, testKey.privateKey);
            const pubKeyB64 = (testKey.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');

            // Local version is outdated
            mockDbManager.getNodeQuery.mockResolvedValueOnce({ version: 5 });
            // getAllLoadedServers returns one mock server
            mockDbManager.getAllLoadedServers.mockResolvedValueOnce([{ id: 'sv1' }]);
            // getServerQuery returns the updated profile for broadcast
            mockDbManager.getServerQuery.mockResolvedValueOnce({ id: 'prof-1', account_id: 'acc1', avatar: payload.avatar_url });

            const res = await request(app)
                .post('/api/federation/profile-update')
                .send({
                    profile: { ...payload, signature },
                    primaryPublicKey: pubKeyB64
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Verify global_profiles was updated
            const upsertCall = mockDbManager.runNodeQuery.mock.calls.find((c: any[]) => c[0].includes('INSERT INTO global_profiles'));
            expect(upsertCall).toBeDefined();
            expect(upsertCall[1][0]).toBe('acc1');
            expect(upsertCall[1][2]).toBe('http://primary.local/avatars/new.png');
            expect(upsertCall[1][4]).toBe(10);

            // Verify per-server profile was updated
            expect(mockDbManager.runServerQuery).toHaveBeenCalledWith(
                'sv1',
                'UPDATE profiles SET avatar = ? WHERE account_id = ?',
                ['http://primary.local/avatars/new.png', 'acc1']
            );

            // Verify broadcast was emitted
            expect(mockBroadcast).toHaveBeenCalledWith({
                type: 'PROFILE_UPDATE',
                data: { id: 'prof-1', account_id: 'acc1', avatar: payload.avatar_url }
            });
        });
    });
});
