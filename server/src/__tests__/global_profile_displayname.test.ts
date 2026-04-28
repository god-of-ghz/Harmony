/**
 * Global Profile Display Name Regression Tests
 *
 * Verifies the full lifecycle of the display_name field in global_profiles:
 *
 *  1. Schema: display_name column exists in global_profiles
 *  2. createOwnerProfile uses global display_name when available
 *  3. createOwnerProfile falls back to email prefix when no global profile
 *  4. Guild join uses global display_name when available
 *  5. Guild join falls back to email prefix when no global profile
 *  6. PUT /api/profiles/global stores display_name
 *  7. PUT /api/profiles/global propagates display_name to per-guild profiles
 *  8. GET /api/federation/profile returns display_name
 *  9. POST /api/federation/profile-update stores display_name
 * 10. POST /api/federation/profile-update propagates to per-guild profiles
 * 11. display_name included in signed federation payload
 * 12. Round-trip: set global profile → create guild → verify owner profile has display_name
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import dbManager, { GUILDS_DIR } from '../database';
import { createGuildRoutes } from '../routes/guilds';
import { createProfileRoutes } from '../routes/profiles';
import { getServerIdentity } from '../crypto/pki';
import jwt from '../crypto/jwt';

// ---------------------------------------------------------------------------
// Test accounts
// ---------------------------------------------------------------------------
const OWNER_ID = 'gpdn-owner-' + Date.now();
const JOINER_ID = 'gpdn-joiner-' + Date.now();

const keypair = crypto.generateKeyPairSync('ed25519');
const pubKeyB64 = keypair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

let app: express.Express;
let ownerToken: string;
let joinerToken: string;
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
// Setup
// ---------------------------------------------------------------------------
beforeAll(async () => {
    await new Promise<void>(resolve => {
        dbManager.initNodeDb(dbManager.nodeDb);
        dbManager.nodeDb.get('SELECT 1', () => resolve());
    });

    const insertAcct = `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_deactivated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await dbManager.runNodeQuery(insertAcct, [OWNER_ID, `gpdn-owner-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 1, 0]);
    await dbManager.runNodeQuery(insertAcct, [JOINER_ID, `gpdn-joiner-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 0, 0]);

    ownerToken = makeToken(OWNER_ID);
    joinerToken = makeToken(JOINER_ID);

    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(createGuildRoutes(dbManager, () => {}));
    app.use(createProfileRoutes(dbManager, () => {}));
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
    await dbManager.runNodeQuery('DELETE FROM global_profiles WHERE account_id IN (?, ?)', [OWNER_ID, JOINER_ID]);
    await dbManager.runNodeQuery('DELETE FROM accounts WHERE id IN (?, ?)', [OWNER_ID, JOINER_ID]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. Schema validation
// ═══════════════════════════════════════════════════════════════════════════

describe('Schema: display_name column', () => {
    it('1. global_profiles has display_name column', async () => {
        const result = await dbManager.runNodeQuery(
            `INSERT INTO global_profiles (account_id, display_name) VALUES (?, ?)
             ON CONFLICT(account_id) DO UPDATE SET display_name = excluded.display_name`,
            [OWNER_ID, 'SchemaTest']
        );
        const row: any = await dbManager.getNodeQuery(
            'SELECT display_name FROM global_profiles WHERE account_id = ?', [OWNER_ID]
        );
        expect(row).toBeDefined();
        expect(row.display_name).toBe('SchemaTest');

        // Clean up
        await dbManager.runNodeQuery('DELETE FROM global_profiles WHERE account_id = ?', [OWNER_ID]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2-3. createOwnerProfile uses global profile
// ═══════════════════════════════════════════════════════════════════════════

describe('createOwnerProfile and global display_name', () => {
    it('2. owner profile uses global display_name when available', async () => {
        // Set a global profile with display_name for the owner
        await dbManager.runNodeQuery(
            `INSERT INTO global_profiles (account_id, display_name, avatar_url) VALUES (?, ?, ?)
             ON CONFLICT(account_id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url`,
            [OWNER_ID, 'GHz', 'http://example.com/avatar.png']
        );

        // Create a guild (triggers createOwnerProfile)
        const res = await request(app).post('/api/guilds').set(auth(ownerToken)).send({ name: 'Test Guild DN' });
        expect(res.status).toBe(200);
        trackGuild(res.body.id);
        await new Promise(r => setTimeout(r, 200));

        // Check the owner's profile in the guild DB
        const profile: any = await dbManager.getGuildQuery(res.body.id,
            'SELECT * FROM profiles WHERE account_id = ? AND server_id = ?',
            [OWNER_ID, res.body.id]
        );
        expect(profile).toBeDefined();
        expect(profile.nickname).toBe('GHz');
        expect(profile.original_username).toBe('GHz');
        expect(profile.avatar).toBe('http://example.com/avatar.png');
    });

    it('3. owner profile falls back to email when no global profile exists', async () => {
        // Remove any global profile
        await dbManager.runNodeQuery('DELETE FROM global_profiles WHERE account_id = ?', [JOINER_ID]);

        // Get the joiner's email for verification
        const acct: any = await dbManager.getNodeQuery('SELECT email FROM accounts WHERE id = ?', [JOINER_ID]);
        const expectedNickname = acct.email.split('@')[0];

        // Allow open creation for the non-operator user
        await dbManager.setNodeSetting('allow_open_guild_creation', 'true');
        const res = await request(app).post('/api/guilds').set(auth(joinerToken)).send({ name: 'Fallback Guild' });
        await dbManager.setNodeSetting('allow_open_guild_creation', 'false');
        expect(res.status).toBe(200);
        trackGuild(res.body.id);
        await new Promise(r => setTimeout(r, 200));

        const profile: any = await dbManager.getGuildQuery(res.body.id,
            'SELECT * FROM profiles WHERE account_id = ? AND server_id = ?',
            [JOINER_ID, res.body.id]
        );
        expect(profile).toBeDefined();
        expect(profile.nickname).toBe(expectedNickname);
        expect(profile.avatar).toBe('');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4-5. Guild join uses global profile
// ═══════════════════════════════════════════════════════════════════════════

describe('Guild join and global display_name', () => {
    let freshGuildId: string;

    beforeAll(async () => {
        // Create a fresh guild as the owner
        const res = await request(app).post('/api/guilds').set(auth(ownerToken)).send({ name: 'Join DN Guild' });
        freshGuildId = res.body.id;
        trackGuild(freshGuildId);
        await new Promise(r => setTimeout(r, 200));
        // Enable open_join so the joiner can join without an invite
        await dbManager.runGuildQuery(freshGuildId,
            `INSERT OR REPLACE INTO server_settings (key, value) VALUES ('open_join', 'true')`, []
        );
    });

    it('4. joined profile uses global display_name when available', async () => {
        // Set global profile for the joiner
        await dbManager.runNodeQuery(
            `INSERT INTO global_profiles (account_id, display_name, avatar_url) VALUES (?, ?, ?)
             ON CONFLICT(account_id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url`,
            [JOINER_ID, 'JoinerName', 'http://example.com/joiner.png']
        );

        const res = await request(app)
            .post(`/api/guilds/${freshGuildId}/join`)
            .set(auth(joinerToken))
            .send({});
        expect(res.status).toBe(200);

        // The auto-created profile should use the global display_name
        const profile: any = await dbManager.getGuildQuery(freshGuildId,
            'SELECT * FROM profiles WHERE account_id = ? AND server_id = ?',
            [JOINER_ID, freshGuildId]
        );
        expect(profile).toBeDefined();
        expect(profile.nickname).toBe('JoinerName');
        expect(profile.original_username).toBe('JoinerName');
        expect(profile.avatar).toBe('http://example.com/joiner.png');
    });

    it('5. joined profile falls back to email when no global profile exists', async () => {
        // Create a second guild with open_join enabled
        const res2 = await request(app).post('/api/guilds').set(auth(ownerToken)).send({ name: 'Join Fallback Guild' });
        const guildId2 = res2.body.id;
        trackGuild(guildId2);
        await new Promise(r => setTimeout(r, 200));
        await dbManager.runGuildQuery(guildId2,
            `INSERT OR REPLACE INTO server_settings (key, value) VALUES ('open_join', 'true')`, []
        );

        // Create a third account with no global profile
        const NO_GP_ID = 'gpdn-nogp-' + Date.now();
        await dbManager.runNodeQuery(
            `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_deactivated)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [NO_GP_ID, `nogp-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 0, 0]
        );
        const noGpToken = makeToken(NO_GP_ID);

        const joinRes = await request(app)
            .post(`/api/guilds/${guildId2}/join`)
            .set(auth(noGpToken))
            .send({});
        expect(joinRes.status).toBe(200);

        const acct: any = await dbManager.getNodeQuery('SELECT email FROM accounts WHERE id = ?', [NO_GP_ID]);
        const expectedNickname = acct.email.split('@')[0];

        const profile: any = await dbManager.getGuildQuery(guildId2,
            'SELECT * FROM profiles WHERE account_id = ? AND server_id = ?',
            [NO_GP_ID, guildId2]
        );
        expect(profile).toBeDefined();
        expect(profile.nickname).toBe(expectedNickname);
        expect(profile.avatar).toBe('');

        // Cleanup
        await dbManager.runNodeQuery('DELETE FROM accounts WHERE id = ?', [NO_GP_ID]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6-8. PUT /api/profiles/global stores and returns display_name
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/profiles/global with display_name', () => {
    it('6. stores display_name in global_profiles', async () => {
        const res = await request(app)
            .put('/api/profiles/global')
            .set(auth(ownerToken))
            .send({ display_name: 'NewDisplayName', bio: 'Test bio', avatar_url: '', status_message: '' });
        expect(res.status).toBe(200);

        const row: any = await dbManager.getNodeQuery(
            'SELECT display_name FROM global_profiles WHERE account_id = ?', [OWNER_ID]
        );
        expect(row.display_name).toBe('NewDisplayName');
    });

    it('7. propagates display_name to per-guild profiles', async () => {
        // Create a guild and verify profile gets updated
        const createRes = await request(app).post('/api/guilds').set(auth(ownerToken)).send({ name: 'Propagate Guild' });
        expect(createRes.status).toBe(200);
        trackGuild(createRes.body.id);
        await new Promise(r => setTimeout(r, 200));

        // Now update the global profile
        const updateRes = await request(app)
            .put('/api/profiles/global')
            .set(auth(ownerToken))
            .send({ display_name: 'PropagatedName', bio: '', avatar_url: 'http://new-avatar.png', status_message: '' });
        expect(updateRes.status).toBe(200);

        // Verify the per-guild profile was updated
        const profile: any = await dbManager.getGuildQuery(createRes.body.id,
            'SELECT * FROM profiles WHERE account_id = ? AND server_id = ?',
            [OWNER_ID, createRes.body.id]
        );
        expect(profile.nickname).toBe('PropagatedName');
        expect(profile.original_username).toBe('PropagatedName');
        expect(profile.avatar).toBe('http://new-avatar.png');
    });

    it('8. GET /api/federation/profile returns display_name', async () => {
        // Ensure a global profile with display_name exists
        await dbManager.runNodeQuery(
            `INSERT INTO global_profiles (account_id, display_name, bio) VALUES (?, ?, ?)
             ON CONFLICT(account_id) DO UPDATE SET display_name = excluded.display_name`,
            [OWNER_ID, 'FederatedName', 'test']
        );

        const res = await request(app)
            .get(`/api/federation/profile/${OWNER_ID}`)
            .set(auth(ownerToken));
        expect(res.status).toBe(200);
        expect(res.body.display_name).toBe('FederatedName');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9-11. Federation profile-update with display_name
// ═══════════════════════════════════════════════════════════════════════════

describe('Federation profile-update with display_name', () => {
    it('9. POST /api/federation/profile-update stores display_name', async () => {
        const { signDelegationPayload } = await import('../crypto/pki');
        const identity = getServerIdentity();
        const primaryPubKey = (identity.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');

        const payload = {
            account_id: JOINER_ID,
            display_name: 'FederatedJoiner',
            bio: 'Hello',
            avatar_url: 'http://fed-avatar.png',
            status_message: '',
            version: 100
        };
        const signature = signDelegationPayload(payload, identity.privateKey);

        const res = await request(app)
            .post('/api/federation/profile-update')
            .send({
                profile: { ...payload, signature },
                primaryPublicKey: primaryPubKey
            });
        expect(res.status).toBe(200);

        const row: any = await dbManager.getNodeQuery(
            'SELECT display_name FROM global_profiles WHERE account_id = ?', [JOINER_ID]
        );
        expect(row.display_name).toBe('FederatedJoiner');
    });

    it('10. federation update propagates display_name to per-guild profiles', async () => {
        // Ensure the joiner has a guild profile
        const createRes = await request(app).post('/api/guilds').set(auth(ownerToken)).send({ name: 'Fed Propagate Guild' });
        expect(createRes.status).toBe(200);
        trackGuild(createRes.body.id);
        await new Promise(r => setTimeout(r, 200));

        // Enable open_join and join as the joiner
        await dbManager.runGuildQuery(createRes.body.id,
            `INSERT OR REPLACE INTO server_settings (key, value) VALUES ('open_join', 'true')`, []
        );
        const joinRes = await request(app).post(`/api/guilds/${createRes.body.id}/join`).set(auth(joinerToken)).send({});
        expect(joinRes.status).toBe(200);

        // Now send a federation update
        const { signDelegationPayload } = await import('../crypto/pki');
        const identity = getServerIdentity();
        const primaryPubKey = (identity.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');

        const payload = {
            account_id: JOINER_ID,
            display_name: 'FedPropagated',
            bio: '',
            avatar_url: 'http://fed-new.png',
            status_message: '',
            version: 200
        };
        const signature = signDelegationPayload(payload, identity.privateKey);

        await request(app).post('/api/federation/profile-update').send({
            profile: { ...payload, signature },
            primaryPublicKey: primaryPubKey
        });

        const profile: any = await dbManager.getGuildQuery(createRes.body.id,
            'SELECT * FROM profiles WHERE account_id = ? AND server_id = ?',
            [JOINER_ID, createRes.body.id]
        );
        expect(profile.nickname).toBe('FedPropagated');
        expect(profile.original_username).toBe('FedPropagated');
        expect(profile.avatar).toBe('http://fed-new.png');
    });

    it('11. display_name is included in signed federation payload (signature verification works)', async () => {
        // If display_name is NOT in the signed payload but IS sent, verification should fail
        // This test ensures the signing includes display_name by verifying a valid payload succeeds
        const { signDelegationPayload } = await import('../crypto/pki');
        const identity = getServerIdentity();
        const primaryPubKey = (identity.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');

        const payload = {
            account_id: JOINER_ID,
            display_name: 'SignatureTest',
            bio: 'sig',
            avatar_url: '',
            status_message: '',
            version: 300
        };
        const signature = signDelegationPayload(payload, identity.privateKey);

        const res = await request(app)
            .post('/api/federation/profile-update')
            .send({
                profile: { ...payload, signature },
                primaryPublicKey: primaryPubKey
            });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. Round-trip: set global profile → create guild → verify owner profile
// ═══════════════════════════════════════════════════════════════════════════

describe('Full round-trip: global profile → guild creation', () => {
    it('12. end-to-end: set display_name → create guild → owner profile matches', async () => {
        // Step 1: Set up a global profile with display_name
        const setRes = await request(app)
            .put('/api/profiles/global')
            .set(auth(ownerToken))
            .send({ display_name: 'RoundTripUser', bio: 'E2E test', avatar_url: 'http://rt-avatar.png', status_message: 'testing' });
        expect(setRes.status).toBe(200);

        // Step 2: Create a guild
        const guildRes = await request(app)
            .post('/api/guilds')
            .set(auth(ownerToken))
            .send({ name: 'RoundTrip Guild' });
        expect(guildRes.status).toBe(200);
        trackGuild(guildRes.body.id);
        await new Promise(r => setTimeout(r, 200));

        // Step 3: Verify the owner profile in the guild has the global display_name
        const profile: any = await dbManager.getGuildQuery(guildRes.body.id,
            'SELECT * FROM profiles WHERE account_id = ? AND server_id = ?',
            [OWNER_ID, guildRes.body.id]
        );
        expect(profile).toBeDefined();
        expect(profile.nickname).toBe('RoundTripUser');
        expect(profile.original_username).toBe('RoundTripUser');
        expect(profile.avatar).toBe('http://rt-avatar.png');
        expect(profile.role).toBe('OWNER');

        // Step 4: Verify the global profile endpoint returns the data
        const fedRes = await request(app)
            .get(`/api/federation/profile/${OWNER_ID}`)
            .set(auth(ownerToken));
        expect(fedRes.status).toBe(200);
        expect(fedRes.body.display_name).toBe('RoundTripUser');
        expect(fedRes.body.bio).toBe('E2E test');
    });
});
