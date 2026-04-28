import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp, generateToken } from '../src/app';

/**
 * Generate a P-256 keypair and sign content in IEEE P1363 format,
 * matching the client's Web Crypto API behavior.
 */
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

// Test keypair
const testKeys = generateTestKeypair();
const otherKeys = generateTestKeypair();

const mockDbManager = vi.hoisted(() => ({
    channelToServerId: {
        get: (id: string) => String(id).includes('Unknown') ? null : 'sv1',
        set: () => {},
    channelToGuildId: { get: (id) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} },
        delete: () => {},
    },
    allNodeQuery: vi.fn().mockResolvedValue([]),
    getNodeQuery: vi.fn(),
    runNodeQuery: vi.fn(),
    allServerQuery: vi.fn().mockResolvedValue([]),
    allGuildQuery: vi.fn().mockResolvedValue([]),
    getServerQuery: vi.fn(),
    getGuildQuery: vi.fn(),
    runServerQuery: vi.fn(),
    runGuildQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([]),
    getAllLoadedGuilds: vi.fn().mockResolvedValue([]),
    initializeServerBundle: vi.fn(),
    initializeGuildBundle: vi.fn(),
    unloadServerInstance: vi.fn(),
    unloadGuildInstance: vi.fn(),
}));

vi.mock('../src/database', () => ({
    DATA_DIR: 'mock_data',
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

const accountId = 'test-account-1';
const profileId = 'test-profile-1';
const validToken = generateToken(accountId);

describe('Message Signature Verification — Route Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    /**
     * Helper to set up standard mocks for a successful message send flow.
     * The caller can override specific behaviors after calling this.
     */
    function setupStandardMocks(publicKey: string = testKeys.publicKeyBase64) {
        // getNodeQuery handles: admin check, public_key lookup, AND is_deactivated check (RBAC)
        mockDbManager.getNodeQuery.mockImplementation(async (_sql: string, params?: any[]) => {
            if (params && params[0] === accountId) {
                return { is_creator: 1, is_admin: 1, public_key: publicKey, is_deactivated: 0 };
            }
            return null;
        });

        // getServerQuery (aliased as getGuildQuery) handles:
        // 1. RBAC: profile with membership_status ('SELECT id, role FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?')
        // 2. Message route: profile ownership check ('SELECT account_id FROM profiles WHERE id = ? AND server_id = ?')
        // 3. Message route: author info ('nickname as username')
        // 4. RBAC: @everyone role check ('SELECT permissions FROM roles WHERE name = ?')
        mockDbManager.getServerQuery.mockImplementation(async (_serverId: string, sql: string, params?: any[]) => {
            if (sql.includes('membership_status')) {
                return { id: profileId, role: 'OWNER', account_id: accountId };
            }
            if (sql.includes('FROM profiles') && sql.includes('account_id')) {
                return { account_id: accountId };
            }
            if (sql.includes('nickname as username')) {
                return { username: 'TestUser', avatar: '', account_id: accountId };
            }
            if (sql.includes('FROM roles') && sql.includes('name = ?')) {
                return null; // No @everyone role — DEFAULT_USER_PERMS will be used
            }
            return null;
        });

        // allServerQuery (aliased as allGuildQuery) handles RBAC role permission aggregation
        mockDbManager.allServerQuery.mockImplementation(async (_serverId: string, sql: string, _params?: any[]) => {
            if (sql.includes('FROM roles r JOIN profile_roles')) {
                return []; // No extra roles assigned
            }
            return [];
        });

        mockDbManager.runServerQuery.mockResolvedValue(undefined);
    }

    it('should accept a message with a valid signature', async () => {
        setupStandardMocks();

        const content = 'Hello from the signed world!';
        const signature = signContent(content, testKeys.privateKey);

        const res = await request(app)
            .post('/api/channels/chan1/messages?serverId=sv1')
            .set('Authorization', `Bearer ${validToken}`)
            .send({ content, authorId: profileId, signature });

        expect(res.status).toBe(200);
        expect(res.body.content).toBe(content);
        expect(res.body.signature).toBe(signature);
    });

    it('should reject a message with tampered content (signature mismatch)', async () => {
        setupStandardMocks();

        const originalContent = 'Legitimate message content';
        const signature = signContent(originalContent, testKeys.privateKey);

        const res = await request(app)
            .post('/api/channels/chan1/messages?serverId=sv1')
            .set('Authorization', `Bearer ${validToken}`)
            .send({ content: 'TAMPERED content!', authorId: profileId, signature });

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('Message integrity check failed');
    });

    it('should reject a message with a mismatched public key', async () => {
        // Use a different account public key than the one that signed
        setupStandardMocks(otherKeys.publicKeyBase64);

        const content = 'Message signed with wrong key';
        const signature = signContent(content, testKeys.privateKey);

        const res = await request(app)
            .post('/api/channels/chan1/messages?serverId=sv1')
            .set('Authorization', `Bearer ${validToken}`)
            .send({ content, authorId: profileId, signature });

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('Message integrity check failed');
    });

    it('should reject a message with a missing signature from an authenticated account', async () => {
        setupStandardMocks();

        const res = await request(app)
            .post('/api/channels/chan1/messages?serverId=sv1')
            .set('Authorization', `Bearer ${validToken}`)
            .send({ content: 'No signature here!', authorId: profileId });

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('Signature required');
    });

    it('should reject a message when account has no public key', async () => {
        // Account has no public_key
        setupStandardMocks('');

        const content = 'Message from account without keys';
        const signature = signContent(content, testKeys.privateKey);

        const res = await request(app)
            .post('/api/channels/chan1/messages?serverId=sv1')
            .set('Authorization', `Bearer ${validToken}`)
            .send({ content, authorId: profileId, signature });

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('Account has no public key');
    });

    it('should bypass signature verification for encrypted messages (Phase 1 gap)', async () => {
        setupStandardMocks();

        const res = await request(app)
            .post('/api/channels/chan1/messages?serverId=sv1')
            .set('Authorization', `Bearer ${validToken}`)
            .send({
                content: 'encrypted-ciphertext-blob',
                authorId: profileId,
                is_encrypted: true,
                // No signature needed for encrypted messages
            });

        expect(res.status).toBe(200);
        expect(res.body.is_encrypted).toBe(1);
    });

    it('should reject an empty signature string from a non-encrypted message', async () => {
        setupStandardMocks();

        const res = await request(app)
            .post('/api/channels/chan1/messages?serverId=sv1')
            .set('Authorization', `Bearer ${validToken}`)
            .send({ content: 'Test', authorId: profileId, signature: '' });

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('Signature required');
    });

    it('should accept messages with unicode content and valid signature', async () => {
        setupStandardMocks();

        const content = '🔐 Hello こんにちは مرحبا';
        const signature = signContent(content, testKeys.privateKey);

        const res = await request(app)
            .post('/api/channels/chan1/messages?serverId=sv1')
            .set('Authorization', `Bearer ${validToken}`)
            .send({ content, authorId: profileId, signature });

        expect(res.status).toBe(200);
        expect(res.body.content).toBe(content);
    });

    it('should accept a media-only message with empty content and valid signature', async () => {
        setupStandardMocks();

        const content = '';
        const signature = signContent(content, testKeys.privateKey);

        const res = await request(app)
            .post('/api/channels/chan1/messages?serverId=sv1')
            .set('Authorization', `Bearer ${validToken}`)
            .send({
                content,
                authorId: profileId,
                signature,
                attachments: JSON.stringify(['/uploads/video.mp4']),
            });

        expect(res.status).toBe(200);
        expect(res.body.content).toBe('');
        expect(res.body.attachments).toBe(JSON.stringify(['/uploads/video.mp4']));
    });
});
