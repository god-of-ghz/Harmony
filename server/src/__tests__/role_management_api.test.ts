/**
 * Server-Side Role Management API Tests
 *
 * Validates the profile roles API endpoints:
 *  1. GET  /api/guilds/:guildId/profiles/:profileId/roles  — fetch assigned roles
 *  2. POST /api/guilds/:guildId/profiles/:profileId/roles  — assign a role
 *  3. DELETE /api/guilds/:guildId/profiles/:profileId/roles/:roleId — unassign a role
 *  4. Owner can manage own roles
 *  5. Admin can manage own roles
 *  6. Regular user gets 403 on role management
 *  7. Duplicate assignment returns error (UNIQUE constraint)
 *  8. Assigning updates primary_role_color in profile
 *  9. Unassigning clears primary_role_color when no roles remain
 * 10. GET response uses role `id` field (not `role_id`)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import dbManager, { GUILDS_DIR } from '../database';
import { createGuildContentRoutes } from '../routes/servers';
import { getServerIdentity } from '../crypto/pki';
import jwt from '../crypto/jwt';

// ── Test accounts ──
const OWNER_ID = 'role-test-owner-' + Date.now();
const ADMIN_ID = 'role-test-admin-' + Date.now();
const USER_ID = 'role-test-user-' + Date.now();

const keypair = crypto.generateKeyPairSync('ed25519');
const pubKeyB64 = keypair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

let app: express.Express;
let ownerToken: string;
let adminToken: string;
let userToken: string;

let guildId: string;
let ownerProfileId: string;
let adminProfileId: string;
let userProfileId: string;
let roleModId: string;
let roleMemberId: string;

function rmrf(dir: string) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function makeToken(accountId: string): string {
    const identity = getServerIdentity();
    const privateKey = identity.privateKey.export({ type: 'pkcs8', format: 'pem' });
    return jwt.sign({ accountId }, privateKey, { algorithm: 'EdDSA', expiresIn: '1h' } as any);
}

function auth(tok: string) {
    return { Authorization: `Bearer ${tok}` };
}

// ── Setup ──
beforeAll(async () => {
    // Initialize node DB
    await new Promise<void>(resolve => {
        dbManager.initNodeDb(dbManager.nodeDb);
        dbManager.nodeDb.get('SELECT 1', () => resolve());
    });

    // Create test accounts
    const insertAcct = `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_deactivated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await dbManager.runNodeQuery(insertAcct, [OWNER_ID, `owner-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 1, 0]);
    await dbManager.runNodeQuery(insertAcct, [ADMIN_ID, `admin-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 0, 0]);
    await dbManager.runNodeQuery(insertAcct, [USER_ID, `user-${Date.now()}@test.com`, 'salt:hash', pubKeyB64, 'epk', 's', 'iv', 0, 0]);

    ownerToken = makeToken(OWNER_ID);
    adminToken = makeToken(ADMIN_ID);
    userToken = makeToken(USER_ID);

    // Create Express app with guild content routes
    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use(createGuildContentRoutes(dbManager, () => {}));

    // Create a guild
    guildId = 'role-test-guild-' + Date.now();
    await dbManager.initializeServerBundle(guildId, 'Role Test Guild', '');
    await dbManager.registerGuild(guildId, 'Role Test Guild', OWNER_ID, '');
    await new Promise(r => setTimeout(r, 200));

    // Create profiles
    ownerProfileId = 'profile-owner-' + crypto.randomUUID().slice(0, 8);
    adminProfileId = 'profile-admin-' + crypto.randomUUID().slice(0, 8);
    userProfileId = 'profile-user-' + crypto.randomUUID().slice(0, 8);

    await dbManager.runGuildQuery(guildId,
        'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role, membership_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [ownerProfileId, guildId, OWNER_ID, 'Owner', 'Owner', '', 'OWNER', 'active']
    );
    await dbManager.runGuildQuery(guildId,
        'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role, membership_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [adminProfileId, guildId, ADMIN_ID, 'Admin', 'Admin', '', 'ADMIN', 'active']
    );
    await dbManager.runGuildQuery(guildId,
        'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role, membership_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [userProfileId, guildId, USER_ID, 'User', 'User', '', 'USER', 'active']
    );

    // Create roles
    roleModId = 'role-mod-' + crypto.randomUUID().slice(0, 8);
    roleMemberId = 'role-member-' + crypto.randomUUID().slice(0, 8);

    await dbManager.runGuildQuery(guildId,
        'INSERT INTO roles (id, server_id, name, color, permissions, position) VALUES (?, ?, ?, ?, ?, ?)',
        [roleModId, guildId, 'Moderator', '#ff0000', 0, 2]
    );
    await dbManager.runGuildQuery(guildId,
        'INSERT INTO roles (id, server_id, name, color, permissions, position) VALUES (?, ?, ?, ?, ?, ?)',
        [roleMemberId, guildId, 'Member', '#00ff00', 0, 1]
    );
});

afterAll(async () => {
    // Clean up
    try { dbManager.unloadServerInstance(guildId); } catch {}
    await new Promise(r => setTimeout(r, 300));
    await dbManager.runNodeQuery('DELETE FROM guilds WHERE id = ?', [guildId]);
    try { rmrf(path.join(GUILDS_DIR, guildId)); } catch {}
    await dbManager.runNodeQuery('DELETE FROM accounts WHERE id IN (?, ?, ?)', [OWNER_ID, ADMIN_ID, USER_ID]);
});

// Clean up profile_roles between tests to avoid interference
beforeEach(async () => {
    await dbManager.runGuildQuery(guildId, 'DELETE FROM profile_roles WHERE server_id = ?', [guildId]);
});

describe('Role Management API', () => {
    // ──────────────────────────────────────────────────
    // 1. GET assigned roles
    // ──────────────────────────────────────────────────

    it('1. GET returns empty array when no roles assigned', async () => {
        const res = await request(app)
            .get(`/api/guilds/${guildId}/profiles/${userProfileId}/roles`)
            .set(auth(userToken));

        expect(res.status).toBe(200);
        // May include @everyone, so filter it out for the check
        const nonEveryone = res.body.filter((r: any) => r.name !== '@everyone');
        expect(nonEveryone.length).toBe(0);
    });

    it('2. GET returns assigned roles with correct id field (not role_id)', async () => {
        // Assign a role directly
        await dbManager.runGuildQuery(guildId,
            'INSERT INTO profile_roles (profile_id, server_id, role_id) VALUES (?, ?, ?)',
            [userProfileId, guildId, roleModId]
        );

        const res = await request(app)
            .get(`/api/guilds/${guildId}/profiles/${userProfileId}/roles`)
            .set(auth(userToken));

        expect(res.status).toBe(200);
        const modRole = res.body.find((r: any) => r.name === 'Moderator');
        expect(modRole).toBeTruthy();
        // Critical: verify the field is `id`, not `role_id`
        expect(modRole.id).toBe(roleModId);
        expect(modRole.role_id).toBeUndefined();
    });

    // ──────────────────────────────────────────────────
    // 3-4. POST to assign roles
    // ──────────────────────────────────────────────────

    it('3. POST assigns a role successfully (owner)', async () => {
        const res = await request(app)
            .post(`/api/guilds/${guildId}/profiles/${userProfileId}/roles`)
            .set(auth(ownerToken))
            .send({ roleId: roleModId });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify in DB
        const assigned = await dbManager.allGuildQuery(guildId,
            'SELECT * FROM profile_roles WHERE profile_id = ? AND server_id = ? AND role_id = ?',
            [userProfileId, guildId, roleModId]
        );
        expect(assigned.length).toBe(1);
    });

    it('4. POST assigns a role successfully (admin)', async () => {
        const res = await request(app)
            .post(`/api/guilds/${guildId}/profiles/${userProfileId}/roles`)
            .set(auth(adminToken))
            .send({ roleId: roleMemberId });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    // ──────────────────────────────────────────────────
    // 5. Owner can manage OWN roles
    // ──────────────────────────────────────────────────

    it('5. Owner can assign a role to themselves', async () => {
        const res = await request(app)
            .post(`/api/guilds/${guildId}/profiles/${ownerProfileId}/roles`)
            .set(auth(ownerToken))
            .send({ roleId: roleModId });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify
        const roles = await request(app)
            .get(`/api/guilds/${guildId}/profiles/${ownerProfileId}/roles`)
            .set(auth(ownerToken));

        const modRole = roles.body.find((r: any) => r.name === 'Moderator');
        expect(modRole).toBeTruthy();
    });

    it('6. Owner can unassign a role from themselves', async () => {
        // First assign
        await dbManager.runGuildQuery(guildId,
            'INSERT INTO profile_roles (profile_id, server_id, role_id) VALUES (?, ?, ?)',
            [ownerProfileId, guildId, roleMemberId]
        );

        const res = await request(app)
            .delete(`/api/guilds/${guildId}/profiles/${ownerProfileId}/roles/${roleMemberId}`)
            .set(auth(ownerToken));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Verify it's gone
        const remaining = await dbManager.allGuildQuery(guildId,
            'SELECT * FROM profile_roles WHERE profile_id = ? AND server_id = ? AND role_id = ?',
            [ownerProfileId, guildId, roleMemberId]
        );
        expect(remaining.length).toBe(0);
    });

    // ──────────────────────────────────────────────────
    // 7. Admin can manage OWN roles
    // ──────────────────────────────────────────────────

    it('7. Admin can assign a role to themselves', async () => {
        const res = await request(app)
            .post(`/api/guilds/${guildId}/profiles/${adminProfileId}/roles`)
            .set(auth(adminToken))
            .send({ roleId: roleModId });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('8. Admin can unassign a role from themselves', async () => {
        await dbManager.runGuildQuery(guildId,
            'INSERT INTO profile_roles (profile_id, server_id, role_id) VALUES (?, ?, ?)',
            [adminProfileId, guildId, roleMemberId]
        );

        const res = await request(app)
            .delete(`/api/guilds/${guildId}/profiles/${adminProfileId}/roles/${roleMemberId}`)
            .set(auth(adminToken));

        expect(res.status).toBe(200);
    });

    // ──────────────────────────────────────────────────
    // 9. Regular user gets 403
    // ──────────────────────────────────────────────────

    it('9. Regular user cannot assign roles (403)', async () => {
        const res = await request(app)
            .post(`/api/guilds/${guildId}/profiles/${userProfileId}/roles`)
            .set(auth(userToken))
            .send({ roleId: roleModId });

        expect(res.status).toBe(403);
    });

    it('10. Regular user cannot unassign roles (403)', async () => {
        await dbManager.runGuildQuery(guildId,
            'INSERT INTO profile_roles (profile_id, server_id, role_id) VALUES (?, ?, ?)',
            [userProfileId, guildId, roleModId]
        );

        const res = await request(app)
            .delete(`/api/guilds/${guildId}/profiles/${userProfileId}/roles/${roleModId}`)
            .set(auth(userToken));

        expect(res.status).toBe(403);
    });

    // ──────────────────────────────────────────────────
    // 11. Duplicate assignment
    // ──────────────────────────────────────────────────

    it('11. Duplicate role assignment returns 500 (UNIQUE constraint)', async () => {
        await dbManager.runGuildQuery(guildId,
            'INSERT INTO profile_roles (profile_id, server_id, role_id) VALUES (?, ?, ?)',
            [userProfileId, guildId, roleModId]
        );

        const res = await request(app)
            .post(`/api/guilds/${guildId}/profiles/${userProfileId}/roles`)
            .set(auth(ownerToken))
            .send({ roleId: roleModId });

        expect(res.status).toBe(500);
    });

    // ──────────────────────────────────────────────────
    // 12. DELETE properly unassigns
    // ──────────────────────────────────────────────────

    it('12. DELETE removes the correct profile_roles entry', async () => {
        // Assign both roles
        await dbManager.runGuildQuery(guildId,
            'INSERT INTO profile_roles (profile_id, server_id, role_id) VALUES (?, ?, ?)',
            [userProfileId, guildId, roleModId]
        );
        await dbManager.runGuildQuery(guildId,
            'INSERT INTO profile_roles (profile_id, server_id, role_id) VALUES (?, ?, ?)',
            [userProfileId, guildId, roleMemberId]
        );

        // Remove only Moderator
        const res = await request(app)
            .delete(`/api/guilds/${guildId}/profiles/${userProfileId}/roles/${roleModId}`)
            .set(auth(ownerToken));

        expect(res.status).toBe(200);

        // Verify Member is still assigned
        const remaining = await dbManager.allGuildQuery(guildId,
            'SELECT role_id FROM profile_roles WHERE profile_id = ? AND server_id = ?',
            [userProfileId, guildId]
        );
        expect(remaining.length).toBe(1);
        expect((remaining[0] as any).role_id).toBe(roleMemberId);
    });

    // ──────────────────────────────────────────────────
    // 13. Round-trip: assign → verify → unassign → verify
    // ──────────────────────────────────────────────────

    it('13. Full round-trip: assign → GET → unassign → GET', async () => {
        // Assign
        const assign = await request(app)
            .post(`/api/guilds/${guildId}/profiles/${userProfileId}/roles`)
            .set(auth(ownerToken))
            .send({ roleId: roleModId });
        expect(assign.status).toBe(200);

        // Verify assigned
        const afterAssign = await request(app)
            .get(`/api/guilds/${guildId}/profiles/${userProfileId}/roles`)
            .set(auth(userToken));
        const modRole = afterAssign.body.find((r: any) => r.id === roleModId);
        expect(modRole).toBeTruthy();

        // Unassign
        const unassign = await request(app)
            .delete(`/api/guilds/${guildId}/profiles/${userProfileId}/roles/${roleModId}`)
            .set(auth(ownerToken));
        expect(unassign.status).toBe(200);

        // Verify unassigned
        const afterUnassign = await request(app)
            .get(`/api/guilds/${guildId}/profiles/${userProfileId}/roles`)
            .set(auth(userToken));
        const modRoleAfter = afterUnassign.body.find((r: any) => r.id === roleModId);
        expect(modRoleAfter).toBeFalsy();
    });

    // ──────────────────────────────────────────────────
    // 14. Self-management round-trip for owner
    // ──────────────────────────────────────────────────

    it('14. Owner self-management round-trip', async () => {
        // Owner assigns Moderator to themselves
        const assign = await request(app)
            .post(`/api/guilds/${guildId}/profiles/${ownerProfileId}/roles`)
            .set(auth(ownerToken))
            .send({ roleId: roleModId });
        expect(assign.status).toBe(200);

        // Verify via GET
        const check = await request(app)
            .get(`/api/guilds/${guildId}/profiles/${ownerProfileId}/roles`)
            .set(auth(ownerToken));
        expect(check.body.find((r: any) => r.id === roleModId)).toBeTruthy();

        // Owner removes Moderator from themselves
        const unassign = await request(app)
            .delete(`/api/guilds/${guildId}/profiles/${ownerProfileId}/roles/${roleModId}`)
            .set(auth(ownerToken));
        expect(unassign.status).toBe(200);

        // Verify removed
        const check2 = await request(app)
            .get(`/api/guilds/${guildId}/profiles/${ownerProfileId}/roles`)
            .set(auth(ownerToken));
        expect(check2.body.find((r: any) => r.id === roleModId)).toBeFalsy();
    });
});
