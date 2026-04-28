import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import dbManager, { GUILDS_DIR } from '../database';
import { createProvisionRoutes } from '../routes/provision';
import { createGuildRoutes } from '../routes/guilds';
import { getServerIdentity } from '../crypto/pki';
import jwt from '../crypto/jwt';

// ---------------------------------------------------------------------------
// Test accounts
// ---------------------------------------------------------------------------
const OPERATOR_ID = 'prt-operator-' + Date.now();
const REGULAR_ID = 'prt-regular-' + Date.now();

const keypair = crypto.generateKeyPairSync('ed25519');
const pubKeyB64 = keypair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

let app: express.Express;
let operatorToken: string;
let regularToken: string;
let createdGuildIds: string[] = [];

function makeToken(accountId: string): string {
    const identity = getServerIdentity();
    const privateKey = identity.privateKey.export({ type: 'pkcs8', format: 'pem' });
    return jwt.sign({ accountId }, privateKey, { algorithm: 'EdDSA', expiresIn: '1h' } as any);
}

function auth(tok: string) {
    return { Authorization: `Bearer ${tok}` };
}

function rmrf(dir: string) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeAll(async () => {
    await new Promise<void>(resolve => {
        dbManager.initNodeDb(dbManager.nodeDb);
        dbManager.nodeDb.get('SELECT 1', () => resolve());
    });

    const insertAcct = `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_deactivated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await dbManager.runNodeQuery(insertAcct, [OPERATOR_ID, `prt-op-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 1, 0]);
    await dbManager.runNodeQuery(insertAcct, [REGULAR_ID, `prt-reg-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 0, 0]);

    operatorToken = makeToken(OPERATOR_ID);
    regularToken = makeToken(REGULAR_ID);

    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(createProvisionRoutes(dbManager));
    app.use(createGuildRoutes(dbManager, () => {}));
});

afterAll(async () => {
    // Unload guilds first
    for (const gId of createdGuildIds) {
        try { dbManager.unloadGuildInstance(gId); } catch {}
    }
    await new Promise(r => setTimeout(r, 300));

    // Delete provision codes (FK references accounts)
    await dbManager.runNodeQuery('DELETE FROM guild_provision_codes WHERE created_by = ?', [OPERATOR_ID]);

    // Delete guild registry entries (FK references accounts)
    for (const gId of createdGuildIds) {
        await dbManager.runNodeQuery('DELETE FROM guilds WHERE id = ?', [gId]);
        try { rmrf(path.join(GUILDS_DIR, gId)); } catch {}
    }

    // Now safe to delete accounts
    await dbManager.runNodeQuery('DELETE FROM accounts WHERE id IN (?, ?)', [OPERATOR_ID, REGULAR_ID]);
});

// ---------------------------------------------------------------------------
// 1. Generate code — operator
// ---------------------------------------------------------------------------
describe('POST /api/provision-codes', () => {
    it('1. operator generates a valid code', async () => {
        const res = await request(app)
            .post('/api/provision-codes')
            .set(auth(operatorToken))
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.code).toBeDefined();
        expect(res.body.code).toHaveLength(32);
        expect(res.body.expiresAt).toBeNull();
    });

    // 2. Non-operator gets 403
    it('2. non-operator gets 403', async () => {
        const res = await request(app)
            .post('/api/provision-codes')
            .set(auth(regularToken))
            .send({});
        expect(res.status).toBe(403);
    });

    // 3. Generate with expiry
    it('3. generates code with expiresInHours', async () => {
        const before = Math.floor(Date.now() / 1000);
        const res = await request(app)
            .post('/api/provision-codes')
            .set(auth(operatorToken))
            .send({ expiresInHours: 24 });
        const after = Math.floor(Date.now() / 1000);

        expect(res.status).toBe(200);
        expect(res.body.expiresAt).toBeDefined();
        // expires_at should be ~24h from now (in seconds)
        expect(res.body.expiresAt).toBeGreaterThanOrEqual(before + 24 * 3600 - 2);
        expect(res.body.expiresAt).toBeLessThanOrEqual(after + 24 * 3600 + 2);
    });
});

// ---------------------------------------------------------------------------
// 4. List codes
// ---------------------------------------------------------------------------
describe('GET /api/provision-codes', () => {
    it('4. lists generated codes', async () => {
        // Generate 3 codes
        for (let i = 0; i < 3; i++) {
            await request(app)
                .post('/api/provision-codes')
                .set(auth(operatorToken))
                .send({ label: `list-test-${i}` });
        }

        const res = await request(app)
            .get('/api/provision-codes')
            .set(auth(operatorToken));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);

        const listTestCodes = res.body.filter((c: any) => c.label?.startsWith('list-test-'));
        expect(listTestCodes.length).toBeGreaterThanOrEqual(3);

        // Each should have a computed status
        for (const entry of listTestCodes) {
            expect(entry.status).toBe('active');
        }
    });
});

// ---------------------------------------------------------------------------
// 5. Revoke code
// ---------------------------------------------------------------------------
describe('DELETE /api/provision-codes/:code', () => {
    it('5. revoke removes the code', async () => {
        const gen = await request(app)
            .post('/api/provision-codes')
            .set(auth(operatorToken))
            .send({ label: 'revoke-test' });
        const code = gen.body.code;

        const del = await request(app)
            .delete(`/api/provision-codes/${code}`)
            .set(auth(operatorToken));
        expect(del.status).toBe(200);
        expect(del.body.success).toBe(true);

        // Validate returns invalid after revocation
        const val = await request(app)
            .post('/api/provision-codes/validate')
            .set(auth(operatorToken))
            .send({ code });
        expect(val.body.valid).toBe(false);
    });

    it('revoke non-existent → 404', async () => {
        const res = await request(app)
            .delete('/api/provision-codes/nonexistent_code_12345678')
            .set(auth(operatorToken));
        expect(res.status).toBe(404);
    });
});

// ---------------------------------------------------------------------------
// 6-9. Validate code
// ---------------------------------------------------------------------------
describe('POST /api/provision-codes/validate', () => {
    it('6. validate active code → valid: true', async () => {
        const gen = await request(app)
            .post('/api/provision-codes')
            .set(auth(operatorToken))
            .send({});
        const code = gen.body.code;

        const res = await request(app)
            .post('/api/provision-codes/validate')
            .set(auth(regularToken))  // any authenticated user can validate
            .send({ code });
        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.maxMembers).toBeDefined();
    });

    it('7. validate expired code → valid: false', async () => {
        // Create a code with past expiry directly via DB helper
        const pastTs = Math.floor(Date.now() / 1000) - 3600; // 1h ago
        const code = await dbManager.createProvisionCode(OPERATOR_ID, pastTs);

        const res = await request(app)
            .post('/api/provision-codes/validate')
            .set(auth(regularToken))
            .send({ code });
        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(false);
    });

    it('8. validate used code → valid: false', async () => {
        // Generate code and consume it via guild creation
        const gen = await request(app)
            .post('/api/provision-codes')
            .set(auth(operatorToken))
            .send({});
        const code = gen.body.code;

        // Consume by creating a guild with the provision code (as regular user)
        const guild = await request(app)
            .post('/api/guilds')
            .set(auth(regularToken))
            .send({ name: 'Code Consume Guild', provisionCode: code });
        expect(guild.status).toBe(200);
        createdGuildIds.push(guild.body.id);

        // Validate → invalid (used)
        const res = await request(app)
            .post('/api/provision-codes/validate')
            .set(auth(regularToken))
            .send({ code });
        expect(res.body.valid).toBe(false);
    });

    it('9. validate non-existent code → valid: false', async () => {
        const res = await request(app)
            .post('/api/provision-codes/validate')
            .set(auth(regularToken))
            .send({ code: 'totally_fake_code_0000000000000' });
        expect(res.body.valid).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 10. Full round-trip
// ---------------------------------------------------------------------------
describe('Round-trip', () => {
    it('10. generate → validate → create guild → code consumed → validate invalid', async () => {
        // Step 1: Generate
        const gen = await request(app)
            .post('/api/provision-codes')
            .set(auth(operatorToken))
            .send({ maxMembers: 50, label: 'round-trip' });
        expect(gen.status).toBe(200);
        const code = gen.body.code;

        // Step 2: Validate — should be valid
        const val1 = await request(app)
            .post('/api/provision-codes/validate')
            .set(auth(regularToken))
            .send({ code });
        expect(val1.body.valid).toBe(true);
        expect(val1.body.maxMembers).toBe(50);

        // Step 3: Create guild with provision code
        const guild = await request(app)
            .post('/api/guilds')
            .set(auth(regularToken))
            .send({ name: 'Round Trip Guild', provisionCode: code });
        expect(guild.status).toBe(200);
        createdGuildIds.push(guild.body.id);

        // Step 4: Validate again — should be invalid (consumed)
        const val2 = await request(app)
            .post('/api/provision-codes/validate')
            .set(auth(regularToken))
            .send({ code });
        expect(val2.body.valid).toBe(false);
    });
});
