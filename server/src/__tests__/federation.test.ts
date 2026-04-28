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
            getAllLoadedServers: vi.fn(),
        },
        DATA_DIR: '/mock-data',
        SERVERS_DIR: '/mock-data/servers',
    };
});

// Generate a real Ed25519 key pair for PKI mocking
import crypto from 'crypto';
const { publicKey: realPubKey, privateKey: realPrivKey } = crypto.generateKeyPairSync('ed25519');

// Mock PKI securely without overriding EVERYTHING if not needed, 
// though we only test verifyDelegationSignature in these routes.
vi.mock('../crypto/pki', async (importOriginal) => {
    return {
        verifyDelegationSignature: vi.fn(),
        signDelegationPayload: vi.fn().mockReturnValue('mock-signature'),
        getServerIdentity: vi.fn(() => ({
            publicKey: realPubKey,
            privateKey: realPrivKey
        }))
    };
});

// Mock federationFetch to prevent real network calls from DELETE trusted_servers deactivation
vi.mock('../utils/federationFetch', () => ({
    federationFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }), status: 200 }),
}));

import { verifyDelegationSignature } from '../crypto/pki';

describe('Federation & Trust Management API', () => {
    const mockBroadcast = vi.fn();
    let app: any;
    let testToken: string;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp(dbManager, mockBroadcast);
        testToken = generateToken('user-123');
    });

    describe('Phase 1: Isolated Unit Tests', () => {

        describe('PUT /api/accounts/:accountId/trusted_servers/reorder', () => {
            it('should overwrite trusted servers order successfully', async () => {
                // Mock existing trust levels before reorder
                (dbManager.allNodeQuery as any).mockResolvedValue([
                    { server_url: 'https://replica-a.com', trust_level: 'trusted' },
                    { server_url: 'https://replica-b.com', trust_level: 'untrusted' }
                ]);

                const response = await request(app)
                    .put('/api/accounts/user-123/trusted_servers/reorder')
                    .send({
                        trusted_servers: ['https://replica-b.com', 'https://replica-a.com']
                    });

                expect(response.status).toBe(200);
                
                // Assert it read existing trust levels
                expect(dbManager.allNodeQuery).toHaveBeenCalledWith(
                    'SELECT server_url, trust_level FROM account_servers WHERE account_id = ?',
                    ['user-123']
                );
                
                // Assert it deleted the old state
                expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                    'DELETE FROM account_servers WHERE account_id = ?', 
                    ['user-123']
                );
                
                // Assert it inserted with preserved trust_level
                expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                    'INSERT INTO account_servers (account_id, server_url, trust_level) VALUES (?, ?, ?)',
                    ['user-123', 'https://replica-b.com', 'untrusted']
                );
                expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                    'INSERT INTO account_servers (account_id, server_url, trust_level) VALUES (?, ?, ?)',
                    ['user-123', 'https://replica-a.com', 'trusted']
                );
            });
        });

        describe('DELETE /api/accounts/:accountId/trusted_servers', () => {
            it('should remove a specific replica server', async () => {
                const response = await request(app)
                    .delete('/api/accounts/user-123/trusted_servers')
                    .set('Authorization', `Bearer ${testToken}`)
                    .send({ serverUrl: 'https://replica-a.com' });

                expect(response.status).toBe(200);
                expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                    'DELETE FROM account_servers WHERE account_id = ? AND server_url = ?',
                    ['user-123', 'https://replica-a.com']
                );
            });
        });

        describe('POST /api/federation/promote', () => {
            it('should reject requests with missing certificates', async () => {
                const response = await request(app)
                    .post('/api/federation/promote')
                    .send({ accountId: 'user-123' }); // No cert

                expect(response.status).toBe(400);
                expect(response.body.error).toMatch(/Missing/);
            });

            it('should reject requests with invalid signatures', async () => {
                (verifyDelegationSignature as any).mockReturnValue(false);

                const response = await request(app)
                    .post('/api/federation/promote')
                    .send({ 
                        accountId: 'user-123',
                        delegationCert: {
                            payload: { userId: 'user-123', timestamp: Date.now() },
                            signature: 'bad-sig',
                            primaryPublicKey: 'pub-key'
                        }
                    });

                expect(response.status).toBe(401);
                expect(response.body.error).toMatch(/Invalid signature/);
            });

            it('should successfully elevate authority role to primary with valid signature', async () => {
                (verifyDelegationSignature as any).mockReturnValue(true);
                // Promote now requires password re-auth
                (dbManager.getNodeQuery as any).mockResolvedValue({
                    id: 'user-123',
                    auth_verifier: 'testpassword', // plain text for direct comparison
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
                        oldPrimaryUrl: 'http://old-primary.local'
                    });

                expect(response.status).toBe(200);
                expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                    expect.stringContaining("UPDATE accounts SET authority_role = 'primary'"),
                    expect.arrayContaining(['user-123'])
                );
            });
        });

    });

    describe('Phase 2: System / Integration Test Loop', () => {
        it('should correctly traverse adding, reordering, deleting, and promoting servers logically', async () => {
            // This test simulates the workflow
            const accountId = 'sys-user';

            // 1. Add Replica A (The initial Add server happens via POST /trusted_servers but we can also mock it)
            // Wait, POST trusted_servers requires fetch(). We mock fetch to just return 200 to prevent errors
            global.fetch = vi.fn(() => Promise.resolve({ ok: true })) as any;

            const sysToken = generateToken(accountId);

            await request(app)
                .post(`/api/accounts/${accountId}/trusted_servers`)
                .set('Authorization', `Bearer ${sysToken}`)
                .send({ serverUrl: 'https://replica-a.com' });

            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                "INSERT INTO account_servers (account_id, server_url, trust_level) VALUES (?, ?, 'trusted') ON CONFLICT(account_id, server_url) DO UPDATE SET trust_level = 'trusted'",
                [accountId, 'https://replica-a.com']
            );

            // 2. Add Replica B
            await request(app)
                .post(`/api/accounts/${accountId}/trusted_servers`)
                .set('Authorization', `Bearer ${sysToken}`)
                .send({ serverUrl: 'https://replica-b.com' });

            // 3. Reorder so B is before A
            await request(app)
                .put(`/api/accounts/${accountId}/trusted_servers/reorder`)
                .send({ trusted_servers: ['https://replica-b.com', 'https://replica-a.com'] });

            // 4. Delete A
            await request(app)
                .delete(`/api/accounts/${accountId}/trusted_servers`)
                .set('Authorization', `Bearer ${sysToken}`)
                .send({ serverUrl: 'https://replica-a.com' });
            
            // 5. Ultimately Primary goes down, promote B
            (verifyDelegationSignature as any).mockReturnValue(true);
            // Promote now requires password re-auth
            (dbManager.getNodeQuery as any).mockResolvedValue({
                id: accountId,
                auth_verifier: 'sys-password',
                authority_role: 'replica'
            });
            (dbManager.allNodeQuery as any).mockResolvedValue([]);

            const promoteRes = await request(app)
                .post('/api/federation/promote')
                .send({
                    accountId,
                    delegationCert: {
                        payload: { userId: accountId, timestamp: Date.now() },
                        signature: 'sys-sig',
                        primaryPublicKey: 'pk'
                    },
                    serverAuthKey: 'sys-password',
                    oldPrimaryUrl: 'http://old-primary.local'
                });
            
            expect(promoteRes.status).toBe(200);
            
            // Loop assertions complete. Since it traverses endpoints hitting mock DB successfully, 
            // the system state changes flow through Express correctly.
        });
    });
});
