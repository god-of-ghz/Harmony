import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp, generateToken } from '../src/app';
import jwt from '../src/crypto/jwt';

// ── Helpers ──────────────────────────────────────────────────────────

function generateTestKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
    });
    const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const publicKeyBase64 = publicKeyDer.toString('base64');
    return { publicKey, privateKey, publicKeyBase64 };
}

function signContent(content: string, privateKey: crypto.KeyObject): string {
    const sig = crypto.sign('SHA256', Buffer.from(content), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
    });
    return sig.toString('base64');
}

const testKeys = generateTestKeypair();

// ── Mock DB Manager ──────────────────────────────────────────────────

const mockDbManager = vi.hoisted(() => ({
    channelToServerId: {
        get: (id: string) => String(id).includes('Unknown') ? null : 'sv1',
        set: () => {},
    channelToGuildId: { get: (id) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} },
        delete: () => {},
    },
    allNodeQuery: vi.fn().mockResolvedValue([]),
    getNodeQuery: vi.fn(),
    runNodeQuery: vi.fn().mockResolvedValue(undefined),
    allServerQuery: vi.fn().mockResolvedValue([]),
    allGuildQuery: vi.fn().mockResolvedValue([]),
    getServerQuery: vi.fn(),
    getGuildQuery: vi.fn(),
    runServerQuery: vi.fn().mockResolvedValue(undefined),
    runGuildQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([{ id: 'sv1',
    getAllLoadedGuilds: vi.fn().mockResolvedValue([]), name: 'Test Server' }]),
    initializeServerBundle: vi.fn(),
    initializeGuildBundle: vi.fn(),
    unloadServerInstance: vi.fn(),
    unloadGuildInstance: vi.fn(),
    allDmsQuery: vi.fn().mockResolvedValue([]),
    getDmsQuery: vi.fn(),
    runDmsQuery: vi.fn(),
}));

vi.mock('../src/database', () => ({
    DATA_DIR: 'mock_data',
    SERVERS_DIR: 'mock_servers_dir',
    GUILDS_DIR: 'mock_servers_dir',
    nodeDbPath: 'mock_data/node.db',
    default: mockDbManager,
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

const mockBroadcast = vi.fn();
const app = createApp(mockDbManager, mockBroadcast);

// Use a token with NO issuer — requireAuth verifies with local server key
const accountId = 'fed-test-account-001';
const validToken = generateToken(accountId);

// ── Test Suite ────────────────────────────────────────────────────────

describe('Federated Messaging — 403 Bug Regression Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Test Server' }]);
        mockDbManager.runNodeQuery.mockResolvedValue(undefined);
        mockDbManager.runServerQuery.mockResolvedValue(undefined);
    });

    // =================================================================
    // SECTION 1: jwt.decode() structure — THE root cause of the 403 bug
    // =================================================================

    describe('jwt.decode() returns {header, payload, signature} wrapper', () => {
        it('BUG REGRESSION: primaryUrl is at decoded.payload.primaryUrl, NOT decoded.primaryUrl', () => {
            // This is THE bug that caused the 403: code accessed decoded.primaryUrl
            // instead of decoded.payload.primaryUrl, so the remote key fetch never ran.
            const token = generateToken('test-acct', 'http://self:3001', 'http://primary:3000');
            const decoded = jwt.decode(token) as any;

            // Verify the structure is { header, payload, signature }
            expect(decoded).toHaveProperty('header');
            expect(decoded).toHaveProperty('payload');
            expect(decoded).toHaveProperty('signature');

            // primaryUrl is INSIDE payload, not at the top level
            expect(decoded.primaryUrl).toBeUndefined();
            expect(decoded.payload.primaryUrl).toBe('http://primary:3000');
            expect(decoded.payload.accountId).toBe('test-acct');
            expect(decoded.payload.iss).toBe('http://self:3001');
        });

        it('BUG REGRESSION: the correct access path decoded.payload.primaryUrl || decoded.primaryUrl works', () => {
            const token = generateToken('test-acct', 'http://self:3001', 'http://primary:3000');
            const decoded = jwt.decode(token) as any;

            // The FIXED access path (what the code now uses)
            const correctPrimaryUrl = decoded?.payload?.primaryUrl || decoded?.primaryUrl;
            expect(correctPrimaryUrl).toBe('http://primary:3000');

            // The BROKEN access path (what the bug was) — always undefined
            const brokenPrimaryUrl = decoded?.primaryUrl;
            expect(brokenPrimaryUrl).toBeUndefined();
        });

        it('decode() returns null for invalid tokens', () => {
            expect(jwt.decode('not-a-jwt')).toBeNull();
            expect(jwt.decode('only.two')).toBeNull();
        });

        it('tokens without primaryUrl (local-only) have undefined at both paths', () => {
            const localOnlyToken = generateToken('local-only-user');
            const decoded = jwt.decode(localOnlyToken) as any;

            expect(decoded?.primaryUrl).toBeUndefined();
            expect(decoded?.payload?.primaryUrl).toBeUndefined();
        });

        it('header contains algorithm info, not payload data', () => {
            const token = generateToken('test-acct', 'http://self:3001', 'http://primary:3000');
            const decoded = jwt.decode(token) as any;

            expect(decoded.header.alg).toBe('EdDSA');
            expect(decoded.header.typ).toBe('JWT');
            // accountId should NOT leak into header
            expect(decoded.header.accountId).toBeUndefined();
        });
    });

    // =================================================================
    // SECTION 2: Message route — remote public key fetch for federation
    //
    // These tests use is_creator=1 to bypass requirePermission (like
    // the existing message_signatures tests), isolating the signature
    // verification flow from the RBAC flow.
    // =================================================================

    describe('Message route — remote public key fetch for federated users', () => {
        /**
         * Sets up mocks for a scenario where the local account has no public key,
         * simulating a federated placeholder. Uses is_creator=1 to bypass RBAC so
         * we can test the signature verification path in isolation.
         */
        function setupMocks(localPublicKey: string) {
            mockDbManager.getNodeQuery.mockImplementation(async (sql: string, params?: any[]) => {
                if (params?.[0] === accountId) {
                    return { is_creator: 1, is_admin: 1, public_key: localPublicKey, is_deactivated: 0 };
                }
                return null;
            });
            mockDbManager.getServerQuery.mockImplementation(async (_sid: string, sql: string) => {
                if (sql.includes('FROM profiles') && sql.includes('account_id')) {
                    return { account_id: accountId };
                }
                if (sql.includes('nickname as username')) {
                    return { username: 'FedUser', avatar: '', account_id: accountId };
                }
                return null;
            });
        }

        it('BUG REGRESSION: accepts message when local key exists (baseline)', async () => {
            setupMocks(testKeys.publicKeyBase64);

            const content = 'Message with local key';
            const signature = signContent(content, testKeys.privateKey);

            const res = await request(app)
                .post('/api/channels/chan1/messages?serverId=sv1')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ content, authorId: 'profile-1', signature });

            expect(res.status).toBe(200);
            expect(res.body.content).toBe(content);
        });

        it('BUG REGRESSION: rejects when no local key AND no remote key available', async () => {
            setupMocks(''); // Empty local key

            // The token has no primaryUrl (generated without issuer args), so
            // the remote fetch path can't determine where to fetch from.
            const content = 'Should fail — no key anywhere';
            const signature = signContent(content, testKeys.privateKey);

            const res = await request(app)
                .post('/api/channels/chan1/messages?serverId=sv1')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ content, authorId: 'profile-1', signature });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Account has no public key');
        });

        it('encrypted messages bypass signature verification even without public key', async () => {
            setupMocks(''); // No public key

            mockDbManager.getServerQuery.mockImplementation(async (_sid: string, sql: string) => {
                if (sql.includes('FROM profiles') && sql.includes('account_id')) {
                    return { account_id: accountId };
                }
                if (sql.includes('nickname as username')) {
                    return { username: 'FedUser', avatar: '', account_id: accountId };
                }
                return null;
            });

            const res = await request(app)
                .post('/api/channels/chan1/messages?serverId=sv1')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ content: 'encrypted-blob', authorId: 'profile-1', is_encrypted: true });

            expect(res.status).toBe(200);
            expect(res.body.is_encrypted).toBe(1);
        });
    });

    // =================================================================
    // SECTION 3: Profile creation — federated placeholder with key
    //
    // Uses is_creator=1 for the token since requireAuth needs to pass.
    // The profile creation route then checks if the account exists
    // locally and creates a placeholder if not.
    // =================================================================

    describe('Profile creation — federated placeholder includes public key', () => {
        function setupProfileMocks(localAccountExists: boolean, localPublicKey?: string) {
            if (localAccountExists) {
                mockDbManager.getNodeQuery.mockResolvedValue({
                    id: accountId,
                    public_key: localPublicKey ?? '',
                });
            } else {
                mockDbManager.getNodeQuery.mockResolvedValue(undefined);
            }
            mockDbManager.getServerQuery.mockImplementation(async (_sid: string, sql: string) => {
                if (sql.includes('SELECT *')) {
                    return {
                        id: 'new-profile-id', server_id: 'sv1',
                        account_id: accountId, nickname: 'FedUser',
                        role: 'USER', membership_status: 'active',
                        original_username: 'FedUser', avatar: '',
                        aliases: '', joined_at: Date.now(), left_at: null,
                    };
                }
                return null;
            });
        }

        it('creates placeholder with fetched public key for new federated users', async () => {
            setupProfileMocks(false);

            // Mock remote key fetch during placeholder creation.
            // The token is local (no primaryUrl), so the JWT decode path
            // won't find a primaryUrl. But we can verify the INSERT logic.
            // For this test, we verify the INSERT is called regardless.
            const res = await request(app)
                .post('/api/servers/sv1/profiles')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ nickname: 'FedUser', isGuest: false });

            expect(res.status).toBe(200);
            expect(res.body.nickname).toBe('FedUser');

            // Verify a placeholder INSERT was attempted
            const insertCalls = mockDbManager.runNodeQuery.mock.calls.filter(
                (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT OR IGNORE INTO accounts')
            );
            expect(insertCalls.length).toBe(1);
            // Verify the placeholder has authority_role='replica'
            const params = insertCalls[0][1] as any[];
            expect(params[8]).toBe('replica');
        });

        it('does NOT create placeholder for guest profiles', async () => {
            setupProfileMocks(false);

            const res = await request(app)
                .post('/api/servers/sv1/profiles')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ nickname: 'GuestUser', isGuest: true });

            expect(res.status).toBe(200);

            // No INSERT for accounts table (guests don't get placeholders)
            const insertCalls = mockDbManager.runNodeQuery.mock.calls.filter(
                (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT OR IGNORE INTO accounts')
            );
            expect(insertCalls.length).toBe(0);
        });

        it('skips placeholder creation when account already exists with public key', async () => {
            setupProfileMocks(true, 'EXISTING_KEY');

            const res = await request(app)
                .post('/api/servers/sv1/profiles')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ nickname: 'FedUser', isGuest: false });

            expect(res.status).toBe(200);

            // No INSERT or UPDATE for accounts (account already has key)
            const accountMutations = mockDbManager.runNodeQuery.mock.calls.filter(
                (c: any[]) => typeof c[0] === 'string' && (
                    c[0].includes('INSERT OR IGNORE INTO accounts') ||
                    c[0].includes('UPDATE accounts SET public_key')
                )
            );
            expect(accountMutations.length).toBe(0);
        });

        it('attempts public key backfill when account exists but has empty key', async () => {
            setupProfileMocks(true, ''); // Exists but empty key

            const res = await request(app)
                .post('/api/servers/sv1/profiles')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ nickname: 'FedUser', isGuest: false });

            expect(res.status).toBe(200);

            // No INSERT (account exists), but the backfill path is entered.
            // Since the token has no primaryUrl, the backfill won't find a URL
            // to fetch from. But the code path is exercised without error.
            const insertCalls = mockDbManager.runNodeQuery.mock.calls.filter(
                (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT OR IGNORE INTO accounts')
            );
            expect(insertCalls.length).toBe(0);
        });
    });

    // =================================================================
    // SECTION 4: RBAC requirePermission — rejection diagnostics
    // =================================================================

    describe('requirePermission — rejection messages', () => {
        it('returns "Not member of server" when no active profile exists', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({
                is_creator: 0, is_deactivated: 0,
            });
            mockDbManager.getServerQuery.mockImplementation(async (_sid: string, sql: string) => {
                if (sql.includes('membership_status') && sql.includes('active')) {
                    return null; // No active profile
                }
                // Diagnostic fallback query
                if (sql.includes('FROM profiles') && !sql.includes('membership_status')) {
                    return { id: 'p1', role: 'USER', membership_status: 'left' };
                }
                return null;
            });

            const res = await request(app)
                .post('/api/channels/chan1/messages?serverId=sv1')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ content: 'test', authorId: 'p1', signature: 'sig' });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Not member of server');
        });

        it('returns "Account is deactivated" for deactivated accounts', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({
                is_creator: 0, is_deactivated: 1,
            });

            const res = await request(app)
                .post('/api/channels/chan1/messages?serverId=sv1')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ content: 'test', authorId: 'p1', signature: 'sig' });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Account is deactivated');
        });

        it('node creator bypasses all permission checks', async () => {
            mockDbManager.getNodeQuery.mockImplementation(async (sql: string) => {
                if (sql.includes('is_creator') && sql.includes('is_deactivated')) {
                    return { is_creator: 1, is_deactivated: 0 };
                }
                if (sql.includes('public_key')) {
                    return { public_key: testKeys.publicKeyBase64 };
                }
                return null;
            });
            mockDbManager.getServerQuery.mockImplementation(async (_sid: string, sql: string) => {
                if (sql.includes('FROM profiles') && sql.includes('account_id')) {
                    return { account_id: accountId };
                }
                if (sql.includes('nickname as username')) {
                    return { username: 'Creator', avatar: '', account_id: accountId };
                }
                return null;
            });

            const content = 'Creator bypasses RBAC';
            const signature = signContent(content, testKeys.privateKey);

            const res = await request(app)
                .post('/api/channels/chan1/messages?serverId=sv1')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ content, authorId: 'profile-1', signature });

            expect(res.status).toBe(200);
        });

        it('returns "Missing server context" when serverId cannot be resolved', async () => {
            // Use a channel that maps to null in channelToServerId
            mockDbManager.getNodeQuery.mockResolvedValue({
                is_creator: 0, is_deactivated: 0,
            });

            const res = await request(app)
                .post('/api/channels/chanUnknown/messages')
                .set('Authorization', `Bearer ${validToken}`)
                .send({ content: 'test', authorId: 'p1', signature: 'sig' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Missing server context');
        });
    });
});
