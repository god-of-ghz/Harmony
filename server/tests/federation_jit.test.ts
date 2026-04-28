import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp, generateToken } from '../src/app';
import { signDelegationPayload, _resetCachedIdentity, initializeServerIdentity } from '../src/crypto/pki';

const mockDbManager = vi.hoisted(() => ({
    channelToServerId: { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} },
    channelToGuildId: { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} },
    allNodeQuery: vi.fn(),
    getNodeQuery: vi.fn().mockResolvedValue(null),
    runNodeQuery: vi.fn(),
    allServerQuery: vi.fn().mockResolvedValue([]),
    allGuildQuery: vi.fn().mockResolvedValue([]),
    getServerQuery: vi.fn(),
    getGuildQuery: vi.fn(),
    runServerQuery: vi.fn(),
    runGuildQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([])
,
    getAllLoadedGuilds: vi.fn().mockResolvedValue([])}));

vi.mock('../src/database', () => ({
    DATA_DIR: 'mock_data',
    default: mockDbManager
}));

// P18 FIX: Wire guild methods as aliases of server methods
mockDbManager.allGuildQuery = mockDbManager.allServerQuery;
mockDbManager.getGuildQuery = mockDbManager.getServerQuery;
mockDbManager.runGuildQuery = mockDbManager.runServerQuery;
mockDbManager.getAllLoadedGuilds = mockDbManager.getAllLoadedServers;
mockDbManager.channelToGuildId = mockDbManager.channelToServerId;


// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

const app = createApp(mockDbManager, vi.fn());

describe('Phase 3: JIT State Synchronization', () => {
    let testToken: string;
    let identity: any;

    beforeEach(() => {
        vi.clearAllMocks();
        _resetCachedIdentity();
        identity = initializeServerIdentity('mock_data');
        testToken = generateToken('acc-123');
    });

    describe('Primary Server Logic (PUT /api/profiles/global)', () => {
        it('should bump version and cryptographically sign the payload on saving profile', async () => {
            mockDbManager.getNodeQuery.mockImplementation(async (query: string, params: any) => {
                if (query.includes('SELECT version')) return { version: 3 };
                if (query.includes('SELECT * FROM global_profiles')) return {
                    account_id: 'acc-123',
                    bio: 'new bio',
                    avatar_url: 'new-avatar',
                    status_message: '',
                    version: 4,
                    signature: 'dummy'
                };
                return null;
            });

            const res = await request(app)
                .put('/api/profiles/global')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ bio: 'new bio', avatar_url: 'new-avatar', status_message: '' });

            expect(res.status).toBe(200);

            // Assert db call was made with proper signature
            expect(mockDbManager.runNodeQuery).toHaveBeenCalled();
            const insertCall = mockDbManager.runNodeQuery.mock.calls[0];
            const insertQuery = insertCall[0];
            const insertParams = insertCall[1];

            expect(insertQuery).toContain('INSERT INTO global_profiles');
            
            // version should be 3 + 1 = 4
            expect(insertParams[4]).toBe(4);
            
            // signature should be generated based on payload and PKI
            const payloadHashString = JSON.stringify({
                account_id: 'acc-123',
                bio: 'new bio',
                avatar_url: 'new-avatar',
                status_message: '',
                version: 4
            });
            const expectedSig = crypto.sign(undefined, Buffer.from(payloadHashString), identity.privateKey).toString('base64');
            expect(insertParams[5]).toBe(expectedSig);
        });
    });

    describe('Standard Server Handshake (POST /api/guild/connect)', () => {
        it('should successfully fetch, verify, and update cache when remote version is higher, and cascade to replicas', async () => {
            mockDbManager.getNodeQuery.mockImplementation(async (query: string, params: any) => {
                if (query.includes('SELECT version')) return { version: 2 }; // Local is V2
                if (query.includes('SELECT primary_server_url')) return { primary_server_url: 'http://primary.local' };
                return null;
            });
            
            mockDbManager.getAllLoadedServers.mockResolvedValueOnce([{ id: 'mock-server-1' }]);
            mockDbManager.getServerQuery.mockResolvedValueOnce({ id: 'prof-1', account_id: 'acc-123', avatar: 'newer-avatar' });

            const validPayload = {
                account_id: 'acc-123',
                bio: 'newer bio',
                avatar_url: 'newer-avatar',
                status_message: 'hello',
                version: 3
            };
            const validSignature = signDelegationPayload(validPayload, identity.privateKey);

            mockFetch.mockImplementation(async (url: string) => {
                if (url.includes('/api/federation/key')) {
                    return {
                        ok: true,
                        json: async () => ({
                            public_key: identity.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
                        })
                    };
                }
                if (url.includes('/api/federation/profile/')) {
                    return {
                        ok: true,
                        json: async () => ({
                            ...validPayload,
                            signature: validSignature
                        })
                    };
                }
                return { ok: false };
            });

            const mockBroadcastLocal = vi.fn();
            const localApp = createApp(mockDbManager, mockBroadcastLocal);

            const res = await request(localApp)
                .post('/api/guild/connect')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ current_profile_version: 3 }); // Client reports V3

            expect(res.status).toBe(200);
            expect(mockFetch).toHaveBeenCalledTimes(2);

            // DB should be updated with new version and signature
            expect(mockDbManager.runNodeQuery).toHaveBeenCalled();
            const insertCall = mockDbManager.runNodeQuery.mock.calls[0];
            const insertParams = insertCall[1];
            expect(insertParams[4]).toBe(3); // version
            expect(insertParams[5]).toBe(validSignature);

            // Verify that the avatar update was cascaded to local per-server profiles
            expect(mockDbManager.runServerQuery).toHaveBeenCalledWith('mock-server-1', 'UPDATE profiles SET avatar = ? WHERE account_id = ?', ['newer-avatar', 'acc-123']);
            
            // Verify broadcast
            expect(mockBroadcastLocal).toHaveBeenCalledWith({
                type: 'PROFILE_UPDATE',
                data: { id: 'prof-1', account_id: 'acc-123', avatar: 'newer-avatar' }
            });
        });

        it('should aggressively reject a spoofed payload that fails cryptographic signature verification', async () => {
            mockDbManager.getNodeQuery.mockImplementation(async (query: string, params: any) => {
                if (query.includes('SELECT version')) return { version: 2 }; // Local is V2
                if (query.includes('SELECT primary_server_url')) return { primary_server_url: 'http://malicious.local' };
                return null;
            });

            const spoofedPayload = {
                account_id: 'acc-123',
                bio: 'hacked bio',
                avatar_url: 'hacked',
                status_message: '',
                version: 3
            };
            // Sign with a *different* random key to simulate attacker
            const { privateKey: attackerPrivKey } = crypto.generateKeyPairSync('ed25519');
            const spoofedSignature = signDelegationPayload(spoofedPayload, attackerPrivKey);

            mockFetch.mockImplementation(async (url: string) => {
                if (url.includes('/api/federation/key')) {
                    // Returns the legit Primary server public key
                    return {
                        ok: true,
                        json: async () => ({
                            public_key: identity.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
                        })
                    };
                }
                if (url.includes('/api/federation/profile/')) {
                    return {
                        ok: true,
                        json: async () => ({
                            ...spoofedPayload,
                            signature: spoofedSignature // attacker signature
                        })
                    };
                }
                return { ok: false };
            });

            const res = await request(app)
                .post('/api/guild/connect')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ current_profile_version: 3 });

            // Expect a 401 Unauthorized for bad crypto
            expect(res.status).toBe(401);
            expect(res.body.error).toContain('Cryptographic validation failed');

            // Ensure DB was NOT updated
            expect(mockDbManager.runNodeQuery).not.toHaveBeenCalled();
        });

        it('should fallback gracefully to stale cache if Primary Server is unresponsive (Network Timeout)', async () => {
            mockDbManager.getNodeQuery.mockImplementation(async (query: string, params: any) => {
                if (query.includes('SELECT version')) return { version: 4 }; // Local is V4
                if (query.includes('SELECT primary_server_url')) return { primary_server_url: 'http://dead.primary' };
                return null;
            });

            mockFetch.mockImplementation(async (url: string) => {
                // Simulate network timeout or rejection
                throw new Error('fetch failed (network timeout)');
            });

            const res = await request(app)
                .post('/api/guild/connect')
                .set('Authorization', `Bearer ${testToken}`)
                .send({ current_profile_version: 5 }); // Update is V5

            // Should not fail the connection, just gracefully use the stale cache
            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Connected and verified');
            
            // Should NOT have run DB query
            expect(mockDbManager.runNodeQuery).not.toHaveBeenCalled();
        });
    });
});
