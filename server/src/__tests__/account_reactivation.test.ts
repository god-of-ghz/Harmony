import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../app';
import dbManager from '../database';

// Mock DB
vi.mock('../database', () => {
    return {
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
    };
});

import crypto from 'crypto';
const { publicKey: realPubKey, privateKey: realPrivKey } = crypto.generateKeyPairSync('ed25519');

vi.mock('../crypto/pki', async () => {
    return {
        verifyDelegationSignature: vi.fn(),
        signDelegationPayload: vi.fn().mockReturnValue('mock-signature'),
        getServerIdentity: vi.fn(() => ({
            publicKey: realPubKey,
            privateKey: realPrivKey
        }))
    };
});

vi.mock('../utils/federationFetch', () => ({
    federationFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }), status: 200 }),
}));

import { verifyDelegationSignature } from '../crypto/pki';

describe('Account Reactivation on Rejoin', () => {
    const mockBroadcast = vi.fn();
    let app: any;
    const accountId = 'user-rejoin-123';
    let token: string;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp(dbManager, mockBroadcast);
        token = generateToken(accountId);
    });

    // =========================================================================
    // Phase 1: POST /api/servers/:serverId/profiles — account reactivation
    // =========================================================================
    describe('POST /api/servers/:serverId/profiles (new join)', () => {

        it('should reactivate a deactivated account when creating a profile', async () => {
            const serverId = 'server-alpha';
            // Account exists and IS deactivated
            (dbManager.getNodeQuery as any).mockImplementation((sql: string, params: any[]) => {
                if (sql.includes('SELECT id, public_key FROM accounts')) {
                    return { id: accountId, public_key: 'existing-key' };
                }
                if (sql.includes('SELECT is_deactivated FROM accounts')) {
                    return { is_deactivated: 1 };
                }
                if (sql.includes('SELECT avatar_url FROM global_profiles')) {
                    return null;
                }
                return null;
            });

            const newProfileId = 'profile-new-123';
            (dbManager.getServerQuery as any).mockResolvedValue({
                id: newProfileId,
                server_id: serverId,
                account_id: accountId,
                nickname: 'ReturnUser',
                membership_status: 'active'
            });

            const res = await request(app)
                .post(`/api/servers/${serverId}/profiles`)
                .set('Authorization', `Bearer ${token}`)
                .send({ nickname: 'ReturnUser' });

            expect(res.status).toBe(200);

            // Verify is_deactivated was cleared
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 0 WHERE id = ?',
                [accountId]
            );
        });

        it('should NOT attempt reactivation if account is not deactivated', async () => {
            const serverId = 'server-alpha';
            (dbManager.getNodeQuery as any).mockImplementation((sql: string) => {
                if (sql.includes('SELECT id, public_key FROM accounts')) {
                    return { id: accountId, public_key: 'key' };
                }
                if (sql.includes('SELECT is_deactivated FROM accounts')) {
                    return { is_deactivated: 0 };
                }
                if (sql.includes('SELECT avatar_url FROM global_profiles')) {
                    return null;
                }
                return null;
            });

            (dbManager.getServerQuery as any).mockResolvedValue({
                id: 'profile-123',
                server_id: serverId,
                account_id: accountId,
                nickname: 'ActiveUser'
            });

            const res = await request(app)
                .post(`/api/servers/${serverId}/profiles`)
                .set('Authorization', `Bearer ${token}`)
                .send({ nickname: 'ActiveUser' });

            expect(res.status).toBe(200);

            // Should NOT have called update for deactivation
            expect(dbManager.runNodeQuery).not.toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 0 WHERE id = ?',
                [accountId]
            );
        });

        it('should skip reactivation for guest profiles', async () => {
            const serverId = 'server-alpha';
            (dbManager.getNodeQuery as any).mockResolvedValue(null);

            (dbManager.getServerQuery as any).mockResolvedValue({
                id: 'guest-profile-123',
                server_id: serverId,
                account_id: null,
                nickname: 'Guest'
            });

            const res = await request(app)
                .post(`/api/servers/${serverId}/profiles`)
                .set('Authorization', `Bearer ${token}`)
                .send({ nickname: 'Guest', isGuest: true });

            expect(res.status).toBe(200);

            // Should NOT have called deactivation check for guests
            expect(dbManager.getNodeQuery).not.toHaveBeenCalledWith(
                expect.stringContaining('SELECT is_deactivated'),
                expect.anything()
            );
        });
    });

    // =========================================================================
    // Phase 2: POST /api/servers/:serverId/rejoin — profile + account reactivation
    // =========================================================================
    describe('POST /api/servers/:serverId/rejoin', () => {

        it('should reactivate both profile and account on rejoin', async () => {
            const serverId = 'server-beta';
            const profileId = 'profile-left-456';

            // No active profile (correct — user left)
            (dbManager.getServerQuery as any).mockImplementation((sid: string, sql: string, params: any[]) => {
                if (sql.includes("membership_status = ?") && params.includes('active')) {
                    return null; // No active profile
                }
                if (sql.includes("membership_status = ?") && params.includes('left')) {
                    return { id: profileId, account_id: accountId, server_id: serverId, membership_status: 'left' };
                }
                // After reactivation, return the reactivated profile
                return { id: profileId, account_id: accountId, server_id: serverId, membership_status: 'active' };
            });

            const res = await request(app)
                .post(`/api/servers/${serverId}/rejoin`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);

            // Verify profile reactivation
            expect(dbManager.runServerQuery).toHaveBeenCalledWith(
                serverId,
                'UPDATE profiles SET membership_status = ?, left_at = NULL WHERE id = ? AND server_id = ?',
                ['active', profileId, serverId]
            );

            // Verify account reactivation
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 0 WHERE id = ?',
                [accountId]
            );

            // Verify broadcast
            expect(mockBroadcast).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'MEMBER_JOIN' })
            );
        });

        it('should return 409 if user already has an active profile but still clear deactivation', async () => {
            const serverId = 'server-beta';

            (dbManager.getServerQuery as any).mockImplementation((sid: string, sql: string, params: any[]) => {
                if (sql.includes("membership_status = ?") && params.includes('active')) {
                    return { id: 'active-profile' }; // Already active
                }
                return null;
            });

            const res = await request(app)
                .post(`/api/servers/${serverId}/rejoin`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(409);
            expect(res.body.error).toMatch(/Already an active member/);

            // The 409 path now defensively clears is_deactivated in case the account
            // was deactivated by federation but the profile remained active.
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 0 WHERE id = ? AND is_deactivated = 1',
                [accountId]
            );
        });

        it('should return needs_profile:true if no previous membership exists', async () => {
            const serverId = 'server-gamma';

            (dbManager.getServerQuery as any).mockResolvedValue(null); // No profiles at all

            const res = await request(app)
                .post(`/api/servers/${serverId}/rejoin`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.needs_profile).toBe(true);

            // Should NOT have attempted reactivation
            expect(dbManager.runNodeQuery).not.toHaveBeenCalledWith(
                expect.stringContaining('is_deactivated = 0'),
                expect.anything()
            );
        });
    });

    // =========================================================================
    // Phase 3: Round-Trip Integration — full leave→deactivate→rejoin→verify flow
    // =========================================================================
    describe('Round-Trip: leave → deactivate → rejoin → access', () => {

        it('should complete the full lifecycle: leave, federation deactivate, rejoin via profile creation, then pass RBAC', async () => {
            const serverId = 'server-roundtrip';
            const profileId = 'profile-roundtrip-1';

            // === STEP 1: Leave Server ===
            (dbManager.getServerQuery as any).mockResolvedValueOnce(
                { id: profileId } // Active profile found for leave
            );

            const leaveRes = await request(app)
                .post(`/api/servers/${serverId}/leave`)
                .set('Authorization', `Bearer ${token}`);

            expect(leaveRes.status).toBe(200);
            expect(leaveRes.body.success).toBe(true);

            // Verify profile was set to 'left'
            expect(dbManager.runServerQuery).toHaveBeenCalledWith(
                serverId,
                expect.stringContaining("membership_status = ?"),
                expect.arrayContaining(['left', profileId, serverId])
            );

            // === STEP 2: Federation Deactivate ===
            (verifyDelegationSignature as any).mockReturnValue(true);
            (dbManager.getAllLoadedServers as any).mockResolvedValue([{ id: serverId }]);

            const deactivateRes = await request(app)
                .post('/api/federation/deactivate')
                .send({
                    accountId,
                    delegationCert: {
                        payload: { userId: accountId, timestamp: Date.now() },
                        signature: 'valid-sig',
                        primaryPublicKey: 'pk'
                    }
                });

            expect(deactivateRes.status).toBe(200);

            // Verify is_deactivated = 1 was set
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 1 WHERE id = ?',
                [accountId]
            );

            // === STEP 3: Rejoin — Create new profile ===
            // Now simulate the state after deactivation: account exists, is_deactivated=1
            vi.clearAllMocks();
            (dbManager.getNodeQuery as any).mockImplementation((sql: string) => {
                if (sql.includes('SELECT id, public_key FROM accounts')) {
                    return { id: accountId, public_key: 'key' };
                }
                if (sql.includes('SELECT is_deactivated FROM accounts')) {
                    return { is_deactivated: 1 };
                }
                if (sql.includes('SELECT avatar_url FROM global_profiles')) {
                    return null;
                }
                return null;
            });

            (dbManager.getServerQuery as any).mockResolvedValue({
                id: 'new-profile-after-rejoin',
                server_id: serverId,
                account_id: accountId,
                nickname: 'ReturningUser',
                membership_status: 'active'
            });

            const rejoinRes = await request(app)
                .post(`/api/servers/${serverId}/profiles`)
                .set('Authorization', `Bearer ${token}`)
                .send({ nickname: 'ReturningUser' });

            expect(rejoinRes.status).toBe(200);

            // Verify account was reactivated
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 0 WHERE id = ?',
                [accountId]
            );

            // === STEP 4: Verify RBAC would now pass ===
            // After reactivation, is_deactivated should be 0, allowing RBAC through.
            // We verify this by checking the DB call sequence confirms the flag was cleared.
            const reactivationCalls = (dbManager.runNodeQuery as any).mock.calls
                .filter((c: any[]) => c[0].includes('is_deactivated = 0'));
            expect(reactivationCalls.length).toBe(1);
            expect(reactivationCalls[0][1]).toEqual([accountId]);
        });

        it('should complete the full lifecycle using the /rejoin endpoint (existing profile path)', async () => {
            const serverId = 'server-roundtrip-2';
            const profileId = 'profile-roundtrip-2';

            // === STEP 1: Leave Server ===
            (dbManager.getServerQuery as any).mockResolvedValueOnce({ id: profileId });

            const leaveRes = await request(app)
                .post(`/api/servers/${serverId}/leave`)
                .set('Authorization', `Bearer ${token}`);

            expect(leaveRes.status).toBe(200);

            // === STEP 2: Federation Deactivate ===
            (verifyDelegationSignature as any).mockReturnValue(true);
            (dbManager.getAllLoadedServers as any).mockResolvedValue([{ id: serverId }]);

            const deactivateRes = await request(app)
                .post('/api/federation/deactivate')
                .send({
                    accountId,
                    delegationCert: {
                        payload: { userId: accountId, timestamp: Date.now() },
                        signature: 'valid-sig',
                        primaryPublicKey: 'pk'
                    }
                });

            expect(deactivateRes.status).toBe(200);
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 1 WHERE id = ?',
                [accountId]
            );

            // === STEP 3: Rejoin via /rejoin endpoint ===
            vi.clearAllMocks();

            (dbManager.getServerQuery as any).mockImplementation((sid: string, sql: string, params: any[]) => {
                if (sql.includes("membership_status = ?") && params.includes('active')) {
                    return null; // No active profile
                }
                if (sql.includes("membership_status = ?") && params.includes('left')) {
                    return { id: profileId, account_id: accountId, server_id: serverId, membership_status: 'left' };
                }
                // Return reactivated profile
                return { id: profileId, account_id: accountId, server_id: serverId, membership_status: 'active', nickname: 'ReturnUser' };
            });

            const rejoinRes = await request(app)
                .post(`/api/servers/${serverId}/rejoin`)
                .set('Authorization', `Bearer ${token}`);

            expect(rejoinRes.status).toBe(200);

            // Profile reactivated
            expect(dbManager.runServerQuery).toHaveBeenCalledWith(
                serverId,
                'UPDATE profiles SET membership_status = ?, left_at = NULL WHERE id = ? AND server_id = ?',
                ['active', profileId, serverId]
            );

            // Account reactivated
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 0 WHERE id = ?',
                [accountId]
            );

            // MEMBER_JOIN broadcast
            expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
                type: 'MEMBER_JOIN'
            }));
        });
    });

    // =========================================================================
    // Phase 4: Edge cases and regressions
    // =========================================================================
    describe('Edge Cases', () => {

        it('should handle account that does not exist in DB during profile creation (federated placeholder)', async () => {
            const serverId = 'server-edge';

            // Account does NOT exist (first time on this node)
            (dbManager.getNodeQuery as any).mockImplementation((sql: string) => {
                if (sql.includes('SELECT id, public_key FROM accounts')) {
                    return null; // No local account
                }
                if (sql.includes('SELECT is_deactivated FROM accounts')) {
                    // After INSERT OR IGNORE, the account may exist but with default is_deactivated=0
                    return { is_deactivated: 0 };
                }
                if (sql.includes('SELECT avatar_url FROM global_profiles')) {
                    return null;
                }
                return null;
            });

            (dbManager.getServerQuery as any).mockResolvedValue({
                id: 'new-fed-profile',
                server_id: serverId,
                account_id: accountId,
                nickname: 'FederatedUser'
            });

            const res = await request(app)
                .post(`/api/servers/${serverId}/profiles`)
                .set('Authorization', `Bearer ${token}`)
                .send({ nickname: 'FederatedUser' });

            expect(res.status).toBe(200);

            // Placeholder account should have been created
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT OR IGNORE INTO accounts'),
                expect.arrayContaining([accountId])
            );

            // No reactivation needed (is_deactivated = 0)
            expect(dbManager.runNodeQuery).not.toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 0 WHERE id = ?',
                [accountId]
            );
        });

        it('should handle the deactivate → rejoin → deactivate → rejoin cycle correctly', async () => {
            const serverId = 'server-cycle';

            // First rejoin cycle — account is deactivated
            (dbManager.getNodeQuery as any).mockImplementation((sql: string) => {
                if (sql.includes('SELECT id, public_key FROM accounts')) {
                    return { id: accountId, public_key: 'key' };
                }
                if (sql.includes('SELECT is_deactivated FROM accounts')) {
                    return { is_deactivated: 1 };
                }
                if (sql.includes('SELECT avatar_url FROM global_profiles')) {
                    return null;
                }
                return null;
            });

            (dbManager.getServerQuery as any).mockResolvedValue({
                id: 'cycle-profile-1',
                server_id: serverId,
                account_id: accountId,
                nickname: 'CycleUser'
            });

            const firstJoin = await request(app)
                .post(`/api/servers/${serverId}/profiles`)
                .set('Authorization', `Bearer ${token}`)
                .send({ nickname: 'CycleUser' });

            expect(firstJoin.status).toBe(200);
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 0 WHERE id = ?',
                [accountId]
            );

            // Reset and simulate second deactivation + rejoin
            vi.clearAllMocks();

            // Account is deactivated again
            (dbManager.getNodeQuery as any).mockImplementation((sql: string) => {
                if (sql.includes('SELECT id, public_key FROM accounts')) {
                    return { id: accountId, public_key: 'key' };
                }
                if (sql.includes('SELECT is_deactivated FROM accounts')) {
                    return { is_deactivated: 1 };
                }
                if (sql.includes('SELECT avatar_url FROM global_profiles')) {
                    return null;
                }
                return null;
            });

            (dbManager.getServerQuery as any).mockResolvedValue({
                id: 'cycle-profile-2',
                server_id: serverId,
                account_id: accountId,
                nickname: 'CycleUser2'
            });

            const secondJoin = await request(app)
                .post(`/api/servers/${serverId}/profiles`)
                .set('Authorization', `Bearer ${token}`)
                .send({ nickname: 'CycleUser2' });

            expect(secondJoin.status).toBe(200);
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                'UPDATE accounts SET is_deactivated = 0 WHERE id = ?',
                [accountId]
            );
        });
    });
});
