import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import dbManager, { GUILDS_DIR } from '../database';
import { createGuildRoutes } from '../routes/guilds';
import { getServerIdentity } from '../crypto/pki';
import jwt from '../crypto/jwt';

// ---------------------------------------------------------------------------
// Test accounts
// ---------------------------------------------------------------------------
const OPERATOR_ID = 'grt-operator-' + Date.now();
const REGULAR_ID = 'grt-regular-' + Date.now();
const MEMBER_ID = 'grt-member-' + Date.now();

const ownerKeypair = crypto.generateKeyPairSync('ed25519');
const ownerPubKeyB64 = ownerKeypair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

let app: express.Express;
let createdGuildIds: string[] = [];
let operatorToken: string;
let regularToken: string;
let memberToken: string;

function rmrf(dir: string) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
function trackGuild(id: string) { createdGuildIds.push(id); }

/** Generate a real JWT token for testing, signed by the server's PKI identity. */
function makeToken(accountId: string): string {
    const identity = getServerIdentity();
    const privateKey = identity.privateKey.export({ type: 'pkcs8', format: 'pem' });
    return jwt.sign({ accountId }, privateKey, { algorithm: 'EdDSA', expiresIn: '1h' } as any);
}

function auth(tok: string) {
    return { Authorization: `Bearer ${tok}` };
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
    await dbManager.runNodeQuery(insertAcct, [OPERATOR_ID, `op-${Date.now()}@test.com`, 'salt:hash', ownerPubKeyB64, 'epk', 's', 'iv', 1, 0]);
    await dbManager.runNodeQuery(insertAcct, [REGULAR_ID, `reg-${Date.now()}@test.com`, 'salt:hash', ownerPubKeyB64, 'epk', 's', 'iv', 0, 0]);
    await dbManager.runNodeQuery(insertAcct, [MEMBER_ID, `mem-${Date.now()}@test.com`, 'salt:hash', ownerPubKeyB64, 'epk', 's', 'iv', 0, 0]);

    operatorToken = makeToken(OPERATOR_ID);
    regularToken = makeToken(REGULAR_ID);
    memberToken = makeToken(MEMBER_ID);

    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(createGuildRoutes(dbManager, () => {}));
});

afterAll(async () => {
    for (const gId of createdGuildIds) {
        try { dbManager.unloadGuildInstance(gId); } catch {}
    }
    await new Promise(r => setTimeout(r, 300));

    // Delete provision codes first (FK references accounts)
    await dbManager.runNodeQuery('DELETE FROM guild_provision_codes WHERE created_by = ?', [OPERATOR_ID]);

    // Delete guild registry entries (FK references accounts)
    for (const gId of createdGuildIds) {
        await dbManager.runNodeQuery('DELETE FROM guilds WHERE id = ?', [gId]);
        try { rmrf(path.join(GUILDS_DIR, gId)); } catch {}
    }

    // Now safe to delete accounts
    await dbManager.runNodeQuery('DELETE FROM accounts WHERE id IN (?, ?, ?)', [OPERATOR_ID, REGULAR_ID, MEMBER_ID]);
    await dbManager.setNodeSetting('allow_open_guild_creation', 'false');
});

// ---------------------------------------------------------------------------
// 1-4. Create guild
// ---------------------------------------------------------------------------
describe('POST /api/guilds', () => {
    it('1. node operator can create a guild', async () => {
        const res = await request(app).post('/api/guilds').set(auth(operatorToken)).send({ name: 'Op Guild' });
        expect(res.status).toBe(200);
        expect(res.body.id).toMatch(/^guild-/);
        expect(res.body.name).toBe('Op Guild');
        expect(res.body.owner_account_id).toBe(OPERATOR_ID);
        trackGuild(res.body.id);
    });

    it('2. regular user without code → 403', async () => {
        const res = await request(app).post('/api/guilds').set(auth(regularToken)).send({ name: 'Forbidden' });
        expect(res.status).toBe(403);
    });

    it('3. regular user with provision code → 200, code consumed', async () => {
        const code = await dbManager.createProvisionCode(OPERATOR_ID);
        const res = await request(app).post('/api/guilds').set(auth(regularToken)).send({ name: 'Code Guild', provisionCode: code });
        expect(res.status).toBe(200);
        trackGuild(res.body.id);
        const v = await dbManager.validateProvisionCode(code);
        expect(v.valid).toBe(false);
    });

    it('4. open creation mode allows regular user', async () => {
        await dbManager.setNodeSetting('allow_open_guild_creation', 'true');
        const res = await request(app).post('/api/guilds').set(auth(regularToken)).send({ name: 'Open Guild' });
        expect(res.status).toBe(200);
        trackGuild(res.body.id);
        await dbManager.setNodeSetting('allow_open_guild_creation', 'false');
    });

    it('requires a guild name', async () => {
        const res = await request(app).post('/api/guilds').set(auth(operatorToken)).send({});
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// 5-6. List guilds
// ---------------------------------------------------------------------------
describe('GET /api/guilds', () => {
    let listGuildId: string;

    beforeAll(async () => {
        const res = await request(app).post('/api/guilds').set(auth(operatorToken)).send({ name: 'List Guild' });
        listGuildId = res.body.id;
        trackGuild(listGuildId);
        await new Promise(r => setTimeout(r, 200));
        const pid = crypto.randomUUID();
        await dbManager.runGuildQuery(listGuildId,
            'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role, membership_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [pid, listGuildId, MEMBER_ID, 'M', 'M', '', 'USER', 'active']
        );
    });

    it('5. operator sees ALL guilds', async () => {
        const res = await request(app).get('/api/guilds').set(auth(operatorToken));
        expect(res.status).toBe(200);
        expect(res.body.map((g: any) => g.id)).toContain(listGuildId);
    });

    it('6. regular user sees only member-of guilds', async () => {
        const res = await request(app).get('/api/guilds').set(auth(memberToken));
        expect(res.body.map((g: any) => g.id)).toContain(listGuildId);
        const res2 = await request(app).get('/api/guilds').set(auth(regularToken));
        expect(res2.body.map((g: any) => g.id)).not.toContain(listGuildId);
    });
});

// ---------------------------------------------------------------------------
// 7-8. Get guild info
// ---------------------------------------------------------------------------
describe('GET /api/guilds/:guildId/info', () => {
    let infoGuildId: string;

    beforeAll(async () => {
        const res = await request(app).post('/api/guilds').set(auth(operatorToken)).send({ name: 'Info Guild', description: 'desc' });
        infoGuildId = res.body.id;
        trackGuild(infoGuildId);
        await new Promise(r => setTimeout(r, 200));
    });

    it('7. member can get guild info', async () => {
        const res = await request(app).get(`/api/guilds/${infoGuildId}/info`).set(auth(operatorToken));
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Info Guild');
        expect(res.body.member_count).toBeGreaterThanOrEqual(1);
    });

    it('8. non-member gets 403', async () => {
        const res = await request(app).get(`/api/guilds/${infoGuildId}/info`).set(auth(regularToken));
        expect(res.status).toBe(403);
    });
});

// ---------------------------------------------------------------------------
// 9-10. Update guild
// ---------------------------------------------------------------------------
describe('PUT /api/guilds/:guildId', () => {
    let updGuildId: string;

    beforeAll(async () => {
        const res = await request(app).post('/api/guilds').set(auth(operatorToken)).send({ name: 'Upd Guild' });
        updGuildId = res.body.id;
        trackGuild(updGuildId);
        await new Promise(r => setTimeout(r, 200));
    });

    it('9. owner can update guild', async () => {
        const res = await request(app).put(`/api/guilds/${updGuildId}`).set(auth(operatorToken)).send({ name: 'Updated', description: 'New' });
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Updated');
    });

    it('10. non-owner gets 403', async () => {
        const res = await request(app).put(`/api/guilds/${updGuildId}`).set(auth(regularToken)).send({ name: 'X' });
        expect(res.status).toBe(403);
    });
});

// ---------------------------------------------------------------------------
// 11-13. Suspend / Resume
// ---------------------------------------------------------------------------
describe('Suspend and Resume', () => {
    let srGuildId: string;

    beforeAll(async () => {
        const res = await request(app).post('/api/guilds').set(auth(operatorToken)).send({ name: 'SR Guild' });
        srGuildId = res.body.id;
        trackGuild(srGuildId);
        await new Promise(r => setTimeout(r, 200));
    });

    it('11. operator can suspend', async () => {
        const res = await request(app).post(`/api/guilds/${srGuildId}/suspend`).set(auth(operatorToken));
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('suspended');
    });

    it('12. non-operator cannot suspend', async () => {
        const res = await request(app).post(`/api/guilds/${srGuildId}/suspend`).set(auth(regularToken));
        expect(res.status).toBe(403);
    });

    it('13. operator can resume', async () => {
        const res = await request(app).post(`/api/guilds/${srGuildId}/resume`).set(auth(operatorToken));
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('active');
    });
});

// ---------------------------------------------------------------------------
// 14-16. Delete guild
// ---------------------------------------------------------------------------
describe('DELETE /api/guilds/:guildId', () => {
    it('14. operator with confirm', async () => {
        const c = await request(app).post('/api/guilds').set(auth(operatorToken)).send({ name: 'Del1' });
        await new Promise(r => setTimeout(r, 200));
        const res = await request(app).delete(`/api/guilds/${c.body.id}`).set(auth(operatorToken)).send({ confirm: true });
        expect(res.status).toBe(200);
        expect(await dbManager.getGuildRegistryEntry(c.body.id)).toBeUndefined();
    });

    it('15. without confirm → 400', async () => {
        const c = await request(app).post('/api/guilds').set(auth(operatorToken)).send({ name: 'Del2' });
        trackGuild(c.body.id);
        await new Promise(r => setTimeout(r, 200));
        const res = await request(app).delete(`/api/guilds/${c.body.id}`).set(auth(operatorToken)).send({});
        expect(res.status).toBe(400);
    });

    it('16. guild owner can delete', async () => {
        await dbManager.setNodeSetting('allow_open_guild_creation', 'true');
        const c = await request(app).post('/api/guilds').set(auth(regularToken)).send({ name: 'Del3' });
        await dbManager.setNodeSetting('allow_open_guild_creation', 'false');
        await new Promise(r => setTimeout(r, 200));
        const res = await request(app).delete(`/api/guilds/${c.body.id}`).set(auth(regularToken)).send({ confirm: true });
        expect(res.status).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// 17-18. Transfer ownership
// ---------------------------------------------------------------------------
describe('POST /api/guilds/:guildId/transfer-ownership', () => {
    let trGuildId: string;

    beforeAll(async () => {
        const res = await request(app).post('/api/guilds').set(auth(operatorToken)).send({ name: 'Transfer' });
        trGuildId = res.body.id;
        trackGuild(trGuildId);
        await new Promise(r => setTimeout(r, 200));
        const pid = crypto.randomUUID();
        await dbManager.runGuildQuery(trGuildId,
            'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role, membership_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [pid, trGuildId, MEMBER_ID, 'M', 'M', '', 'USER', 'active']
        );
    });

    it('17. owner can transfer ownership', async () => {
        const res = await request(app).post(`/api/guilds/${trGuildId}/transfer-ownership`).set(auth(operatorToken)).send({ newOwnerAccountId: MEMBER_ID });
        expect(res.status).toBe(200);
        expect(res.body.newOwner).toBe(MEMBER_ID);
        const entry = await dbManager.getGuildRegistryEntry(trGuildId);
        expect(entry?.owner_account_id).toBe(MEMBER_ID);
        const old: any = await dbManager.getGuildQuery(trGuildId, 'SELECT role FROM profiles WHERE account_id = ? AND server_id = ?', [OPERATOR_ID, trGuildId]);
        expect(old?.role).toBe('ADMIN');
    });

    it('18. transfer to non-member → 400', async () => {
        const res = await request(app).post(`/api/guilds/${trGuildId}/transfer-ownership`).set(auth(memberToken)).send({ newOwnerAccountId: REGULAR_ID });
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// 19. Round-trip
// ---------------------------------------------------------------------------
describe('Round-trip lifecycle', () => {
    it('19. create → list → get → update → verify → delete', async () => {
        const c = await request(app).post('/api/guilds').set(auth(operatorToken)).send({ name: 'RT', description: 'O' });
        expect(c.status).toBe(200);
        const gId = c.body.id;
        await new Promise(r => setTimeout(r, 200));

        const list = await request(app).get('/api/guilds').set(auth(operatorToken));
        expect(list.body.map((g: any) => g.id)).toContain(gId);

        const info = await request(app).get(`/api/guilds/${gId}/info`).set(auth(operatorToken));
        expect(info.body.name).toBe('RT');

        const upd = await request(app).put(`/api/guilds/${gId}`).set(auth(operatorToken)).send({ name: 'RT2' });
        expect(upd.body.name).toBe('RT2');

        const del = await request(app).delete(`/api/guilds/${gId}`).set(auth(operatorToken)).send({ confirm: true });
        expect(del.status).toBe(200);
        expect(await dbManager.getGuildRegistryEntry(gId)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// 20-21. Icon upload
// ---------------------------------------------------------------------------
describe('PUT /api/guilds/:guildId/icon', () => {
    let iconGuildId: string;

    beforeAll(async () => {
        const res = await request(app).post('/api/guilds').set(auth(operatorToken)).send({ name: 'Icon' });
        iconGuildId = res.body.id;
        trackGuild(iconGuildId);
        await new Promise(r => setTimeout(r, 200));
    });

    it('20. upload valid icon', async () => {
        // Minimal valid PNG
        const png = Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
            0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
            0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
            0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
            0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
            0x44, 0xae, 0x42, 0x60, 0x82
        ]);
        const res = await request(app).put(`/api/guilds/${iconGuildId}/icon`).set(auth(operatorToken)).attach('icon', png, 'icon.png');
        expect(res.status).toBe(200);
        expect(res.body.icon).toContain('guild_icon');
        const entry = await dbManager.getGuildRegistryEntry(iconGuildId);
        expect(entry?.icon).toBe(res.body.icon);
    });

    it('21. reject non-image file', async () => {
        const txt = Buffer.from('not an image');
        const res = await request(app).put(`/api/guilds/${iconGuildId}/icon`).set(auth(operatorToken)).attach('icon', txt, 'f.txt');
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// 22-25. Node settings
// ---------------------------------------------------------------------------
describe('Node Settings routes', () => {
    it('22. operator can get settings', async () => {
        const res = await request(app).get('/api/node/settings').set(auth(operatorToken));
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('allow_open_guild_creation');
    });

    it('23. non-operator gets 403', async () => {
        const res = await request(app).get('/api/node/settings').set(auth(regularToken));
        expect(res.status).toBe(403);
    });

    it('24. operator can update settings', async () => {
        const res = await request(app).put('/api/node/settings').set(auth(operatorToken)).send({ settings: { allow_open_guild_creation: 'true' } });
        expect(res.status).toBe(200);
        expect(res.body.settings.allow_open_guild_creation).toBe('true');
        await dbManager.setNodeSetting('allow_open_guild_creation', 'false');
    });

    it('25. unknown key → 400', async () => {
        const res = await request(app).put('/api/node/settings').set(auth(operatorToken)).send({ settings: { fake_key: 'v' } });
        expect(res.status).toBe(400);
    });
});
