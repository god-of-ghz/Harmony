/**
 * Global Profile Display Name — Integration Round-Trip Tests
 *
 * TRUE round-trip tests that exercise the COMPLETE chain through
 * the full Express app (guild routes + profile routes mounted together):
 *
 *   HTTP Request → RBAC middleware → Route handler → SQLite → HTTP Response
 *
 * Each test writes data via one API endpoint and reads it back from a DIFFERENT
 * endpoint, proving no layer silently drops the display_name field.
 *
 * Test Matrix:
 *  1. PUT /api/profiles/global → GET /api/federation/profile round-trip
 *  2. PUT /api/profiles/global → POST /api/guilds → GET /api/guilds/:id/profiles
 *  3. PUT /api/profiles/global → POST /api/guilds/:id/join → GET /api/guilds/:id/profiles
 *  4. PUT /api/profiles/global (update) → GET /api/guilds/:id/profiles (propagation)
 *  5. POST /api/federation/profile-update → GET + GET round-trip (global + per-guild)
 *  6. No global profile → POST /api/guilds → GET profiles (email fallback)
 *  7. Full lifecycle: set identity → create guild → join → update → verify all endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import dbManager, { GUILDS_DIR } from '../src/database';
import { createGuildRoutes } from '../src/routes/guilds';
import { createProfileRoutes } from '../src/routes/profiles';
import { createGuildContentRoutes } from '../src/routes/servers';
import { getServerIdentity, signDelegationPayload } from '../src/crypto/pki';
import jwt from '../src/crypto/jwt';

// ---------------------------------------------------------------------------
// Test accounts
// ---------------------------------------------------------------------------
const ts = Date.now();
const ALICE_ID = `rt-alice-${ts}`;
const BOB_ID = `rt-bob-${ts}`;
const CHARLIE_ID = `rt-charlie-${ts}`;
const DIANA_ID = `rt-diana-${ts}`;

const keypair = crypto.generateKeyPairSync('ed25519');
const pubKeyB64 = keypair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

let app: express.Express;
let aliceToken: string;
let bobToken: string;
let charlieToken: string;
let dianaToken: string;
let createdGuildIds: string[] = [];

function rmrf(dir: string) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
function trackGuild(id: string) { createdGuildIds.push(id); }

function makeToken(accountId: string): string {
    const identity = getServerIdentity();
    const privateKey = identity.privateKey.export({ type: 'pkcs8', format: 'pem' });
    return jwt.sign({ accountId }, privateKey, { algorithm: 'EdDSA', expiresIn: '1h' } as any);
}

function auth(tok: string) {
    return { Authorization: `Bearer ${tok}` };
}

// ---------------------------------------------------------------------------
// Setup — 4 test accounts, full route stack
// ---------------------------------------------------------------------------
beforeAll(async () => {
    // Initialize PKI (system test config has setupFiles: [])
    const { initializeServerIdentity, _resetCachedIdentity } = await import('../src/crypto/pki');
    const pkiDir = path.resolve(__dirname, '.tmp', `pki_rt_${ts}`);
    if (!fs.existsSync(pkiDir)) fs.mkdirSync(pkiDir, { recursive: true });
    _resetCachedIdentity();
    initializeServerIdentity(pkiDir);

    await new Promise<void>(resolve => {
        dbManager.initNodeDb(dbManager.nodeDb);
        dbManager.nodeDb.get('SELECT 1', () => resolve());
    });

    const insertAcct = `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_deactivated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await dbManager.runNodeQuery(insertAcct, [ALICE_ID, `alice-${ts}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 1, 0]);
    await dbManager.runNodeQuery(insertAcct, [BOB_ID, `bob-${ts}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 0, 0]);
    await dbManager.runNodeQuery(insertAcct, [CHARLIE_ID, `charlie-${ts}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 1, 0]);
    await dbManager.runNodeQuery(insertAcct, [DIANA_ID, `diana-${ts}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 1, 0]);

    aliceToken = makeToken(ALICE_ID);
    bobToken = makeToken(BOB_ID);
    charlieToken = makeToken(CHARLIE_ID);
    dianaToken = makeToken(DIANA_ID);

    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(createGuildRoutes(dbManager, () => {}));
    app.use(createProfileRoutes(dbManager, () => {}));
    app.use(createGuildContentRoutes(dbManager, () => {}));
});

afterAll(async () => {
    for (const gId of createdGuildIds) {
        try { dbManager.unloadGuildInstance(gId); } catch {}
    }
    await new Promise(r => setTimeout(r, 300));
    for (const gId of createdGuildIds) {
        await dbManager.runNodeQuery('DELETE FROM guilds WHERE id = ?', [gId]);
        try { rmrf(path.join(GUILDS_DIR, gId)); } catch {}
    }
    await dbManager.runNodeQuery('DELETE FROM global_profiles WHERE account_id IN (?, ?, ?, ?)', [ALICE_ID, BOB_ID, CHARLIE_ID, DIANA_ID]);
    await dbManager.runNodeQuery('DELETE FROM accounts WHERE id IN (?, ?, ?, ?)', [ALICE_ID, BOB_ID, CHARLIE_ID, DIANA_ID]);
    // Clean up temp PKI dir
    const pkiDir = path.resolve(__dirname, '.tmp', `pki_rt_${ts}`);
    try { rmrf(pkiDir); } catch {}
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Write via PUT → Read via GET (different endpoints)
// ═══════════════════════════════════════════════════════════════════════════

describe('Round-trip: PUT global → GET federation', () => {
    it('1. display_name written via PUT /api/profiles/global is readable via GET /api/federation/profile', async () => {
        // WRITE endpoint
        const putRes = await request(app)
            .put('/api/profiles/global')
            .set(auth(aliceToken))
            .send({ display_name: 'Alice_RT', bio: 'Round-trip test', avatar_url: 'http://alice.png', status_message: '' });
        expect(putRes.status).toBe(200);

        // READ endpoint (different route)
        const getRes = await request(app)
            .get(`/api/federation/profile/${ALICE_ID}`)
            .set(auth(aliceToken));
        expect(getRes.status).toBe(200);
        expect(getRes.body.display_name).toBe('Alice_RT');
        expect(getRes.body.bio).toBe('Round-trip test');
        expect(getRes.body.avatar_url).toBe('http://alice.png');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Write global → Create guild → Read per-guild profile
// ═══════════════════════════════════════════════════════════════════════════

let aliceGuildId: string;

describe('Round-trip: global profile → guild creation → per-guild profile', () => {
    it('2. display_name set via global profile appears in auto-created owner profile', async () => {
        // WRITE: set global profile
        await request(app).put('/api/profiles/global').set(auth(aliceToken))
            .send({ display_name: 'AliceOwner', bio: '', avatar_url: 'http://alice-owner.png', status_message: '' });

        // ACTION: create guild (internally calls createOwnerProfile)
        const createRes = await request(app).post('/api/guilds').set(auth(aliceToken)).send({ name: 'RT Guild' });
        expect(createRes.status).toBe(200);
        aliceGuildId = createRes.body.id;
        trackGuild(aliceGuildId);
        await new Promise(r => setTimeout(r, 200));

        // READ: fetch profiles from the guild (different endpoint)
        const profilesRes = await request(app)
            .get(`/api/guilds/${aliceGuildId}/profiles`)
            .set(auth(aliceToken));
        expect(profilesRes.status).toBe(200);

        const ownerProfile = profilesRes.body.find((p: any) => p.account_id === ALICE_ID);
        expect(ownerProfile).toBeDefined();
        expect(ownerProfile.nickname).toBe('AliceOwner');
        expect(ownerProfile.original_username).toBe('AliceOwner');
        expect(ownerProfile.avatar).toBe('http://alice-owner.png');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Write global → Join guild → Read per-guild profile
// ═══════════════════════════════════════════════════════════════════════════

describe('Round-trip: global profile → guild join → per-guild profile', () => {
    it('3. display_name set via global profile appears in auto-created joiner profile', async () => {
        // WRITE: set Bob's global profile
        await request(app).put('/api/profiles/global').set(auth(bobToken))
            .send({ display_name: 'BobJoiner', bio: '', avatar_url: 'http://bob.png', status_message: '' });

        // SETUP: enable open_join
        await dbManager.runGuildQuery(aliceGuildId,
            `INSERT OR REPLACE INTO server_settings (key, value) VALUES ('open_join', 'true')`, []);

        // ACTION: Bob joins Alice's guild
        const joinRes = await request(app)
            .post(`/api/guilds/${aliceGuildId}/join`)
            .set(auth(bobToken))
            .send({});
        expect(joinRes.status).toBe(200);

        // READ: verify via profiles endpoint
        const profilesRes = await request(app)
            .get(`/api/guilds/${aliceGuildId}/profiles`)
            .set(auth(aliceToken));
        expect(profilesRes.status).toBe(200);

        const bobProfile = profilesRes.body.find((p: any) => p.account_id === BOB_ID);
        expect(bobProfile).toBeDefined();
        expect(bobProfile.nickname).toBe('BobJoiner');
        expect(bobProfile.original_username).toBe('BobJoiner');
        expect(bobProfile.avatar).toBe('http://bob.png');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Update global → Read per-guild (propagation)
// ═══════════════════════════════════════════════════════════════════════════

describe('Round-trip: global profile update → per-guild propagation', () => {
    it('4. updating display_name via PUT propagates to all per-guild profiles readable via GET', async () => {
        // ACTION: Alice updates her global profile
        const putRes = await request(app).put('/api/profiles/global').set(auth(aliceToken))
            .send({ display_name: 'AliceRenamed', bio: '', avatar_url: 'http://alice-new.png', status_message: '' });
        expect(putRes.status).toBe(200);

        // READ: per-guild profile should be updated
        const profilesRes = await request(app)
            .get(`/api/guilds/${aliceGuildId}/profiles`)
            .set(auth(aliceToken));
        expect(profilesRes.status).toBe(200);

        const aliceProfile = profilesRes.body.find((p: any) => p.account_id === ALICE_ID);
        expect(aliceProfile.nickname).toBe('AliceRenamed');
        expect(aliceProfile.original_username).toBe('AliceRenamed');
        expect(aliceProfile.avatar).toBe('http://alice-new.png');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Federation profile-update → global + per-guild
// ═══════════════════════════════════════════════════════════════════════════

describe('Round-trip: federation profile-update → global + per-guild profiles', () => {
    it('5. POST federation/profile-update updates both global and per-guild profiles', async () => {
        const identity = getServerIdentity();
        const primaryPubKey = (identity.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');

        const payload = {
            account_id: BOB_ID,
            display_name: 'BobFederated',
            bio: 'Fed sync',
            avatar_url: 'http://bob-fed.png',
            status_message: 'synced',
            version: 500
        };
        const signature = signDelegationPayload(payload, identity.privateKey);

        // WRITE: federation endpoint
        const fedRes = await request(app).post('/api/federation/profile-update').send({
            profile: { ...payload, signature },
            primaryPublicKey: primaryPubKey
        });
        expect(fedRes.status).toBe(200);

        // READ 1: global profile via federation GET
        const globalRes = await request(app).get(`/api/federation/profile/${BOB_ID}`).set(auth(bobToken));
        expect(globalRes.status).toBe(200);
        expect(globalRes.body.display_name).toBe('BobFederated');
        expect(globalRes.body.bio).toBe('Fed sync');

        // READ 2: per-guild profile
        const profilesRes = await request(app)
            .get(`/api/guilds/${aliceGuildId}/profiles`)
            .set(auth(aliceToken));
        const bobProfile = profilesRes.body.find((p: any) => p.account_id === BOB_ID);
        expect(bobProfile).toBeDefined();
        expect(bobProfile.nickname).toBe('BobFederated');
        expect(bobProfile.avatar).toBe('http://bob-fed.png');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. No global profile → email fallback
// ═══════════════════════════════════════════════════════════════════════════

describe('Round-trip: no global profile → email fallback in guild creation', () => {
    it('6. without global display_name, owner profile falls back to email prefix', async () => {
        // Ensure no global profile for Charlie
        await dbManager.runNodeQuery('DELETE FROM global_profiles WHERE account_id = ?', [CHARLIE_ID]);

        // ACTION: create guild
        const createRes = await request(app).post('/api/guilds').set(auth(charlieToken)).send({ name: 'Charlie Guild' });
        expect(createRes.status).toBe(200);
        trackGuild(createRes.body.id);
        await new Promise(r => setTimeout(r, 200));

        // READ: profile should use email prefix
        const profilesRes = await request(app)
            .get(`/api/guilds/${createRes.body.id}/profiles`)
            .set(auth(charlieToken));
        expect(profilesRes.status).toBe(200);

        const acct: any = await dbManager.getNodeQuery('SELECT email FROM accounts WHERE id = ?', [CHARLIE_ID]);
        const expectedNickname = acct.email.split('@')[0];

        const profile = profilesRes.body.find((p: any) => p.account_id === CHARLIE_ID);
        expect(profile).toBeDefined();
        expect(profile.nickname).toBe(expectedNickname);
        expect(profile.avatar).toBe('');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Full lifecycle round-trip
// ═══════════════════════════════════════════════════════════════════════════

describe('Full lifecycle round-trip', () => {
    it('7. set identity → create guild → another user joins → update identity → verify all endpoints', async () => {
        // Step 1: WRITE — set Diana's global profile
        const setRes = await request(app).put('/api/profiles/global').set(auth(dianaToken))
            .send({ display_name: 'Diana_V1', bio: 'V1', avatar_url: 'http://diana-v1.png', status_message: '' });
        expect(setRes.status).toBe(200);

        // Step 2: ACTION — create guild
        const guildRes = await request(app).post('/api/guilds').set(auth(dianaToken)).send({ name: 'Diana RT Guild' });
        expect(guildRes.status).toBe(200);
        const dGuildId = guildRes.body.id;
        trackGuild(dGuildId);
        await new Promise(r => setTimeout(r, 200));

        // Step 3: SETUP — enable open_join, Bob joins
        await dbManager.runGuildQuery(dGuildId,
            `INSERT OR REPLACE INTO server_settings (key, value) VALUES ('open_join', 'true')`, []);
        const joinRes = await request(app).post(`/api/guilds/${dGuildId}/join`).set(auth(bobToken)).send({});
        expect(joinRes.status).toBe(200);

        // Step 4: READ — verify initial state across BOTH endpoints
        const profiles1 = await request(app).get(`/api/guilds/${dGuildId}/profiles`).set(auth(dianaToken));
        const dianaP1 = profiles1.body.find((p: any) => p.account_id === DIANA_ID);
        expect(dianaP1.nickname).toBe('Diana_V1');
        expect(dianaP1.avatar).toBe('http://diana-v1.png');

        const bobCurrentName = (await request(app).get(`/api/federation/profile/${BOB_ID}`).set(auth(bobToken))).body.display_name;
        const bobP1 = profiles1.body.find((p: any) => p.account_id === BOB_ID);
        expect(bobP1.nickname).toBe(bobCurrentName);

        // Step 5: ACTION — Diana updates her identity
        await request(app).put('/api/profiles/global').set(auth(dianaToken))
            .send({ display_name: 'Diana_V2', bio: 'V2', avatar_url: 'http://diana-v2.png', status_message: '' });

        // Step 6: READ — verify propagation via per-guild profiles
        const profiles2 = await request(app).get(`/api/guilds/${dGuildId}/profiles`).set(auth(dianaToken));
        const dianaP2 = profiles2.body.find((p: any) => p.account_id === DIANA_ID);
        expect(dianaP2.nickname).toBe('Diana_V2');
        expect(dianaP2.original_username).toBe('Diana_V2');
        expect(dianaP2.avatar).toBe('http://diana-v2.png');

        // Step 7: READ — verify via federation endpoint
        const fedRes = await request(app).get(`/api/federation/profile/${DIANA_ID}`).set(auth(dianaToken));
        expect(fedRes.body.display_name).toBe('Diana_V2');
        expect(fedRes.body.bio).toBe('V2');
    });
});
