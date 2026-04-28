import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp, generateToken } from '../src/app';

// Mock DB — uses vi.hoisted() for compatibility with vi.mock() factory
const mockDbManager = vi.hoisted(() => ({
    channelToServerId: { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set: () => {},
    channelToGuildId: { get: (id) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} }, delete: () => {} },
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
        mkdirSync: vi.fn()
    }
}));

// We need real PKI for delegation cert signing/verification
// Use the mocked getServerIdentity that the app already calls
const testKeyPair = crypto.generateKeyPairSync('ed25519');

vi.mock('../src/crypto/pki', async () => {
    const actual = await vi.importActual('../src/crypto/pki') as any;
    return {
        ...actual,
        getServerIdentity: () => ({
            publicKey: testKeyPair.publicKey,
            privateKey: testKeyPair.privateKey
        }),
    };
});

// Mock federationFetch to capture outbound calls
const mockFederationFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }), status: 200 });
vi.mock('../src/utils/federationFetch', () => ({
    federationFetch: (...args: any[]) => mockFederationFetch(...args),
}));

const { signDelegationPayload, verifyDelegationSignature } = await import('../src/crypto/pki');

const mockBroadcast = vi.fn();
const app = createApp(mockDbManager, mockBroadcast);
const testToken = generateToken('acc1');

/** Helper: create a valid delegation cert signed by our test keypair */
function createValidDelegationCert(accountId: string, targetUrl: string = 'http://target.local') {
    const payload = { userId: accountId, targetServerUrl: targetUrl, timestamp: Date.now() };
    const signature = signDelegationPayload(payload, testKeyPair.privateKey);
    const pubKeyB64 = (testKeyPair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
    return { payload, signature, primaryPublicKey: pubKeyB64 };
}

/** Helper: create an invalid delegation cert (signed by a different key) */
function createInvalidDelegationCert(accountId: string) {
    const badKey = crypto.generateKeyPairSync('ed25519');
    const payload = { userId: accountId, targetServerUrl: 'http://target.local', timestamp: Date.now() };
    const signature = signDelegationPayload(payload, badKey.privateKey);
    // Provide the REAL public key so the signature won't match
    const pubKeyB64 = (testKeyPair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
    return { payload, signature, primaryPublicKey: pubKeyB64 };
}

describe('Federation Lifecycle Endpoints', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1' }, { id: 'sv2' }]);
        mockDbManager.runNodeQuery.mockResolvedValue(undefined);
        mockDbManager.runServerQuery.mockResolvedValue(undefined);
        mockFederationFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }), status: 200 });
    });

    // ─── DEACTIVATE ─────────────────────────────────────────

    describe('POST /api/federation/deactivate', () => {
        it('should deactivate account and set profiles to left with valid cert', async () => {
            const cert = createValidDelegationCert('acc1');

            const res = await request(app)
                .post('/api/federation/deactivate')
                .send({ accountId: 'acc1', delegationCert: cert });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Account should be deactivated
            expect(mockDbManager.runNodeQuery).toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 1 WHERE id = ?',
                ['acc1']
            );

            // Profiles on both servers should be set to left
            expect(mockDbManager.runServerQuery).toHaveBeenCalledWith(
                'sv1',
                expect.stringContaining("membership_status = 'left'"),
                expect.arrayContaining([expect.any(Number), 'acc1'])
            );
            expect(mockDbManager.runServerQuery).toHaveBeenCalledWith(
                'sv2',
                expect.stringContaining("membership_status = 'left'"),
                expect.arrayContaining([expect.any(Number), 'acc1'])
            );
        });

        it('should return 401 with invalid delegation cert', async () => {
            const cert = createInvalidDelegationCert('acc1');

            const res = await request(app)
                .post('/api/federation/deactivate')
                .send({ accountId: 'acc1', delegationCert: cert });

            expect(res.status).toBe(401);
            expect(res.body.error).toContain('Invalid signature');
        });

        it('should return 400 with missing delegation cert fields', async () => {
            const res = await request(app)
                .post('/api/federation/deactivate')
                .send({ accountId: 'acc1', delegationCert: { payload: {} } });

            expect(res.status).toBe(400);
        });

        it('should return 400 when userId does not match accountId', async () => {
            const cert = createValidDelegationCert('acc2'); // signed for acc2

            const res = await request(app)
                .post('/api/federation/deactivate')
                .send({ accountId: 'acc1', delegationCert: cert }); // but sent for acc1

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Invalid delegation parameters');
        });
    });

    // ─── DEMOTE ─────────────────────────────────────────────

    describe('POST /api/federation/demote', () => {
        it('should change authority_role to replica with valid request', async () => {
            const cert = createValidDelegationCert('acc1');

            const res = await request(app)
                .post('/api/federation/demote')
                .send({
                    accountId: 'acc1',
                    newPrimaryUrl: 'http://new-primary.local',
                    delegationCert: cert
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            expect(mockDbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining("authority_role = 'replica'"),
                ['http://new-primary.local', 'acc1']
            );
        });

        it('should return 401 with invalid delegation cert', async () => {
            const cert = createInvalidDelegationCert('acc1');

            const res = await request(app)
                .post('/api/federation/demote')
                .send({
                    accountId: 'acc1',
                    newPrimaryUrl: 'http://new-primary.local',
                    delegationCert: cert
                });

            expect(res.status).toBe(401);
        });
    });

    // ─── PROMOTE ────────────────────────────────────────────

    describe('POST /api/federation/promote', () => {
        it('should complete full lifecycle with re-auth: promote, demote old, notify replicas', async () => {
            const cert = createValidDelegationCert('acc1');
            // The promote endpoint verifies password against the local account
            const salt = crypto.randomBytes(16).toString('hex');
            const hashedVerifier = crypto.scryptSync('testpassword', salt, 64).toString('hex');

            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc1',
                auth_verifier: `${salt}:${hashedVerifier}`,
                authority_role: 'replica',
                primary_server_url: 'http://old-primary.local'
            });

            // Other servers in account_servers
            mockDbManager.allNodeQuery.mockResolvedValue([
                { server_url: 'http://replica1.local' },
                { server_url: 'http://replica2.local' }
            ]);

            const res = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'acc1',
                    delegationCert: cert,
                    serverAuthKey: 'testpassword',
                    oldPrimaryUrl: 'http://old-primary.local'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toContain('promoted');

            // Should have promoted local account
            expect(mockDbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining("authority_role = 'primary'"),
                expect.arrayContaining(['acc1'])
            );

            // Allow time for the fire-and-forget async calls
            await new Promise(resolve => setTimeout(resolve, 100));

            // Should have called demote on old primary + replicas
            const demoteCalls = mockFederationFetch.mock.calls.filter(
                (c: any[]) => c[0].includes('/api/federation/demote')
            );

            // old primary + replica1 + replica2 = 3 calls
            expect(demoteCalls.length).toBe(3);

            // Verify URLs called
            const calledUrls = demoteCalls.map((c: any[]) => c[0]);
            expect(calledUrls).toContain('http://old-primary.local/api/federation/demote');
            expect(calledUrls).toContain('http://replica1.local/api/federation/demote');
            expect(calledUrls).toContain('http://replica2.local/api/federation/demote');
        });

        it('should return 401 without password', async () => {
            const cert = createValidDelegationCert('acc1');

            const res = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'acc1',
                    delegationCert: cert,
                    // No serverAuthKey
                    oldPrimaryUrl: 'http://old-primary.local'
                });

            expect(res.status).toBe(401);
            expect(res.body.error).toContain('Password required');
        });

        it('should return 401 with wrong password', async () => {
            const cert = createValidDelegationCert('acc1');
            const salt = crypto.randomBytes(16).toString('hex');
            const hashedVerifier = crypto.scryptSync('correctpassword', salt, 64).toString('hex');

            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc1',
                auth_verifier: `${salt}:${hashedVerifier}`,
            });

            const res = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'acc1',
                    delegationCert: cert,
                    serverAuthKey: 'wrongpassword',
                    oldPrimaryUrl: 'http://old-primary.local'
                });

            expect(res.status).toBe(401);
            expect(res.body.error).toContain('Invalid credentials');
        });

        it('should return 401 with invalid delegation cert', async () => {
            const cert = createInvalidDelegationCert('acc1');

            const res = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'acc1',
                    delegationCert: cert,
                    serverAuthKey: 'testpassword',
                    oldPrimaryUrl: 'http://old-primary.local'
                });

            expect(res.status).toBe(401);
        });
    });

    // ─── PASSWORD CHANGE PROPAGATION ────────────────────────

    describe('PUT /api/accounts/password', () => {
        it('should propagate password change to trusted servers', async () => {
            // Create a valid scrypt-hashed verifier for the "old" password
            const oldSalt = crypto.randomBytes(16).toString('hex');
            const oldHash = crypto.scryptSync('old-server-auth-key', oldSalt, 64).toString('hex');
            const authVerifier = `${oldSalt}:${oldHash}`;

            mockDbManager.getNodeQuery
                .mockResolvedValueOnce({
                    id: 'acc1', authority_role: 'primary', email: 'test@test.com',
                    auth_verifier: authVerifier
                }) // first SELECT: account by id (requireAuth pulls accountId from JWT)
                .mockResolvedValueOnce({ id: 'acc1', email: 'test@test.com', auth_verifier: 'new-verifier', updated_at: 999 }); // re-fetch updated account

            mockDbManager.allNodeQuery
                .mockResolvedValueOnce([ // trusted servers
                    { server_url: 'http://trusted1.local' },
                    { server_url: 'http://trusted2.local' }
                ])
                .mockResolvedValueOnce([ // all server URLs
                    { server_url: 'http://trusted1.local' },
                    { server_url: 'http://trusted2.local' }
                ]);

            const res = await request(app)
                .put('/api/accounts/password')
                .set('Authorization', `Bearer ${testToken}`) // testToken belongs to 'acc1'
                .send({
                    oldServerAuthKey: 'old-server-auth-key',
                    serverAuthKey: 'new-auth-key',
                    encrypted_private_key: 'new-enc-key',
                    key_salt: 'new-salt',
                    key_iv: 'new-iv'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Allow time for fire-and-forget async calls
            await new Promise(resolve => setTimeout(resolve, 100));

            // Should have called sync on trusted servers
            const syncCalls = mockFederationFetch.mock.calls.filter(
                (c: any[]) => c[0].includes('/api/accounts/sync')
            );
            expect(syncCalls.length).toBe(2);
        });

        it('should reject password change on replica', async () => {
            // Build a valid verifier so we get past the password check and hit the replica guard
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.scryptSync('current-key', salt, 64).toString('hex');
            const authVerifier = `${salt}:${hash}`;

            mockDbManager.getNodeQuery.mockResolvedValue({ id: 'acc1', authority_role: 'replica', auth_verifier: authVerifier });

            const res = await request(app)
                .put('/api/accounts/password')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    oldServerAuthKey: 'current-key',
                    serverAuthKey: 'new-auth-key',
                    encrypted_private_key: 'new-enc-key',
                    key_salt: 'new-salt',
                    key_iv: 'new-iv'
                });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Replica');
        });
    });

    // ─── SYNC DISMISSED_GLOBAL_CLAIM ────────────────────────

    describe('POST /api/accounts/sync', () => {
        it('should include dismissed_global_claim in the upserted data (UPDATE path)', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({ updated_at: 100 });

            const res = await request(app)
                .post('/api/accounts/sync')
                .send({
                    account: {
                        id: 'acc1', email: 'test@test.com',
                        auth_verifier: 'v', public_key: 'pk', encrypted_private_key: 'epk',
                        key_salt: 's', key_iv: 'iv', auth_salt: 'as',
                        is_creator: 0, is_admin: 0,
                        dismissed_global_claim: 1,
                        updated_at: 200
                    },
                    trusted_servers: ['http://srv1.local']
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Verify the UPDATE query includes dismissed_global_claim
            const updateCall = mockDbManager.runNodeQuery.mock.calls.find(
                (c: any[]) => c[0].includes('UPDATE accounts SET') && c[0].includes('dismissed_global_claim')
            );
            expect(updateCall).toBeDefined();
            // The dismissed_global_claim value should be in the params
            expect(updateCall![1]).toContain(1);
        });

        it('should include dismissed_global_claim in the upserted data (INSERT path)', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue(null); // no existing account

            const res = await request(app)
                .post('/api/accounts/sync')
                .send({
                    account: {
                        id: 'acc-new', email: 'new@test.com',
                        auth_verifier: 'v', public_key: 'pk', encrypted_private_key: 'epk',
                        key_salt: 's', key_iv: 'iv', auth_salt: 'as',
                        is_creator: 0, is_admin: 0,
                        dismissed_global_claim: 1,
                        updated_at: 200
                    },
                    trusted_servers: []
                });

            expect(res.status).toBe(200);

            // Verify the INSERT query includes dismissed_global_claim
            const insertCall = mockDbManager.runNodeQuery.mock.calls.find(
                (c: any[]) => c[0].includes('INSERT INTO accounts') && c[0].includes('dismissed_global_claim')
            );
            expect(insertCall).toBeDefined();
        });
    });

    // ─── REPLICA SYNC DISMISSED_GLOBAL_CLAIM ────────────────

    describe('POST /api/accounts/replica-sync', () => {
        it('should include dismissed_global_claim and set authority_role=replica', async () => {
            const cert = createValidDelegationCert('acc1');
            mockDbManager.getNodeQuery.mockResolvedValue({ updated_at: 100 });

            const res = await request(app)
                .post('/api/accounts/replica-sync')
                .send({
                    account: {
                        id: 'acc1', email: 'test@test.com',
                        auth_verifier: 'v', public_key: 'pk', encrypted_private_key: 'epk',
                        key_salt: 's', key_iv: 'iv', auth_salt: 'as',
                        is_creator: 0, is_admin: 0,
                        dismissed_global_claim: 1,
                        updated_at: 200
                    },
                    trusted_servers: ['http://srv1.local'],
                    delegationCert: cert,
                    primaryServerUrl: 'http://primary.local'
                });

            expect(res.status).toBe(200);

            // Verify UPDATE includes dismissed_global_claim and authority_role=replica
            const updateCall = mockDbManager.runNodeQuery.mock.calls.find(
                (c: any[]) => c[0].includes('UPDATE accounts SET') && c[0].includes('dismissed_global_claim')
            );
            expect(updateCall).toBeDefined();
            expect(updateCall![0]).toContain('authority_role');
            // Params should include 'replica' for authority_role
            expect(updateCall![1]).toContain('replica');
        });
    });

    // ─── DELETE TRUSTED SERVER SENDS DEACTIVATION ───────────

    describe('DELETE /api/accounts/:accountId/trusted_servers', () => {
        it('should send deactivation to the removed server', async () => {
            const res = await request(app)
                .delete('/api/accounts/acc1/trusted_servers')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ serverUrl: 'http://removed-server.local' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // Allow time for fire-and-forget async call
            await new Promise(resolve => setTimeout(resolve, 100));

            // Should have called federation/deactivate on the removed server
            const deactivateCalls = mockFederationFetch.mock.calls.filter(
                (c: any[]) => c[0].includes('/api/federation/deactivate')
            );
            expect(deactivateCalls.length).toBe(1);
            expect(deactivateCalls[0][0]).toBe('http://removed-server.local/api/federation/deactivate');
        });
    });

    // ================================================================
    // Phase 6 Supplementary: Deactivated account login rejection
    // ================================================================
    describe('Deactivated account login rejection', () => {
        it('should return 403 when a deactivated account tries to login', async () => {
            // Account exists but is deactivated
            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc-deact',
                email: 'deactivated@test.com',
                auth_verifier: 'validpass',
                is_creator: 0,
                is_admin: 0,
                is_deactivated: 1,
                authority_role: 'replica',
                primary_server_url: null,
            });

            const res = await request(app).post('/api/accounts/login').send({
                email: 'deactivated@test.com',
                serverAuthKey: 'validpass',
            });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('deactivated');
        });
    });

    // ================================================================
    // Phase 6 Supplementary: Account state endpoint
    // ================================================================
    describe('GET /api/accounts/:accountId/state', () => {
        it('should return correct server list and account state', async () => {
            const token = generateToken('acc1');
            mockDbManager.allNodeQuery.mockResolvedValue([
                { server_url: 'http://srv1.local', trust_level: 'trusted', status: 'active' },
                { server_url: 'http://srv2.local', trust_level: 'untrusted', status: 'disconnected' },
            ]);
            mockDbManager.getNodeQuery.mockResolvedValue({
                dismissed_global_claim: 1,
                authority_role: 'primary',
                primary_server_url: 'http://srv1.local',
            });

            const res = await request(app)
                .get('/api/accounts/acc1/state')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.servers).toHaveLength(2);
            expect(res.body.servers[0]).toEqual({ url: 'http://srv1.local', trust_level: 'trusted', status: 'active' });
            expect(res.body.servers[1]).toEqual({ url: 'http://srv2.local', trust_level: 'untrusted', status: 'disconnected' });
            expect(res.body.dismissed_global_claim).toBe(true);
            expect(res.body.authority_role).toBe('primary');
        });

        it('should forbid accessing another user\'s state', async () => {
            const token = generateToken('acc1');

            const res = await request(app)
                .get('/api/accounts/acc-other/state')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Forbidden');
        });
    });

    // ================================================================
    // Phase 6 Supplementary: Authority role transition chain
    // ================================================================
    describe('Authority role transition chain', () => {
        it('should track promote → demote: primary becomes replica', async () => {
            // Simulate promote call
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.scryptSync('mypassword', salt, 64).toString('hex');
            const verifier = `${salt}:${hash}`;

            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc-chain',
                email: 'chain@test.com',
                auth_verifier: verifier,
                is_creator: 0,
                is_admin: 0,
                authority_role: 'replica',
                primary_server_url: 'http://old-primary.com',
            });
            mockDbManager.allNodeQuery.mockResolvedValue([]);
            mockDbManager.runNodeQuery.mockResolvedValue(undefined);
            mockFederationFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

            // Build delegation cert
            const timestamp = Date.now();
            const payload = { userId: 'acc-chain', targetServerUrl: 'http://localhost:9999', timestamp };
            const signBuf = Buffer.from(JSON.stringify(payload));
            const signature = crypto.sign(null, signBuf, testKeyPair.privateKey).toString('base64');
            const pubKeyB64 = (testKeyPair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');

            const promoteRes = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'acc-chain',
                    serverAuthKey: 'mypassword',
                    oldPrimaryUrl: 'http://old-primary.com',
                    delegationCert: { payload, signature, primaryPublicKey: pubKeyB64 },
                });

            expect(promoteRes.status).toBe(200);
            expect(promoteRes.body.success).toBe(true);

            // Verify runNodeQuery was called to promote (set authority_role = primary)
            const promoteCalls = mockDbManager.runNodeQuery.mock.calls.filter(
                (c: any[]) => c[0].includes('authority_role') && c[0].includes('primary')
            );
            expect(promoteCalls.length).toBeGreaterThanOrEqual(1);

            // Now simulate demote call on the same account
            mockDbManager.runNodeQuery.mockClear();
            const demoteTimestamp = Date.now();
            const demotePayload = { userId: 'acc-chain', targetServerUrl: 'http://new-primary.com', timestamp: demoteTimestamp };
            const demoteSignBuf = Buffer.from(JSON.stringify(demotePayload));
            const demoteSignature = crypto.sign(null, demoteSignBuf, testKeyPair.privateKey).toString('base64');

            const demoteRes = await request(app)
                .post('/api/federation/demote')
                .send({
                    accountId: 'acc-chain',
                    newPrimaryUrl: 'http://new-primary.com',
                    delegationCert: { payload: demotePayload, signature: demoteSignature, primaryPublicKey: pubKeyB64 },
                });

            expect(demoteRes.status).toBe(200);
            expect(demoteRes.body.success).toBe(true);

            // Verify runNodeQuery was called to demote (set authority_role = replica)
            const demoteCalls = mockDbManager.runNodeQuery.mock.calls.filter(
                (c: any[]) => c[0].includes('authority_role') && c[0].includes('replica')
            );
            expect(demoteCalls.length).toBeGreaterThanOrEqual(1);
        });
    });
});
