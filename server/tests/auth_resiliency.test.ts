import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp, generateToken } from '../src/app';
import * as pki from '../src/crypto/pki';

const mockDbManager = vi.hoisted(() => ({
    channelToServerId: { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} },
    channelToGuildId: { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} },
    getNodeQuery: vi.fn(),
    runNodeQuery: vi.fn(),
    allNodeQuery: vi.fn(),
    getServerQuery: vi.fn(),
    getGuildQuery: vi.fn(),
    runServerQuery: vi.fn(),
    runGuildQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([]),
    getAllLoadedGuilds: vi.fn().mockResolvedValue([]),
    allServerQuery: vi.fn()
,
    allGuildQuery: vi.fn().mockResolvedValue([])}));

vi.mock('../src/database', () => ({
    DATA_DIR: 'mock_data_dir',
    default: mockDbManager
}));

// P18 FIX: Wire guild methods as aliases of server methods
mockDbManager.allGuildQuery = mockDbManager.allServerQuery;
mockDbManager.getGuildQuery = mockDbManager.getServerQuery;
mockDbManager.runGuildQuery = mockDbManager.runServerQuery;
mockDbManager.getAllLoadedGuilds = mockDbManager.getAllLoadedServers;
mockDbManager.channelToGuildId = mockDbManager.channelToServerId;


// Mock FS for PKI
vi.mock('fs', () => ({
    default: {
        rmSync: vi.fn(),
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        accessSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn()
    }
}));

const app = createApp(mockDbManager, vi.fn());

describe('Phase 2: Trusted Identity Core & Resiliency', () => {
    let primaryIdentity: any;
    
    beforeEach(() => {
        vi.clearAllMocks();
        pki._resetCachedIdentity(); // Reset PKI state
        // Manually generate a valid in-memory keypair for tests
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        primaryIdentity = { publicKey, privateKey };
        
        // Mock pki.ts getServerIdentity to return our test identity
        vi.spyOn(pki, 'getServerIdentity').mockReturnValue(primaryIdentity);
    });

    it('Fail Case 1: Replicas should throw 403 Forbidden on global profile edits', async () => {
        const token = generateToken('acc_replica');

        // Build a proper scrypt verifier so validation passes and we get to the replica check
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync('current-key', salt, 64).toString('hex');
        const authVerifier = `${salt}:${hash}`;

        // Mock DB returning a replica authority role
        mockDbManager.getNodeQuery.mockResolvedValue({ id: 'acc_replica', authority_role: 'replica', auth_verifier: authVerifier });

        const res = await request(app)
            .put('/api/accounts/password')
            .set('Authorization', `Bearer ${token}`)
            .send({
                oldServerAuthKey: 'current-key',
                serverAuthKey: 'new-key',
                encrypted_private_key: 'enc',
                key_salt: 'salt',
                key_iv: 'iv'
            });

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('Cannot modify credentials on a Replica server');

        const resDiscord = await request(app)
            .post('/api/accounts/link-discord')
            .send({ discord_id: '12345' })
            .set('Authorization', `Bearer ${token}`);

        expect(resDiscord.status).toBe(403);
    });

    it('Fail Case 2: Should reject malformed or improperly signed Delegation Certificates', async () => {
        const payload = { userId: 'acc1', targetServerUrl: 'http://replica', timestamp: Date.now() };
        
        // Proper Signature
        const validSignature = pki.signDelegationPayload(payload, primaryIdentity.privateKey);
        const pubKeyB64 = primaryIdentity.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
        
        // Tampered payload (change targetServerUrl instead of userId so it passes the first check but fails signature)
        const tamperedPayload = { ...payload, targetServerUrl: 'http://hacker' };
        const cert = { payload: tamperedPayload, signature: validSignature, primaryPublicKey: pubKeyB64 };

        const res = await request(app)
            .post('/api/accounts/replica-sync')
            .send({
                account: { id: 'acc1' },
                trusted_servers: [],
                delegationCert: cert,
                primaryServerUrl: 'http://primary'
            });

        // The endpoint should block the tampered signature mismatch
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid signature on delegation certificate');
        
        // Test Expired Cert
        const expiredPayload = { userId: 'acc1', targetServerUrl: 'http://replica', timestamp: Date.now() - (1000 * 60 * 60 * 48) };
        const expiredSignature = pki.signDelegationPayload(expiredPayload, primaryIdentity.privateKey);
        const expiredCert = { payload: expiredPayload, signature: expiredSignature, primaryPublicKey: pubKeyB64 };

        const resExpired = await request(app)
            .post('/api/accounts/replica-sync')
            .send({
                account: { id: 'acc1' },
                trusted_servers: [],
                delegationCert: expiredCert,
                primaryServerUrl: 'http://primary'
            });

        expect(resExpired.status).toBe(401);
        expect(resExpired.body.error).toBe('Delegation certificate expired');
    });

    it('Primary Dead Fallback: Simulates network timeout and cascaedes to Replica local cache', async () => {
        // Setup: We are a replica handling login.
        const mockAccount = {
            id: 'acc1',
            email: 'user@example.com',
            auth_verifier: 'salt:hash123',
            authority_role: 'replica',
            primary_server_url: 'http://dead-primary'
        };

        // We use timingSafeEqual for hash matching in sqlite fallback
        const fakeHashBytes = crypto.scryptSync('valid_auth_key', 'salt', 64);
        mockAccount.auth_verifier = `salt:${fakeHashBytes.toString('hex')}`;

        mockDbManager.getNodeQuery.mockResolvedValue(mockAccount);
        mockDbManager.allNodeQuery.mockResolvedValue([{ server_url: 'http://replica' }]);

        // Explicitly mock a fetch timeout exception
        global.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));

        const res = await request(app)
            .post('/api/accounts/login')
            .send({ email: 'user@example.com', serverAuthKey: 'valid_auth_key' });

        // Ensure we attempted federation to the primary server first
        expect(global.fetch).toHaveBeenCalledWith('http://dead-primary/api/accounts/federate', expect.any(Object));

        // It should seamlessly succeed via local cache fallback
        expect(res.status).toBe(200);
        expect(res.body.id).toBe('acc1');
        expect(res.body.authority_role).toBe('replica');
        expect(res.body.token).toBeDefined();
    });
});
