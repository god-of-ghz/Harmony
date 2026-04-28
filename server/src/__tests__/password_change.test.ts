import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp, generateToken } from '../app';
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
    // vi.hoisted runs before ES imports are resolved, so we must use require()
    const nodeCrypto = require('node:crypto');
    return nodeCrypto.generateKeyPairSync('ed25519');
});

vi.mock('../crypto/pki', () => ({
    verifyDelegationSignature: vi.fn(),
    signDelegationPayload: vi.fn().mockReturnValue('mock-signature'),
    getServerIdentity: vi.fn(() => ({ publicKey: realPubKey, privateKey: realPrivKey })),
    // Return the same server public key for any issuer — in tests, all tokens are signed
    // by the same keypair regardless of their iss URL.
    fetchRemotePublicKey: vi.fn().mockResolvedValue(realPubKey),
}));

vi.mock('../utils/federationFetch', () => ({
    federationFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }), status: 200 }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a proper scrypt auth_verifier string (salt:hash) from a plaintext serverAuthKey.
 * Mirrors the signup path in app.ts.
 */
function makeAuthVerifier(serverAuthKey: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(serverAuthKey, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PUT /api/accounts/password — Secure Password Change', () => {
    const mockBroadcast = vi.fn();
    let app: any;
    const accountId = 'test-user-123';
    let token: string;

    beforeEach(() => {
        vi.clearAllMocks();
        (dbManager.allNodeQuery as any).mockResolvedValue([]);
        (dbManager.getAllLoadedServers as any).mockResolvedValue([]);
        app = createApp(dbManager, mockBroadcast);
        token = generateToken(accountId);
    });

    // ── Authentication guard ──────────────────────────────────────────────────

    it('should reject requests with no Authorization header (401)', async () => {
        const res = await request(app)
            .put('/api/accounts/password')
            .send({ oldServerAuthKey: 'old', serverAuthKey: 'new' });

        expect(res.status).toBe(401);
    });

    it('should reject requests with an invalid/expired token (401)', async () => {
        const res = await request(app)
            .put('/api/accounts/password')
            .set('Authorization', 'Bearer this-is-not-a-valid-jwt')
            .send({ oldServerAuthKey: 'old', serverAuthKey: 'new' });

        expect(res.status).toBe(401);
    });

    // ── Input validation ──────────────────────────────────────────────────────

    it('should reject when oldServerAuthKey is missing (400)', async () => {
        (dbManager.getNodeQuery as any).mockResolvedValue({
            id: accountId, auth_verifier: makeAuthVerifier('correct-old'), authority_role: 'primary'
        });

        const res = await request(app)
            .put('/api/accounts/password')
            .set('Authorization', `Bearer ${token}`)
            .send({ serverAuthKey: 'newkey' }); // no oldServerAuthKey

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/oldServerAuthKey/);
    });

    it('should reject when serverAuthKey (new) is missing (400)', async () => {
        (dbManager.getNodeQuery as any).mockResolvedValue({
            id: accountId, auth_verifier: makeAuthVerifier('correct-old'), authority_role: 'primary'
        });

        const res = await request(app)
            .put('/api/accounts/password')
            .set('Authorization', `Bearer ${token}`)
            .send({ oldServerAuthKey: 'old' }); // no serverAuthKey

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/serverAuthKey/);
    });

    // ── Current password verification ─────────────────────────────────────────

    it('should reject when the current (old) password is wrong (401)', async () => {
        (dbManager.getNodeQuery as any).mockResolvedValue({
            id: accountId,
            auth_verifier: makeAuthVerifier('correct-password'),
            authority_role: 'primary',
        });

        const res = await request(app)
            .put('/api/accounts/password')
            .set('Authorization', `Bearer ${token}`)
            .send({ oldServerAuthKey: 'wrong-password', serverAuthKey: 'new-password' });

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/Current password is incorrect/);
    });

    // ── Replica guard ─────────────────────────────────────────────────────────

    it('should reject password change on a replica server (403)', async () => {
        (dbManager.getNodeQuery as any).mockResolvedValue({
            id: accountId,
            auth_verifier: makeAuthVerifier('old-pw'),
            authority_role: 'replica',
        });

        const res = await request(app)
            .put('/api/accounts/password')
            .set('Authorization', `Bearer ${token}`)
            .send({ oldServerAuthKey: 'old-pw', serverAuthKey: 'new-pw' });

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Replica/);
    });

    // ── Success path ──────────────────────────────────────────────────────────

    it('should succeed with correct current password and update auth_verifier with scrypt hash', async () => {
        const oldKey = 'my-old-server-auth-key';
        const newKey = 'my-new-server-auth-key';

        (dbManager.getNodeQuery as any)
            .mockResolvedValueOnce({
                id: accountId,
                auth_verifier: makeAuthVerifier(oldKey),
                authority_role: 'primary',
            })
            .mockResolvedValueOnce({ id: accountId, auth_verifier: 'updated:hash', authority_role: 'primary' });

        const res = await request(app)
            .put('/api/accounts/password')
            .set('Authorization', `Bearer ${token}`)
            .send({
                oldServerAuthKey: oldKey,
                serverAuthKey: newKey,
                encrypted_private_key: 'enc-key',
                key_salt: 'new-salt',
                key_iv: 'new-iv',
                public_key: 'new-pub-key',
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify the DB was called with a scrypt-format auth_verifier (salt:hash)
        expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE accounts SET auth_verifier'),
            expect.arrayContaining([
                // First arg must be in the "salt:hex" format (not raw key)
                expect.stringMatching(/^[0-9a-f]+:[0-9a-f]{128}$/),
                'enc-key',
                'new-salt',
                'new-iv',
                'new-pub-key',
                accountId,
            ])
        );
    });

    it('should succeed without public_key and omit public_key from the SQL', async () => {
        const oldKey = 'old-key';
        const newKey = 'new-key';

        (dbManager.getNodeQuery as any)
            .mockResolvedValueOnce({
                id: accountId,
                auth_verifier: makeAuthVerifier(oldKey),
                authority_role: 'primary',
            })
            .mockResolvedValueOnce({ id: accountId });

        const res = await request(app)
            .put('/api/accounts/password')
            .set('Authorization', `Bearer ${token}`)
            .send({ oldServerAuthKey: oldKey, serverAuthKey: newKey });

        expect(res.status).toBe(200);

        // SQL should NOT contain 'public_key =' when no public_key was sent
        const runCall = (dbManager.runNodeQuery as any).mock.calls.find(
            (call: any[]) => call[0].includes('UPDATE accounts SET auth_verifier')
        );
        expect(runCall).toBeDefined();
        expect(runCall[0]).not.toContain('public_key');
    });

    it('should propagate the change to trusted replica servers via /api/accounts/sync', async () => {
        const { federationFetch } = await import('../utils/federationFetch');
        const oldKey = 'old-key';

        (dbManager.getNodeQuery as any)
            .mockResolvedValueOnce({
                id: accountId,
                auth_verifier: makeAuthVerifier(oldKey),
                authority_role: 'primary',
            })
            .mockResolvedValueOnce({ id: accountId, email: 'test@example.com' });

        (dbManager.allNodeQuery as any)
            .mockResolvedValueOnce([{ server_url: 'https://replica.example.com' }]) // trusted servers
            .mockResolvedValueOnce([{ server_url: 'https://replica.example.com' }]); // all server urls

        const res = await request(app)
            .put('/api/accounts/password')
            .set('Authorization', `Bearer ${token}`)
            .send({ oldServerAuthKey: oldKey, serverAuthKey: 'new-key' });

        expect(res.status).toBe(200);

        // Give the fire-and-forget propagation a tick to kick off
        await new Promise(r => setTimeout(r, 50));

        expect(federationFetch).toHaveBeenCalledWith(
            'https://replica.example.com/api/accounts/sync',
            expect.objectContaining({ method: 'POST' })
        );
    });
});

// ─── Round-trip Integration Test (system-style, mock DB) ─────────────────────
//
// This test simulates the FULL lifecycle:
// 1. Signup — creates account with scrypt-hashed verifier
// 2. Login — authenticates with original password
// 3. Change password — verifies old, hashes new
// 4. Login again — verifies new password works
// 5. Login with OLD password — verifies it's rejected
//
// Since we use the mock DB, we intercept the DB calls and simulate the state
// transitions manually, which verifies the endpoint logic end-to-end.

describe('Password Change — Round Trip (mock DB state machine)', () => {
    const mockBroadcast = vi.fn();
    let app: any;

    // Shared mutable state — simulates the DB row
    let storedAccount: any = null;

    beforeEach(() => {
        vi.clearAllMocks();
        storedAccount = null;
        app = createApp(dbManager, mockBroadcast);

        // Wire the mock DB to read/write storedAccount
        (dbManager.getNodeQuery as any).mockImplementation(async (sql: string, params: any[]) => {
            if (sql.includes('FROM accounts WHERE email =')) return storedAccount;
            if (sql.includes('FROM accounts WHERE id =')) return storedAccount;
            if (sql.includes('owner-exists') || sql.includes('is_creator')) return null;
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
            if (sql.includes('UPDATE accounts SET auth_verifier')) {
                // The SQL looks like:
                //   UPDATE accounts SET auth_verifier = ?, enc_pk = ?, key_salt = ?, key_iv = ?[, public_key = ?], updated_at = ... WHERE id = ?
                // auth_verifier is always first param [0]
                // accountId is always the last param
                storedAccount = {
                    ...storedAccount,
                    auth_verifier: params[0],
                    encrypted_private_key: params[1],
                    key_salt: params[2],
                    key_iv: params[3],
                };
            }
        });

        (dbManager.allNodeQuery as any).mockResolvedValue([]);
        (dbManager.getAllLoadedServers as any).mockResolvedValue([]);
    });

    it('full round-trip: signup → login → change password → login with new → reject old', async () => {
        // ── Step 1: Signup ────────────────────────────────────────────────────
        const signupRes = await request(app)
            .post('/api/accounts/signup')
            .send({
                email: 'roundtrip@test.com',
                serverAuthKey: 'initial-server-auth-key',  // already derived by client
                public_key: 'pub-key-v1',
                encrypted_private_key: 'enc-priv-v1',
                key_salt: 'ksalt-v1',
                key_iv: 'kiv-v1',
                auth_salt: 'authsalt-v1',
            });

        expect(signupRes.status).toBe(200);
        expect(signupRes.body.token).toBeDefined();

        const accountId = signupRes.body.id;
        const initialToken = signupRes.body.token;
        expect(storedAccount).not.toBeNull();

        // Verify the verifier is scrypt-hashed, NOT raw
        expect(storedAccount.auth_verifier).toMatch(/^[0-9a-f]+:[0-9a-f]{128}$/);
        const verifierAfterSignup = storedAccount.auth_verifier;

        // ── Step 2: Login with original password ──────────────────────────────
        // We need to mock the salt endpoint so we can derive the key
        // In reality the client fetches auth_salt and derives serverAuthKey client-side.
        // Here we simulate: user enters their password on the client, client derives
        // serverAuthKey from it, client sends serverAuthKey to the server.
        // For the test, we just send the same 'initial-server-auth-key' that we used at signup.
        const loginRes = await request(app)
            .post('/api/accounts/login')
            .send({ email: 'roundtrip@test.com', serverAuthKey: 'initial-server-auth-key' });

        expect(loginRes.status).toBe(200);
        expect(loginRes.body.id).toBe(accountId);

        // ── Step 3: Change password (authenticated) ───────────────────────────
        const changeRes = await request(app)
            .put('/api/accounts/password')
            .set('Authorization', `Bearer ${initialToken}`)
            .send({
                oldServerAuthKey: 'initial-server-auth-key',
                serverAuthKey: 'new-server-auth-key',
                encrypted_private_key: 'enc-priv-v2',
                key_salt: 'ksalt-v2',
                key_iv: 'kiv-v2',
                public_key: 'pub-key-v2',
            });

        expect(changeRes.status).toBe(200);
        expect(changeRes.body.success).toBe(true);

        // Verify the stored verifier has changed
        expect(storedAccount.auth_verifier).not.toBe(verifierAfterSignup);
        expect(storedAccount.auth_verifier).toMatch(/^[0-9a-f]+:[0-9a-f]{128}$/);

        // ── Step 4: Login with NEW password ──────────────────────────────────
        const loginNewRes = await request(app)
            .post('/api/accounts/login')
            .send({ email: 'roundtrip@test.com', serverAuthKey: 'new-server-auth-key' });

        expect(loginNewRes.status).toBe(200);
        expect(loginNewRes.body.id).toBe(accountId);

        // ── Step 5: Login with OLD password is rejected ───────────────────────
        const loginOldRes = await request(app)
            .post('/api/accounts/login')
            .send({ email: 'roundtrip@test.com', serverAuthKey: 'initial-server-auth-key' });

        expect(loginOldRes.status).toBe(401);
        expect(loginOldRes.body.error).toMatch(/Invalid credentials/);

        // ── Step 6: Change password with wrong current password is rejected ────
        const badChangeRes = await request(app)
            .put('/api/accounts/password')
            .set('Authorization', `Bearer ${initialToken}`)
            .send({
                oldServerAuthKey: 'initial-server-auth-key', // this is now stale
                serverAuthKey: 'attacker-new-password',
            });

        expect(badChangeRes.status).toBe(401);
        expect(badChangeRes.body.error).toMatch(/Current password is incorrect/);
    });
});
