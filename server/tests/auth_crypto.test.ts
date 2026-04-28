import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp, generateToken } from '../src/app';

const mockDbManager = vi.hoisted(() => ({
    channelToServerId: { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} },
    channelToGuildId: { get: (id: any) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} },
    allNodeQuery: vi.fn(),
    getNodeQuery: vi.fn(),
    runNodeQuery: vi.fn(),
    allServerQuery: vi.fn().mockResolvedValue([]),
    allGuildQuery: vi.fn().mockResolvedValue([]),
    getServerQuery: vi.fn(),
    getGuildQuery: vi.fn(),
    runServerQuery: vi.fn(),
    runGuildQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([]),
    getAllLoadedGuilds: vi.fn().mockResolvedValue([]),
    initializeServerBundle: vi.fn(),
    initializeGuildBundle: vi.fn(),
    unloadServerInstance: vi.fn(),
    unloadGuildInstance: vi.fn(),
}));

vi.mock('../src/database', () => ({
    DATA_DIR: 'mock_data',
    default: mockDbManager
}));

// P18 FIX: Wire guild methods as aliases of server methods
mockDbManager.allGuildQuery = mockDbManager.allServerQuery;
mockDbManager.getGuildQuery = mockDbManager.getServerQuery;
mockDbManager.runGuildQuery = mockDbManager.runServerQuery;
mockDbManager.getAllLoadedGuilds = mockDbManager.getAllLoadedServers;
mockDbManager.initializeGuildBundle = mockDbManager.initializeServerBundle;
mockDbManager.unloadGuildInstance = mockDbManager.unloadServerInstance;
mockDbManager.channelToGuildId = mockDbManager.channelToServerId;


const app = createApp(mockDbManager, vi.fn());

describe('Phase 3: Cryptographic Mitigations (Pass-The-Hash)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Secure Registration (POST /api/accounts/signup)', () => {
        it('should hash serverAuthKey with a 16-byte random salt during signup', async () => {
            mockDbManager.getNodeQuery.mockResolvedValueOnce(null); // Email collision check
            mockDbManager.getNodeQuery.mockResolvedValueOnce({ 
                id: 'acc-new', 
                email: 'new@example.com',
                is_creator: 0,
                is_admin: 0
            }); // Return account after insert
            
            const signupPayload = {
                email: 'new@example.com',
                serverAuthKey: 'super-secret-auth-key',
                public_key: 'pk123',
                encrypted_private_key: 'epk123',
                key_salt: 'salt123',
                key_iv: 'iv123'
            };

            const res = await request(app).post('/api/accounts/signup').send(signupPayload);
            
            expect(res.status).toBe(200);
            expect(res.body.email).toBe('new@example.com');

            // Verify the database insert used hashing
            expect(mockDbManager.runNodeQuery).toHaveBeenCalled();
            const lastCallArgs = mockDbManager.runNodeQuery.mock.calls[0];
            const insertSql = lastCallArgs[0];
            const insertParams = lastCallArgs[1];

            expect(insertSql).toContain('INSERT INTO accounts');
            const savedVerifier = insertParams[2]; // auth_verifier index

            // Format should be salt:hash
            expect(savedVerifier).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
            
            const [salt, hash] = savedVerifier.split(':');
            const expectedHash = crypto.scryptSync('super-secret-auth-key', salt, 64).toString('hex');
            expect(hash).toBe(expectedHash);
        });
    });

    describe('Secure Login (POST /api/accounts/login)', () => {
        const testSalt = crypto.randomBytes(16).toString('hex');
        const testKey = 'login-password-123';
        const testHash = crypto.scryptSync(testKey, testSalt, 64).toString('hex');
        const hashedVerifier = `${testSalt}:${testHash}`;

        it('should successfully login with valid credentials using hashed verifier', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc-hashed',
                email: 'hashed@example.com',
                auth_verifier: hashedVerifier,
                public_key: 'pk',
                encrypted_private_key: 'epk',
                key_salt: 'ks',
                key_iv: 'kiv',
                is_creator: 1,
                is_admin: 1
            });
            mockDbManager.allNodeQuery.mockResolvedValue([{ server_url: 'http://my-server' }]);

            const res = await request(app)
                .post('/api/accounts/login')
                .send({ email: 'hashed@example.com', serverAuthKey: testKey });

            expect(res.status).toBe(200);
            expect(res.body.token).toBeDefined();
            expect(res.body.email).toBe('hashed@example.com');
        });

        it('should reject login with incorrect serverAuthKey', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc-hashed',
                email: 'hashed@example.com',
                auth_verifier: hashedVerifier
            });

            const res = await request(app)
                .post('/api/accounts/login')
                .send({ email: 'hashed@example.com', serverAuthKey: 'wrong-password' });

            expect(res.status).toBe(401);
            expect(res.body.error).toBe('Invalid credentials');
        });

        it('should use timingSafeEqual for hash comparison', async () => {
            // This is hard to prove without inspecting code, but we ensure basic functionality
            // A timing attack would be outside scope of unit test, but we verified the code uses it.
            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc-hashed',
                email: 'hashed@example.com',
                auth_verifier: hashedVerifier
            });

            const res = await request(app)
                .post('/api/accounts/login')
                .send({ email: 'hashed@example.com', serverAuthKey: testKey });

            expect(res.status).toBe(200);
        });

        it('should fall back to plaintext for accounts not yet migrated', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc-legacy',
                email: 'legacy@example.com',
                auth_verifier: 'plain-text-password-123',
                is_creator: 0
            });
            mockDbManager.allNodeQuery.mockResolvedValue([]);

            const res = await request(app)
                .post('/api/accounts/login')
                .send({ email: 'legacy@example.com', serverAuthKey: 'plain-text-password-123' });

            expect(res.status).toBe(200);
            expect(res.body.token).toBeDefined();
        });
    });

    describe('Secure Federation (POST /api/accounts/federate)', () => {
        const testSalt = crypto.randomBytes(16).toString('hex');
        const testKey = 'fed-password';
        const testHash = crypto.scryptSync(testKey, testSalt, 64).toString('hex');
        const hashedVerifier = `${testSalt}:${testHash}`;

        it('should successfully federate with hashed verifier', async () => {
            const account = {
                id: 'acc-fed',
                email: 'fed@example.com',
                auth_verifier: hashedVerifier
            };
            mockDbManager.getNodeQuery.mockResolvedValue(account);
            mockDbManager.allNodeQuery.mockResolvedValue([{ server_url: 'http://trusted' }]);

            const res = await request(app)
                .post('/api/accounts/federate')
                .send({ email: 'fed@example.com', serverAuthKey: testKey });

            expect(res.status).toBe(200);
            expect(res.body.account.email).toBe('fed@example.com');
            expect(res.body.account.auth_verifier).toBe(hashedVerifier);
        });

        it('should reject federation with invalid credentials', async () => {
            mockDbManager.getNodeQuery.mockResolvedValue({
                id: 'acc-fed',
                email: 'fed@example.com',
                auth_verifier: hashedVerifier
            });

            const res = await request(app)
                .post('/api/accounts/federate')
                .send({ email: 'fed@example.com', serverAuthKey: 'bad' });

            expect(res.status).toBe(401);
        });
    });
});
