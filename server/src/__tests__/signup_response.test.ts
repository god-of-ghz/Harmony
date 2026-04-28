import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import dbManager from '../database';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../database', () => ({
    default: {
        runNodeQuery: vi.fn(),
        getNodeQuery: vi.fn(),
        allNodeQuery: vi.fn().mockResolvedValue([]),
        runServerQuery: vi.fn(),
        getServerQuery: vi.fn(),
        allServerQuery: vi.fn(),
        getAllLoadedServers: vi.fn().mockResolvedValue([]),
    },
    DATA_DIR: '/mock-data',
    SERVERS_DIR: '/mock-data/servers',
}));

const { publicKey: realPubKey, privateKey: realPrivKey } = vi.hoisted(() => {
    const nodeCrypto = require('node:crypto');
    return nodeCrypto.generateKeyPairSync('ed25519');
});

vi.mock('../crypto/pki', () => ({
    verifyDelegationSignature: vi.fn(),
    signDelegationPayload: vi.fn().mockReturnValue('mock-signature'),
    getServerIdentity: vi.fn(() => ({ publicKey: realPubKey, privateKey: realPrivKey })),
    fetchRemotePublicKey: vi.fn().mockResolvedValue(realPubKey),
}));

vi.mock('../utils/federationFetch', () => ({
    federationFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }), status: 200 }),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/accounts/signup — Response shape', () => {
    const mockBroadcast = vi.fn();
    let app: any;
    let storedAccount: any = null;
    let storedPrimaryUrl: string | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        storedAccount = null;
        storedPrimaryUrl = null;
        (dbManager.allNodeQuery as any).mockResolvedValue([]);
        (dbManager.getAllLoadedServers as any).mockResolvedValue([]);

        // Wire the mock DB: track INSERTs and UPDATEs to accounts
        (dbManager.getNodeQuery as any).mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('FROM accounts WHERE email =')) return storedAccount;
            if (sql.includes('FROM accounts WHERE id =')) return storedAccount;
            if (sql.includes('is_creator')) return null;
            return null;
        });

        (dbManager.runNodeQuery as any).mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('INSERT INTO accounts')) {
                storedAccount = {
                    id: params[0], email: params[1], auth_verifier: params[2],
                    public_key: params[3], encrypted_private_key: params[4],
                    key_salt: params[5], key_iv: params[6], auth_salt: params[7],
                    is_creator: params[8], is_admin: params[9], authority_role: 'primary',
                    dismissed_global_claim: 0,
                };
            }
            if (sql.includes('UPDATE accounts SET primary_server_url')) {
                storedPrimaryUrl = params[0];
            }
        });

        app = createApp(dbManager, mockBroadcast);
    });

    const signupPayload = {
        email: 'test@example.com',
        serverAuthKey: 'some-server-auth-key',
        public_key: 'pub-key-1',
        encrypted_private_key: 'enc-priv-1',
        key_salt: 'ksalt',
        key_iv: 'kiv',
        auth_salt: 'asalt',
    };

    it('should include primary_server_url in the response', async () => {
        const res = await request(app)
            .post('/api/accounts/signup')
            .send(signupPayload);

        expect(res.status).toBe(200);
        expect(res.body.primary_server_url).toBeDefined();
        expect(typeof res.body.primary_server_url).toBe('string');
        expect(res.body.primary_server_url.length).toBeGreaterThan(0);
    });

    it('should include servers array with trust_level and status', async () => {
        const res = await request(app)
            .post('/api/accounts/signup')
            .send(signupPayload);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.servers)).toBe(true);
        expect(res.body.servers.length).toBeGreaterThanOrEqual(1);

        const entry = res.body.servers[0];
        expect(entry).toHaveProperty('url');
        expect(entry).toHaveProperty('trust_level', 'trusted');
        expect(entry).toHaveProperty('status', 'active');
    });

    it('should include dismissed_global_claim = false for new signups', async () => {
        const res = await request(app)
            .post('/api/accounts/signup')
            .send(signupPayload);

        expect(res.status).toBe(200);
        expect(res.body.dismissed_global_claim).toBe(false);
    });

    it('primary_server_url should match the server URL in the servers array', async () => {
        const res = await request(app)
            .post('/api/accounts/signup')
            .send(signupPayload);

        expect(res.status).toBe(200);
        expect(res.body.servers[0].url).toBe(res.body.primary_server_url);
    });

    it('should persist primary_server_url in the database', async () => {
        const res = await request(app)
            .post('/api/accounts/signup')
            .send(signupPayload);

        expect(res.status).toBe(200);
        // Verify the UPDATE was called
        expect(storedPrimaryUrl).not.toBeNull();
        expect(storedPrimaryUrl).toBe(res.body.primary_server_url);
    });

    it('primary_server_url should reflect the HOST header, not a hardcoded value', async () => {
        // Simulate the request coming to an arbitrary non-3001 server
        const res = await request(app)
            .post('/api/accounts/signup')
            .set('Host', 'my-homelab.local:9999')
            .send(signupPayload);

        expect(res.status).toBe(200);
        // The URL should contain the custom host — NOT localhost:3001
        expect(res.body.primary_server_url).toContain('my-homelab.local:9999');
        expect(res.body.primary_server_url).not.toContain('localhost:3001');
        expect(res.body.servers[0].url).toContain('my-homelab.local:9999');
    });

    it('primary_server_url should work with port 3002', async () => {
        const res = await request(app)
            .post('/api/accounts/signup')
            .set('Host', 'localhost:3002')
            .send(signupPayload);

        expect(res.status).toBe(200);
        expect(res.body.primary_server_url).toContain('localhost:3002');
        expect(res.body.servers[0].url).toContain('localhost:3002');
    });

    it('primary_server_url should work with a LAN IP address', async () => {
        const res = await request(app)
            .post('/api/accounts/signup')
            .set('Host', '192.168.1.100:3001')
            .send(signupPayload);

        expect(res.status).toBe(200);
        expect(res.body.primary_server_url).toContain('192.168.1.100:3001');
        expect(res.body.servers[0].url).toContain('192.168.1.100:3001');
    });

    it('signup and login responses should have the same shape', async () => {
        // Signup
        const signupRes = await request(app)
            .post('/api/accounts/signup')
            .send(signupPayload);

        expect(signupRes.status).toBe(200);

        // Login
        const loginRes = await request(app)
            .post('/api/accounts/login')
            .send({ email: signupPayload.email, serverAuthKey: signupPayload.serverAuthKey });

        expect(loginRes.status).toBe(200);

        // Both should have the same critical fields
        const signupKeys = Object.keys(signupRes.body);
        expect(signupKeys).toContain('primary_server_url');
        expect(signupKeys).toContain('servers');
        expect(signupKeys).toContain('dismissed_global_claim');
        expect(signupKeys).toContain('token');

        const loginKeys = Object.keys(loginRes.body);
        expect(loginKeys).toContain('primary_server_url');
        expect(loginKeys).toContain('servers');
        expect(loginKeys).toContain('dismissed_global_claim');
        expect(loginKeys).toContain('token');
    });
});
