import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import dbManager, { GUILDS_DIR } from '../database';
import { createInviteRoutes } from '../routes/invites';
import { createGuildRoutes } from '../routes/guilds';
import { getServerIdentity } from '../crypto/pki';
import jwt from '../crypto/jwt';

// ---------------------------------------------------------------------------
// Test accounts
// ---------------------------------------------------------------------------
const OWNER_ID = 'ist-owner-' + Date.now();
const ADMIN_ID = 'ist-admin-' + Date.now();
const MEMBER_ID = 'ist-member-' + Date.now();
const OUTSIDER_ID = 'ist-outsider-' + Date.now();

const keypair = crypto.generateKeyPairSync('ed25519');
const pubKeyB64 = keypair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

let app: express.Express;
let ownerToken: string;
let adminToken: string;
let memberToken: string;
let outsiderToken: string;
let testGuildId: string;
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
    await dbManager.runNodeQuery(insertAcct, [OWNER_ID, `ist-owner-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 1, 0]);
    await dbManager.runNodeQuery(insertAcct, [ADMIN_ID, `ist-admin-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 0, 0]);
    await dbManager.runNodeQuery(insertAcct, [MEMBER_ID, `ist-member-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 0, 0]);
    await dbManager.runNodeQuery(insertAcct, [OUTSIDER_ID, `ist-out-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 0, 0]);

    ownerToken = makeToken(OWNER_ID);
    adminToken = makeToken(ADMIN_ID);
    memberToken = makeToken(MEMBER_ID);
    outsiderToken = makeToken(OUTSIDER_ID);

    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/', createInviteRoutes(dbManager));
    app.use(createGuildRoutes(dbManager, () => {}));

    // Create a test guild owned by OWNER_ID
    const guildRes = await request(app)
        .post('/api/guilds')
        .set(auth(ownerToken))
        .send({ name: 'Invite Test Guild', description: 'For invite scoping tests' });
    testGuildId = guildRes.body.id;
    createdGuildIds.push(testGuildId);
    await new Promise(r => setTimeout(r, 200));

    // Add ADMIN profile
    const adminProfileId = crypto.randomUUID();
    await dbManager.runGuildQuery(testGuildId,
        'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role, membership_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [adminProfileId, testGuildId, ADMIN_ID, 'Admin', 'Admin', '', 'ADMIN', 'active']
    );

    // Add regular MEMBER profile (USER role)
    const memberProfileId = crypto.randomUUID();
    await dbManager.runGuildQuery(testGuildId,
        'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role, membership_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [memberProfileId, testGuildId, MEMBER_ID, 'Member', 'Member', '', 'USER', 'active']
    );
});

afterAll(async () => {
    for (const gId of createdGuildIds) {
        try { dbManager.unloadGuildInstance(gId); } catch {}
    }
    await new Promise(r => setTimeout(r, 300));

    // Clean up invites
    await dbManager.runNodeQuery('DELETE FROM invites WHERE guild_id IN (?)', [testGuildId]);

    // Clean up provision codes (FK references accounts)
    await dbManager.runNodeQuery('DELETE FROM guild_provision_codes WHERE created_by = ?', [OWNER_ID]);

    // Delete guild registry entries
    for (const gId of createdGuildIds) {
        await dbManager.runNodeQuery('DELETE FROM guilds WHERE id = ?', [gId]);
        try { rmrf(path.join(GUILDS_DIR, gId)); } catch {}
    }

    // Now safe to delete accounts
    await dbManager.runNodeQuery('DELETE FROM accounts WHERE id IN (?, ?, ?, ?)',
        [OWNER_ID, ADMIN_ID, MEMBER_ID, OUTSIDER_ID]);
});

// ---------------------------------------------------------------------------
// 11. Create invite — guild admin (OWNER)
// ---------------------------------------------------------------------------
describe('POST /api/invites — authorization', () => {
    it('11. OWNER can create invite', async () => {
        const res = await request(app)
            .post('/api/invites')
            .set(auth(ownerToken))
            .send({ guildId: testGuildId, maxUses: 5, expiresInMinutes: 60 });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
        expect(res.body.token).toHaveLength(32);
        expect(res.body.expiresAt).toBeDefined();
    });

    it('ADMIN can create invite', async () => {
        const res = await request(app)
            .post('/api/invites')
            .set(auth(adminToken))
            .send({ guildId: testGuildId, maxUses: 3 });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
    });

    // 12. Regular member (USER role) → 403
    it('12. regular USER member gets 403', async () => {
        const res = await request(app)
            .post('/api/invites')
            .set(auth(memberToken))
            .send({ guildId: testGuildId });
        expect(res.status).toBe(403);
        expect(res.body.error).toContain('OWNER or ADMIN');
    });

    // 13. Non-member → 403
    it('13. non-member gets 403', async () => {
        const res = await request(app)
            .post('/api/invites')
            .set(auth(outsiderToken))
            .send({ guildId: testGuildId });
        expect(res.status).toBe(403);
    });

    // Backward compat: serverId still works
    it('serverId fallback works', async () => {
        const res = await request(app)
            .post('/api/invites')
            .set(auth(ownerToken))
            .send({ serverId: testGuildId, maxUses: 1 });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// 14. Create invite — suspended guild
// ---------------------------------------------------------------------------
describe('POST /api/invites — guild status', () => {
    it('14. cannot create invite for suspended guild', async () => {
        // Suspend the guild
        await dbManager.updateGuildStatus(testGuildId, 'suspended');

        const res = await request(app)
            .post('/api/invites')
            .set(auth(ownerToken))
            .send({ guildId: testGuildId });
        expect(res.status).toBe(403);
        expect(res.body.error).toContain('suspended');

        // Restore active status
        await dbManager.updateGuildStatus(testGuildId, 'active');
    });
});

// ---------------------------------------------------------------------------
// 15. Consume invite — returns guild metadata
// ---------------------------------------------------------------------------
describe('POST /api/invites/consume', () => {
    it('15. consume returns guild metadata', async () => {
        // Create an invite first
        const inv = await request(app)
            .post('/api/invites')
            .set(auth(ownerToken))
            .send({ guildId: testGuildId, maxUses: 10, expiresInMinutes: 60 });
        const token = inv.body.token;

        // Consume it
        const res = await request(app)
            .post('/api/invites/consume')
            .set(auth(outsiderToken))
            .send({ token });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.guild_id).toBe(testGuildId);
        expect(res.body.guild_name).toBe('Invite Test Guild');
        expect(res.body.guild_fingerprint).toBeDefined();
        expect(res.body.host_uri).toBeDefined();
    });

    // 16. Expired invite → 400
    it('16. expired invite → 400', async () => {
        // Insert an already-expired invite directly
        const expiredToken = crypto.randomBytes(16).toString('hex');
        const pastExpiry = Date.now() - 60000; // 1 minute ago
        await dbManager.runNodeQuery(
            `INSERT INTO invites (token, host_uri, guild_id, max_uses, current_uses, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [expiredToken, 'http://localhost', testGuildId, 10, 0, pastExpiry]
        );

        const res = await request(app)
            .post('/api/invites/consume')
            .set(auth(outsiderToken))
            .send({ token: expiredToken });
        expect(res.status).toBe(400);
    });

    // 17. Max uses reached → 400
    it('17. max uses reached → 400', async () => {
        // Create invite with maxUses: 1
        const inv = await request(app)
            .post('/api/invites')
            .set(auth(ownerToken))
            .send({ guildId: testGuildId, maxUses: 1, expiresInMinutes: 60 });
        const token = inv.body.token;

        // First consume should work
        const c1 = await request(app)
            .post('/api/invites/consume')
            .set(auth(outsiderToken))
            .send({ token });
        expect(c1.status).toBe(200);

        // Second consume should fail (max reached)
        const c2 = await request(app)
            .post('/api/invites/consume')
            .set(auth(outsiderToken))
            .send({ token });
        expect(c2.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// 18. Round-trip
// ---------------------------------------------------------------------------
describe('Invite round-trip', () => {
    it('18. create → consume → verify guild_id', async () => {
        // Create
        const inv = await request(app)
            .post('/api/invites')
            .set(auth(ownerToken))
            .send({ guildId: testGuildId, maxUses: 5 });
        expect(inv.status).toBe(200);

        // Consume
        const consume = await request(app)
            .post('/api/invites/consume')
            .set(auth(outsiderToken))
            .send({ token: inv.body.token });
        expect(consume.status).toBe(200);
        expect(consume.body.guild_id).toBe(testGuildId);
        expect(consume.body.guild_name).toBeTruthy();
    });
});
