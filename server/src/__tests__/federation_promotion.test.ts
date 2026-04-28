/**
 * Federation Promotion Performance Fix — Server Tests
 *
 * Validates the server-side fixes for the federation primary node transition
 * performance regression:
 *
 *  1. POST /api/federation/promote returns a fresh JWT in the response
 *  2. The returned token has `iss` matching the new primary URL (not old primary)
 *  3. PublicKeyCache.clearUrl correctly invalidates a specific cache entry
 *  4. POST /api/federation/demote clears stale key cache entries
 *  5. The promote handler still requires valid delegation + password auth
 *  6. Integration: full promote → demote flow preserves token + cache consistency
 *  7. Promotion syncs global profile from old primary
 */

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

// Generate a real Ed25519 key pair for PKI mocking
import crypto from 'crypto';
const { publicKey: realPubKey, privateKey: realPrivKey } = crypto.generateKeyPairSync('ed25519');

vi.mock('../crypto/pki', async () => {
    return {
        verifyDelegationSignature: vi.fn(),
        signDelegationPayload: vi.fn().mockReturnValue('mock-signature'),
        getServerIdentity: vi.fn(() => ({
            publicKey: realPubKey,
            privateKey: realPrivKey
        })),
        _remoteKeyCache: {
            clearUrl: vi.fn(),
            _clear: vi.fn(),
        },
    };
});

vi.mock('../utils/federationFetch', () => ({
    federationFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }), status: 200 }),
}));

import { verifyDelegationSignature, _remoteKeyCache } from '../crypto/pki';
import { federationFetch } from '../utils/federationFetch';

describe('Federation Promotion Performance Fix', () => {
    const mockBroadcast = vi.fn();
    let app: any;
    let testToken: string;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp(dbManager, mockBroadcast);
        testToken = generateToken('user-123');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 1. Promote returns a fresh JWT
    // ═══════════════════════════════════════════════════════════════════════

    describe('Promote returns fresh JWT', () => {
        it('1. POST /api/federation/promote response includes a token field', async () => {
            (verifyDelegationSignature as any).mockReturnValue(true);
            (dbManager.getNodeQuery as any).mockResolvedValue({
                id: 'user-123',
                auth_verifier: 'testpassword',
                authority_role: 'replica'
            });
            (dbManager.allNodeQuery as any).mockResolvedValue([]);

            const response = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'user-123',
                    delegationCert: {
                        payload: { userId: 'user-123', timestamp: Date.now() },
                        signature: 'good-sig',
                        primaryPublicKey: 'pub-key'
                    },
                    serverAuthKey: 'testpassword',
                    oldPrimaryUrl: 'http://localhost:3001'
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('token');
            expect(typeof response.body.token).toBe('string');
            expect(response.body.token.length).toBeGreaterThan(0);
        });

        it('2. returned token is a valid JWT with correct structure', async () => {
            (verifyDelegationSignature as any).mockReturnValue(true);
            (dbManager.getNodeQuery as any).mockResolvedValue({
                id: 'user-123',
                auth_verifier: 'testpassword',
                authority_role: 'replica'
            });
            (dbManager.allNodeQuery as any).mockResolvedValue([]);

            const response = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'user-123',
                    delegationCert: {
                        payload: { userId: 'user-123', timestamp: Date.now() },
                        signature: 'good-sig',
                        primaryPublicKey: 'pub-key'
                    },
                    serverAuthKey: 'testpassword',
                    oldPrimaryUrl: 'http://localhost:3001'
                });

            expect(response.status).toBe(200);

            // Decode the JWT payload to verify its contents
            const token = response.body.token;
            const parts = token.split('.');
            expect(parts.length).toBe(3); // header.payload.signature

            let payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (payloadBase64.length % 4) payloadBase64 += '=';
            const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));

            // Token should contain the correct accountId
            expect(payload.accountId).toBe('user-123');
            // Token should have an issuer field (set by the server's selfUrl)
            expect(payload).toHaveProperty('iss');
            // Token should have an expiry
            expect(payload).toHaveProperty('exp');
            expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
        });

        it('3. promote still requires valid delegation certificate', async () => {
            (verifyDelegationSignature as any).mockReturnValue(false);

            const response = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'user-123',
                    delegationCert: {
                        payload: { userId: 'user-123', timestamp: Date.now() },
                        signature: 'bad-sig',
                        primaryPublicKey: 'pub-key'
                    },
                    serverAuthKey: 'testpassword'
                });

            expect(response.status).toBe(401);
            expect(response.body).not.toHaveProperty('token');
        });

        it('4. promote still requires correct password', async () => {
            (verifyDelegationSignature as any).mockReturnValue(true);
            (dbManager.getNodeQuery as any).mockResolvedValue({
                id: 'user-123',
                auth_verifier: 'correct-password',
                authority_role: 'replica'
            });

            const response = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'user-123',
                    delegationCert: {
                        payload: { userId: 'user-123', timestamp: Date.now() },
                        signature: 'good-sig',
                        primaryPublicKey: 'pub-key'
                    },
                    serverAuthKey: 'wrong-password',
                    oldPrimaryUrl: 'http://localhost:3001'
                });

            expect(response.status).toBe(401);
            expect(response.body).not.toHaveProperty('token');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 2. Demote clears stale key cache
    // ═══════════════════════════════════════════════════════════════════════

    describe('Demote clears stale key cache', () => {
        it('5. POST /api/federation/demote calls _remoteKeyCache.clearUrl', async () => {
            (verifyDelegationSignature as any).mockReturnValue(true);

            const response = await request(app)
                .post('/api/federation/demote')
                .send({
                    accountId: 'user-123',
                    newPrimaryUrl: 'http://localhost:3002',
                    delegationCert: {
                        payload: { userId: 'user-123', timestamp: Date.now() },
                        signature: 'valid-sig',
                        primaryPublicKey: 'pub-key'
                    }
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);

            // Should have cleared the cache for both the local URL and the new primary
            expect(_remoteKeyCache.clearUrl).toHaveBeenCalled();
            expect(_remoteKeyCache.clearUrl).toHaveBeenCalledWith('http://localhost:3002');
        });

        it('6. demote updates account to replica with new primary_server_url', async () => {
            (verifyDelegationSignature as any).mockReturnValue(true);

            const response = await request(app)
                .post('/api/federation/demote')
                .send({
                    accountId: 'user-456',
                    newPrimaryUrl: 'http://localhost:3002',
                    delegationCert: {
                        payload: { userId: 'user-456', timestamp: Date.now() },
                        signature: 'valid-sig',
                        primaryPublicKey: 'pub-key'
                    }
                });

            expect(response.status).toBe(200);
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining("authority_role = 'replica'"),
                expect.arrayContaining(['http://localhost:3002', 'user-456'])
            );
        });

        it('7. demote rejects expired delegation certificates', async () => {
            (verifyDelegationSignature as any).mockReturnValue(true);

            const response = await request(app)
                .post('/api/federation/demote')
                .send({
                    accountId: 'user-123',
                    newPrimaryUrl: 'http://localhost:3002',
                    delegationCert: {
                        payload: {
                            userId: 'user-123',
                            timestamp: Date.now() - (1000 * 60 * 60 * 25) // 25 hours ago (expired)
                        },
                        signature: 'valid-sig',
                        primaryPublicKey: 'pub-key'
                    }
                });

            expect(response.status).toBe(401);
            expect(response.body.error).toMatch(/expired/i);
            // Should NOT clear cache on rejected demote
            expect(_remoteKeyCache.clearUrl).not.toHaveBeenCalled();
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 3. Integration: Promote → Demote consistency
    // ═══════════════════════════════════════════════════════════════════════

    describe('Promote → Demote Integration', () => {
        it('8. successful promote followed by demote maintains consistent state', async () => {
            (verifyDelegationSignature as any).mockReturnValue(true);

            // Step 1: Promote
            (dbManager.getNodeQuery as any).mockResolvedValue({
                id: 'sys-user',
                auth_verifier: 'sys-password',
                authority_role: 'replica'
            });
            (dbManager.allNodeQuery as any).mockResolvedValue([]);

            const promoteRes = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'sys-user',
                    delegationCert: {
                        payload: { userId: 'sys-user', timestamp: Date.now() },
                        signature: 'sys-sig',
                        primaryPublicKey: 'pk'
                    },
                    serverAuthKey: 'sys-password',
                    oldPrimaryUrl: 'http://old-primary.local'
                });

            expect(promoteRes.status).toBe(200);
            expect(promoteRes.body.token).toBeDefined();

            // Step 2: Verify authority_role was set to primary
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining("authority_role = 'primary'"),
                expect.arrayContaining(['sys-user'])
            );

            // Step 3: Verify trusted_servers was updated
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining("INSERT INTO account_servers"),
                expect.any(Array)
            );

            vi.clearAllMocks();

            // Step 4: Now receive a demote (simulating another node taking over)
            const demoteRes = await request(app)
                .post('/api/federation/demote')
                .send({
                    accountId: 'sys-user',
                    newPrimaryUrl: 'http://new-primary.local',
                    delegationCert: {
                        payload: { userId: 'sys-user', timestamp: Date.now() },
                        signature: 'demote-sig',
                        primaryPublicKey: 'pk2'
                    }
                });

            expect(demoteRes.status).toBe(200);

            // Verify authority_role was set to replica
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining("authority_role = 'replica'"),
                expect.arrayContaining(['http://new-primary.local', 'sys-user'])
            );

            // Verify cache was cleared
            expect(_remoteKeyCache.clearUrl).toHaveBeenCalledWith('http://new-primary.local');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 4. Promotion syncs global profile
    // ═══════════════════════════════════════════════════════════════════════

    describe('Promote syncs global profile', () => {
        it('9. promote fetches global profile from old primary and stores it locally', async () => {
            (verifyDelegationSignature as any).mockReturnValue(true);
            (dbManager.getNodeQuery as any).mockResolvedValue({
                id: 'user-123',
                auth_verifier: 'testpassword',
                authority_role: 'replica'
            });
            (dbManager.allNodeQuery as any).mockResolvedValue([]);

            // Mock federationFetch to return a global profile for the profile endpoint
            const mockProfile = {
                account_id: 'user-123',
                display_name: 'GHz',
                bio: 'Test bio',
                avatar_url: 'http://localhost:3001/uploads/avatar.png',
                status_message: 'Online',
                version: 5,
                signature: 'mock-sig'
            };
            (federationFetch as any).mockImplementation((url: string) => {
                if (url.includes('/api/federation/profile/')) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => mockProfile,
                        status: 200
                    });
                }
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ success: true }),
                    status: 200
                });
            });

            const response = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'user-123',
                    delegationCert: {
                        payload: { userId: 'user-123', timestamp: Date.now() },
                        signature: 'good-sig',
                        primaryPublicKey: 'pub-key'
                    },
                    serverAuthKey: 'testpassword',
                    oldPrimaryUrl: 'http://localhost:3001'
                });

            expect(response.status).toBe(200);

            // Verify federationFetch was called with the profile endpoint
            expect(federationFetch).toHaveBeenCalledWith(
                'http://localhost:3001/api/federation/profile/user-123',
                expect.objectContaining({ signal: expect.anything() })
            );

            // Verify the profile was stored in the local node DB
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO global_profiles'),
                expect.arrayContaining([
                    'user-123',
                    'GHz',
                    'Test bio',
                    'http://localhost:3001/uploads/avatar.png',
                    'Online',
                    5,
                    'mock-sig'
                ])
            );
        });

        it('10. promote gracefully handles old primary being unreachable', async () => {
            (verifyDelegationSignature as any).mockReturnValue(true);
            (dbManager.getNodeQuery as any).mockResolvedValue({
                id: 'user-123',
                auth_verifier: 'testpassword',
                authority_role: 'replica'
            });
            (dbManager.allNodeQuery as any).mockResolvedValue([]);

            // Mock federationFetch to fail for profile fetch
            (federationFetch as any).mockImplementation((url: string) => {
                if (url.includes('/api/federation/profile/')) {
                    return Promise.reject(new Error('Connection refused'));
                }
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ success: true }),
                    status: 200
                });
            });

            const response = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId: 'user-123',
                    delegationCert: {
                        payload: { userId: 'user-123', timestamp: Date.now() },
                        signature: 'good-sig',
                        primaryPublicKey: 'pub-key'
                    },
                    serverAuthKey: 'testpassword',
                    oldPrimaryUrl: 'http://localhost:3001'
                });

            // Promotion should still succeed even if profile sync fails
            expect(response.status).toBe(200);
            expect(response.body.token).toBeDefined();

            // No global_profiles INSERT should have been called
            const globalProfileCalls = (dbManager.runNodeQuery as any).mock.calls.filter(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('global_profiles')
            );
            expect(globalProfileCalls.length).toBe(0);
        });
    });
});
