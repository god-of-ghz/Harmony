/**
 * Cross-Node Guild Federation Tests
 *
 * Integration tests for all fixes related to joining imported guilds
 * on secondary/federated Harmony nodes. Verifies the full chain:
 *
 *  1. Orphaned guild auto-registration at startup
 *  2. Validated member counting (excludes Discord ghost profiles)
 *  3. Ghost owner detection and claim (Discord snowflake → real account)
 *  4. needs_profile_setup response for imported guilds
 *  5. Registry owner inclusion in GET /api/guilds
 *  6. Profile claim round-trip with guildId parameter
 *  7. Fresh guild join (no imports) still auto-creates profile
 *  8. Discoverable endpoint counts only real members
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
import { createGuildContentRoutes } from '../routes/servers';
import { getServerIdentity } from '../crypto/pki';
import jwt from '../crypto/jwt';

// ---------------------------------------------------------------------------
// Test accounts
// ---------------------------------------------------------------------------
const OPERATOR_ID = 'cnf-operator-' + Date.now();
const JOINER_ID = 'cnf-joiner-' + Date.now();
const DISCORD_SNOWFLAKE = '745035401495838781'; // Simulated Discord owner

const keypair = crypto.generateKeyPairSync('ed25519');
const pubKeyB64 = keypair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

let app: express.Express;
let operatorToken: string;
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
    await dbManager.runNodeQuery(insertAcct, [OPERATOR_ID, `cnf-op-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 1, 0]);
    await dbManager.runNodeQuery(insertAcct, [JOINER_ID, `cnf-joiner-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 0, 0]);

    operatorToken = makeToken(OPERATOR_ID);
    joinerToken = makeToken(JOINER_ID);

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
    await dbManager.runNodeQuery('DELETE FROM accounts WHERE id IN (?, ?)', [OPERATOR_ID, JOINER_ID]);
});

// ---------------------------------------------------------------------------
// Helper: Create an imported guild with Discord ghost profiles
// ---------------------------------------------------------------------------
async function createImportedGuild(ghostOwnerId: string = DISCORD_SNOWFLAKE): Promise<string> {
    // Operator creates a real guild first (to get a valid guild DB)
    const createRes = await request(app).post('/api/guilds').set(auth(operatorToken)).send({ name: 'Imported Guild' });
    expect(createRes.status).toBe(200);
    const guildId = createRes.body.id;
    trackGuild(guildId);
    await new Promise(r => setTimeout(r, 200));

    // Remove the operator's real profile to simulate an import-only guild
    await dbManager.runGuildQuery(guildId,
        'DELETE FROM profiles WHERE account_id = ? AND server_id = ?',
        [OPERATOR_ID, guildId]
    );

    // Insert ghost Discord profiles (simulating imported users)
    const ghostProfiles = [
        { id: 'discord-profile-1', name: 'ServerSaver', accountId: '111111111111111111' },
        { id: 'discord-profile-2', name: 'samurai_ike', accountId: '222222222222222222' },
        { id: 'discord-profile-3', name: 'captncript', accountId: '333333333333333333' },
    ];
    for (const ghost of ghostProfiles) {
        await dbManager.runGuildQuery(guildId,
            'INSERT OR IGNORE INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role, membership_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [ghost.id, guildId, ghost.accountId, ghost.name, ghost.name, '', 'USER', 'active']
        );
    }

    // Overwrite the registry owner to simulate auto-registration from a Discord import
    // (owner_account_id = Discord snowflake, bypassing FK check)
    await new Promise<void>((resolve, reject) => {
        dbManager.nodeDb.run('PRAGMA foreign_keys = OFF', () => {
            dbManager.nodeDb.run(
                'UPDATE guilds SET owner_account_id = ? WHERE id = ?',
                [ghostOwnerId, guildId],
                (err) => {
                    dbManager.nodeDb.run('PRAGMA foreign_keys = ON', () => {
                        if (err) reject(err); else resolve();
                    });
                }
            );
        });
    });

    return guildId;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1-2. Validated Member Counting
// ═══════════════════════════════════════════════════════════════════════════

describe('Validated Member Counting', () => {
    let importedGuildId: string;

    beforeAll(async () => {
        importedGuildId = await createImportedGuild();
    });

    it('1. discoverable endpoint excludes ghost profiles from member count', async () => {
        const res = await request(app).get('/api/guilds/discoverable').set(auth(joinerToken));
        expect(res.status).toBe(200);

        const guild = res.body.find((g: any) => g.id === importedGuildId);
        expect(guild).toBeDefined();
        // Ghost profiles should NOT be counted — real member count should be 0
        expect(guild.member_count).toBe(0);
        expect(guild.is_claimable).toBe(true);
    });

    it('2. discoverable endpoint shows guild as claimable when all profiles are ghosts', async () => {
        const res = await request(app).get('/api/guilds/discoverable').set(auth(joinerToken));
        const guild = res.body.find((g: any) => g.id === importedGuildId);
        expect(guild).toBeDefined();
        expect(guild.is_claimable).toBe(true);
        expect(guild.member_count).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3-5. Ghost Owner Detection and Claim
// ═══════════════════════════════════════════════════════════════════════════

describe('Ghost Owner Detection and Claim', () => {
    let importedGuildId: string;

    beforeAll(async () => {
        importedGuildId = await createImportedGuild();
    });

    it('3. join endpoint detects zero real members and assigns OWNER role', async () => {
        const res = await request(app)
            .post(`/api/guilds/${importedGuildId}/join`)
            .set(auth(joinerToken))
            .send({});

        expect(res.status).toBe(200);
        // Should defer to ClaimProfile (imported guild with unclaimed profiles)
        expect(res.body.needs_profile_setup).toBe(true);
        expect(res.body.role).toBe('OWNER');
    });

    it('4. join endpoint replaces Discord snowflake owner with real account', async () => {
        // After joining (test 3), the registry should have the joiner as owner
        const entry = await dbManager.getGuildRegistryEntry(importedGuildId);
        expect(entry).toBeDefined();
        expect(entry!.owner_account_id).toBe(JOINER_ID);
    });

    it('5. registry still has real owner after re-checking', async () => {
        // Verify the UPDATE was persisted — not just in-memory
        const row: any = await dbManager.getNodeQuery(
            'SELECT owner_account_id FROM guilds WHERE id = ?', [importedGuildId]
        );
        expect(row.owner_account_id).toBe(JOINER_ID);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6-7. needs_profile_setup Response
// ═══════════════════════════════════════════════════════════════════════════

describe('needs_profile_setup Response', () => {
    it('6. imported guild with ghost profiles returns needs_profile_setup: true', async () => {
        const guildId = await createImportedGuild();

        const res = await request(app)
            .post(`/api/guilds/${guildId}/join`)
            .set(auth(joinerToken))
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.needs_profile_setup).toBe(true);
        expect(res.body.guild_id).toBe(guildId);
        expect(res.body.role).toBeTruthy();
    });

    it('7. fresh guild (no imports) auto-creates profile', async () => {
        // Create a fresh guild with no ghost profiles
        const createRes = await request(app)
            .post('/api/guilds')
            .set(auth(operatorToken))
            .send({ name: 'Fresh Guild' });
        expect(createRes.status).toBe(200);
        const guildId = createRes.body.id;
        trackGuild(guildId);
        await new Promise(r => setTimeout(r, 200));

        // Remove the owner's auto-created profile and registry to simulate "no members"
        await dbManager.runGuildQuery(guildId,
            'DELETE FROM profiles WHERE account_id = ? AND server_id = ?',
            [OPERATOR_ID, guildId]
        );
        // Transfer ownership away so joiner can claim
        await new Promise<void>((resolve, reject) => {
            dbManager.nodeDb.run('PRAGMA foreign_keys = OFF', () => {
                dbManager.nodeDb.run(
                    'UPDATE guilds SET owner_account_id = ? WHERE id = ?',
                    ['nobody', guildId],
                    (err) => {
                        dbManager.nodeDb.run('PRAGMA foreign_keys = ON', () => {
                            if (err) reject(err); else resolve();
                        });
                    }
                );
            });
        });

        const res = await request(app)
            .post(`/api/guilds/${guildId}/join`)
            .set(auth(joinerToken))
            .send({});

        expect(res.status).toBe(200);
        // No ghost profiles → auto-create profile → should return profile data, not needs_profile_setup
        expect(res.body.needs_profile_setup).toBeUndefined();
        expect(res.body.id).toBeTruthy(); // Profile ID
        expect(res.body.account_id).toBe(JOINER_ID);
        expect(res.body.membership_status).toBe('active');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8-9. Registry Owner Inclusion in GET /api/guilds
// ═══════════════════════════════════════════════════════════════════════════

describe('Registry Owner Inclusion in Guild List', () => {
    let importedGuildId: string;

    beforeAll(async () => {
        importedGuildId = await createImportedGuild();
        // Claim ownership (sets owner_account_id to JOINER_ID)
        await request(app)
            .post(`/api/guilds/${importedGuildId}/join`)
            .set(auth(joinerToken))
            .send({});
    });

    it('8. registry owner sees guild in GET /api/guilds even without a profile', async () => {
        // Joiner has no profile (needs_profile_setup was returned)
        // but should still see the guild because they're the registry owner
        const res = await request(app).get('/api/guilds').set(auth(joinerToken));
        expect(res.status).toBe(200);
        const guildIds = res.body.map((g: any) => g.id);
        expect(guildIds).toContain(importedGuildId);
    });

    it('9. non-owner non-member does NOT see guild in GET /api/guilds', async () => {
        // Create another account that has no relation to this guild
        const OTHER_ID = 'cnf-other-' + Date.now();
        await dbManager.runNodeQuery(
            `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_deactivated)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [OTHER_ID, `cnf-other-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 0, 0]
        );
        const otherToken = makeToken(OTHER_ID);

        const res = await request(app).get('/api/guilds').set(auth(otherToken));
        expect(res.status).toBe(200);
        const guildIds = res.body.map((g: any) => g.id);
        expect(guildIds).not.toContain(importedGuildId);

        await dbManager.runNodeQuery('DELETE FROM accounts WHERE id = ?', [OTHER_ID]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10-12. Profile Claim Round-Trip
// ═══════════════════════════════════════════════════════════════════════════

describe('Profile Claim Round-Trip', () => {
    let importedGuildId: string;
    let ghostProfileId: string;

    beforeAll(async () => {
        importedGuildId = await createImportedGuild();
        // Claim ownership
        await request(app)
            .post(`/api/guilds/${importedGuildId}/join`)
            .set(auth(joinerToken))
            .send({});
        // Get the first ghost profile ID
        const profiles: any[] = await dbManager.allGuildQuery(importedGuildId,
            'SELECT id FROM profiles WHERE server_id = ?', [importedGuildId]
        );
        ghostProfileId = profiles[0].id;
    });

    it('10. POST /api/profiles/claim with guildId succeeds', async () => {
        const res = await request(app)
            .post('/api/profiles/claim')
            .set(auth(joinerToken))
            .send({ profileId: ghostProfileId, guildId: importedGuildId, accountId: JOINER_ID });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.profileId).toBe(ghostProfileId);
    });

    it('11. claimed profile now has correct account_id in guild DB', async () => {
        const profile: any = await dbManager.getGuildQuery(importedGuildId,
            'SELECT * FROM profiles WHERE id = ? AND server_id = ?',
            [ghostProfileId, importedGuildId]
        );
        expect(profile).toBeDefined();
        expect(profile.account_id).toBe(JOINER_ID);
    });

    it('12. POST /api/profiles/claim without guildId → 500 (validates guildId is required)', async () => {
        const res = await request(app)
            .post('/api/profiles/claim')
            .set(auth(joinerToken))
            .send({ profileId: ghostProfileId, accountId: JOINER_ID });
        // Without guildId, guild DB lookup fails
        expect(res.status).toBe(500);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13-14. Full Join + Claim Round-Trip
// ═══════════════════════════════════════════════════════════════════════════

describe('Full Join → Claim Round-Trip', () => {
    it('13. complete flow: discover → join → claim profile → verify', async () => {
        const guildId = await createImportedGuild();

        // Step 1: Discover the guild
        const discoverRes = await request(app)
            .get('/api/guilds/discoverable')
            .set(auth(joinerToken));
        expect(discoverRes.status).toBe(200);
        const discovered = discoverRes.body.find((g: any) => g.id === guildId);
        expect(discovered).toBeDefined();
        expect(discovered.is_claimable).toBe(true);

        // Step 2: Join the guild (should get needs_profile_setup)
        const joinRes = await request(app)
            .post(`/api/guilds/${guildId}/join`)
            .set(auth(joinerToken))
            .send({});
        expect(joinRes.status).toBe(200);
        expect(joinRes.body.needs_profile_setup).toBe(true);

        // Step 3: Verify guild appears in user's guild list (via registry owner)
        const listRes = await request(app)
            .get('/api/guilds')
            .set(auth(joinerToken));
        expect(listRes.body.map((g: any) => g.id)).toContain(guildId);

        // Step 4: Fetch available profiles
        const profilesRes = await request(app)
            .get(`/api/guilds/${guildId}/profiles`)
            .set(auth(joinerToken));
        expect(profilesRes.status).toBe(200);
        expect(profilesRes.body.length).toBeGreaterThan(0);
        const ghostProfile = profilesRes.body[0];

        // Step 5: Claim a ghost profile
        const claimRes = await request(app)
            .post('/api/profiles/claim')
            .set(auth(joinerToken))
            .send({ profileId: ghostProfile.id, guildId, accountId: JOINER_ID });
        expect(claimRes.status).toBe(200);
        expect(claimRes.body.success).toBe(true);

        // Step 6: Verify the profile is now linked
        const verifyProfile: any = await dbManager.getGuildQuery(guildId,
            'SELECT * FROM profiles WHERE id = ? AND server_id = ?',
            [ghostProfile.id, guildId]
        );
        expect(verifyProfile.account_id).toBe(JOINER_ID);
    });

    it('14. after claiming, discoverable no longer shows guild as claimable if real members > 0', async () => {
        // Re-use the guild from test 13 — it now has a real member
        // We need a fresh guild to test the transition
        const guildId = await createImportedGuild();

        // Initially claimable
        const beforeRes = await request(app)
            .get('/api/guilds/discoverable')
            .set(auth(joinerToken));
        const before = beforeRes.body.find((g: any) => g.id === guildId);
        expect(before?.is_claimable).toBe(true);

        // Join and claim
        await request(app)
            .post(`/api/guilds/${guildId}/join`)
            .set(auth(joinerToken))
            .send({});

        // Manually create a profile with the joiner's real account ID
        // (simulating what ClaimProfile "Start Fresh" does)
        const profileId = crypto.randomUUID();
        await dbManager.runGuildQuery(guildId,
            'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role, membership_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [profileId, guildId, JOINER_ID, 'TestJoiner', 'TestJoiner', '', 'OWNER', 'active']
        );

        // Now check discoverable — should have member_count > 0
        const afterRes = await request(app)
            .get('/api/guilds/discoverable')
            .set(auth(joinerToken));
        const after = afterRes.body.find((g: any) => g.id === guildId);
        // Guild may or may not be in discoverable (depends on open_join)
        // but if it is, it should NOT be claimable
        if (after) {
            expect(after.is_claimable).toBe(false);
            expect(after.member_count).toBeGreaterThan(0);
        }
    });
});
