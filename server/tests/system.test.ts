import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

const TEST_DATA_DIR = path.resolve(process.cwd(), 'system_test_data');

describe('Harmony Server System Tests', () => {
    let app: any;
    let dbManager: any;

    beforeAll(async () => {
        // Prepare clean test environment
        if (fs.existsSync(TEST_DATA_DIR)) {
            // Close existing connections if any (unlikely in this context but safe)
            fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
        
        // Set environment variable BEFORE importing database/app
        process.env.HARMONY_DATA_DIR = TEST_DATA_DIR;

        // Dynamic import to ensure the singleton respects our new DATA_DIR
        const dbModule = await import('../src/database');
        dbManager = dbModule.default;
        
        const { createApp } = await import('../src/app');
        app = createApp(dbManager, () => {});
        
        // Brief delay to allow SQLite migrations and async init to settle
        await new Promise(resolve => setTimeout(resolve, 800));
    });

    afterAll(async () => {
        // Shutdown sequence
        if (dbManager) {
            if (dbManager.nodeDb) dbManager.nodeDb.close();
            if (dbManager.dmsDb) dbManager.dmsDb.close();
            // Unload any server instances
            const servers = await dbManager.getAllLoadedServers();
            for (const s of servers) {
                dbManager.unloadServerInstance(s.id);
            }
        }
        
        // Give OS time to release file locks
        await new Promise(resolve => setTimeout(resolve, 300));
        
        try {
            // fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
        } catch (e) {
            console.warn("Could not clean up test data directory:", e);
        }
    });

    it('GET /api/health should return ok', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });

    let testKeyPair: { publicKey: Buffer, privateKey: Buffer };
    let testToken: string;
    let userAId: string;

    it('POST /api/accounts/signup should create a real account', async () => {
        const { generateKeyPairSync } = await import('crypto');
        const { publicKey, privateKey } = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'der' },
            privateKeyEncoding: { type: 'pkcs8', format: 'der' }
        });
        testKeyPair = { publicKey, privateKey };

        const payload = {
            email: 'test@system.local',
            serverAuthKey: 'password123',
            public_key: publicKey.toString('base64'),
            encrypted_private_key: 'MOCK_ENC_PRIV',
            key_salt: 'salt',
            key_iv: 'iv'
        };
        const res = await request(app).post('/api/accounts/signup').send(payload);
        expect(res.status).toBe(200);
        expect(res.body.email).toBe('test@system.local');
        expect(res.body.token).toBeDefined();
        testToken = res.body.token;
        userAId = res.body.id;

        // Elevate user so they can create servers
        await dbManager.runNodeQuery('UPDATE accounts SET is_creator = 1, is_admin = 1 WHERE email = ?', ['test@system.local']);

        const user = await dbManager.getNodeQuery('SELECT * FROM accounts WHERE email = ?', ['test@system.local']);
        expect(user).toBeDefined();
        expect(user.public_key).toBe(publicKey.toString('base64'));
    });

    it('POST /api/accounts/login should authenticate the user and return a token', async () => {
        const res = await request(app).post('/api/accounts/login').send({
            email: 'test@system.local',
            serverAuthKey: 'password123'
        });
        if (res.status !== 200) console.log('Login failed: ', res.body);
        expect(res.status).toBe(200);
        expect(res.body.email).toBe('test@system.local');
        expect(res.body.token).toBeDefined();
        testToken = res.body.token; // Refresh token
    });

    let createdServerId: string;
    it('POST /api/servers should create a bundled server with default channels', async () => {
        const res = await request(app)
            .post('/api/servers')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ name: 'System Test Guild' });

        if (res.status !== 200) {
            console.error("Server creation failed:", res.status, res.body);
        }

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('System Test Guild');
        createdServerId = res.body.id;
        expect(createdServerId).toContain('server-');

        // Verify filesystem
        const serverPath = path.join(TEST_DATA_DIR, 'servers', createdServerId);
        expect(fs.existsSync(serverPath)).toBe(true);
        expect(fs.existsSync(path.join(serverPath, 'server.db'))).toBe(true);
    });

    it('GET /api/servers/:id/channels should list seeded channels', async () => {
        const res = await request(app)
            .get(`/api/servers/${createdServerId}/channels`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0].name).toBe('general');
    });

    it('POST /api/channels/:id/messages should persist a message', async () => {
        const channels = await request(app)
            .get(`/api/servers/${createdServerId}/channels`)
            .set('Authorization', `Bearer ${testToken}`);
        const channelId = channels.body[0].id;

        const profiles = await request(app)
            .get(`/api/servers/${createdServerId}/profiles`)
            .set('Authorization', `Bearer ${testToken}`);
        
        // The creator gets a profile automatically in the seed logic
        const myProfile = profiles.body.find((p: any) => p.account_id === userAId);
        expect(myProfile).toBeDefined();

        const content = 'System test message';
        const { createPrivateKey, sign } = await import('crypto');
        const signature = sign('SHA256', Buffer.from(content), {
            key: createPrivateKey({ key: testKeyPair.privateKey, format: 'der', type: 'pkcs8' }),
            dsaEncoding: 'ieee-p1363'
        }).toString('base64');

        const msgRes = await request(app)
            .post(`/api/channels/${channelId}/messages`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                content,
                authorId: myProfile.id,
                signature
            });
        
        if (msgRes.status !== 200) {
            console.error("Message post failed:", msgRes.status, msgRes.body);
        }

        expect(msgRes.status).toBe(200);
        expect(msgRes.body.content).toBe(content);

        // Verify in DB
        const messages = await request(app)
            .get(`/api/channels/${channelId}/messages`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(messages.body.some((m: any) => m.content === content)).toBe(true);
    });

    it('TASK 1.1: Multi-User Profile Isolation - Verify User A cannot see User B\'s private data', async () => {
        // 1. Create User B
        const userBPayload = {
            email: 'user_b@system.local',
            serverAuthKey: 'password456',
            public_key: 'USER_B_PUB_KEY',
            encrypted_private_key: 'USER_B_ENC_PRIV',
            key_salt: 'salt_b',
            key_iv: 'iv_b'
        };
        const signupB = await request(app).post('/api/accounts/signup').send(userBPayload);
        expect(signupB.status).toBe(200);
        const userBId = signupB.body.id;
        const userBToken = signupB.body.token;

        // 2. User B joins User A's server (created in previous tests)
        const joinRes = await request(app)
            .post(`/api/servers/${createdServerId}/profiles`)
            .set('Authorization', `Bearer ${userBToken}`)
            .send({
                accountId: userBId,
                nickname: 'User B Nickname',
                isGuest: false
            });
        expect(joinRes.status).toBe(200);

        // 3. User A (the requester) tries to look at User B's profiles
        const profilesRes = await request(app)
            .get(`/api/accounts/${userBId}/profiles`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(profilesRes.status).toBe(200);
        expect(profilesRes.body.length).toBeGreaterThan(0);
        
        const bProfile = profilesRes.body.find((p: any) => p.nickname === 'User B Nickname');
        expect(bProfile).toBeDefined();

        // 4. VERIFY NO LEAKAGE
        // Sensitive account fields should NOT be in the profile response
        expect(bProfile.email).toBeUndefined();
        expect(bProfile.auth_verifier).toBeUndefined();
        expect(bProfile.encrypted_private_key).toBeUndefined();
        expect(bProfile.key_salt).toBeUndefined();
        expect(bProfile.key_iv).toBeUndefined();

        // 5. Try the global profile endpoint
        const globalProfileRes = await request(app)
            .get(`/api/accounts/${userBId}/profile`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(globalProfileRes.status).toBe(200);
        expect(globalProfileRes.body.account_id).toBe(userBId);
        expect(globalProfileRes.body.email).toBeUndefined();
    });

    it('TASK 1.2: Channel CRUD Integration - Lifecycle of a channel via API', async () => {
        // 1. Create a channel
        const res1 = await request(app)
            .post(`/api/servers/${createdServerId}/channels`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ name: 'integrated-test-channel', type: 'text' });
            
        expect(res1.status).toBe(200);
        const channelId = res1.body.id;
        expect(res1.body.name).toBe('integrated-test-channel');

        // 2. Verify it exists in SQLite directly
        const dbChannel = await dbManager.getServerQuery(createdServerId, 'SELECT * FROM channels WHERE id = ?', [channelId]);
        expect(dbChannel).toBeDefined();
        expect(dbChannel.name).toBe('integrated-test-channel');

        // 3. Rename the channel (PATCH)
        const renameRes = await request(app)
            .patch(`/api/channels/${channelId}?serverId=${createdServerId}`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ name: 'renamed-channel' });
        
        expect(renameRes.status).toBe(200);
        expect(renameRes.body.name).toBe('renamed-channel');

        // 4. Verify rename in SQLite directly
        const dbChannelRenamed = await dbManager.getServerQuery(createdServerId, 'SELECT * FROM channels WHERE id = ?', [channelId]);
        expect(dbChannelRenamed.name).toBe('renamed-channel');

        // 5. Delete the channel
        const delRes = await request(app)
            .delete(`/api/channels/${channelId}?serverId=${createdServerId}`)
            .set('Authorization', `Bearer ${testToken}`);
            
        expect(delRes.status).toBe(200);

        // 6. Verify gone from SQLite directly
        const dbChannelGone = await dbManager.getServerQuery(createdServerId, 'SELECT * FROM channels WHERE id = ?', [channelId]);
        expect(dbChannelGone).toBeUndefined();
    });

    it('TASK 1.3: Role & Permission Bitfields - Verify granular enforcement', async () => {
        // 1. Create a restricted user (User C)
        const userCPayload = {
            email: 'user_c@system.local',
            serverAuthKey: 'password789',
            public_key: 'USER_C_PUB_KEY',
            encrypted_private_key: 'USER_C_ENC_PRIV',
            key_salt: 'salt_c',
            key_iv: 'iv_c'
        };
        const signupC = await request(app).post('/api/accounts/signup').send(userCPayload);
        expect(signupC.status).toBe(200);
        const userCId = signupC.body.id;
        const userCToken = signupC.body.token;

        // 2. User C joins User A's server (created earlier)
        const joinRes = await request(app)
            .post(`/api/servers/${createdServerId}/profiles`)
            .set('Authorization', `Bearer ${userCToken}`)
            .send({
                accountId: userCId,
                nickname: 'User C Negotiator',
                isGuest: false
            });
        expect(joinRes.status).toBe(200);
        const profileCId = joinRes.body.id;

        // 3. User A (Creator) creates a sacrificial channel
        const chanRes = await request(app)
            .post(`/api/servers/${createdServerId}/channels`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ name: 'Role Test Channel' });
        expect(chanRes.status).toBe(200);
        const channelId = chanRes.body.id;

        // 4. User C attempts to delete the channel without permission -> 403
        const deleteRes403 = await request(app)
            .delete(`/api/channels/${channelId}?serverId=${createdServerId}`)
            .set('Authorization', `Bearer ${userCToken}`);
        
        expect(deleteRes403.status).toBe(403);
        expect(deleteRes403.body.error).toContain('Forbidden');

        // 5. User A creates a "Moderator" role with MANAGE_CHANNELS (Permission bit 8)
        const roleRes = await request(app)
            .post(`/api/servers/${createdServerId}/roles`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                name: 'Moderator',
                permissions: 8, // Permission.MANAGE_CHANNELS from rbac.ts
                color: '#ff0000',
                position: 1
            });
        expect(roleRes.status).toBe(200);
        const roleId = roleRes.body.id;

        // 6. User A assigns the role to User C
        const assignRes = await request(app)
            .post(`/api/servers/${createdServerId}/profiles/${profileCId}/roles`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ roleId });
        expect(assignRes.status).toBe(200);

        // 7. User C attempts to delete the channel AGAIN with permission -> 200 SUCCESS
        const deleteRes200 = await request(app)
            .delete(`/api/channels/${channelId}?serverId=${createdServerId}`)
            .set('Authorization', `Bearer ${userCToken}`);
        
        if (deleteRes200.status !== 200) {
            console.error("TASK 1.3 DELETE FAILED with 500:", deleteRes200.body);
        }
        expect(deleteRes200.status).toBe(200);
        expect(deleteRes200.body.success).toBe(true);
        expect(deleteRes200.body.message).toBe('Channel deleted');

        // 8. Verify the channel is really gone
        const verifyRes = await request(app)
            .get(`/api/servers/${createdServerId}/channels`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(verifyRes.body.some((c: any) => c.id === channelId)).toBe(false);
    });

    it('TASK 1.4: Multipart File Upload - Verify server saves and serves files', async () => {
        // 1. Prepare a small valid PNG file buffer
        const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE]);

        // 2. Upload the file
        const res = await request(app)
            .post(`/api/servers/${createdServerId}/attachments`)
            .set('Authorization', `Bearer ${testToken}`)
            .attach('files', pngBuffer, 'test_system.png');

        expect(res.status).toBe(200);
        expect(res.body.urls).toHaveLength(1);
        const fileUrl = res.body.urls[0];
        expect(fileUrl).toContain(`/uploads/${createdServerId}/`);

        // 3. Verify file exists on disk
        const filename = path.basename(fileUrl);
        const filePath = path.join(TEST_DATA_DIR, 'servers', createdServerId, 'uploads', filename);
        expect(fs.existsSync(filePath), `File should exist at ${filePath}`).toBe(true);

        // 4. Verify file is served by static middleware
        const serveRes = await request(app).get(fileUrl);
        expect(serveRes.status).toBe(200);
        expect(serveRes.type).toBe('image/png');
        expect(serveRes.body.length).toBe(pngBuffer.length);
    });

    it('TASK 1.5: Multi-DB Integrity - Server deletion lifecycle', async () => {
        // 1. Create a server
        const res = await request(app)
            .post('/api/servers')
            .set('Authorization', `Bearer ${testToken}`)
            .send({ name: 'Deletable Server' });
        
        expect(res.status).toBe(200);
        const serverId = res.body.id;
        const serverPath = path.join(TEST_DATA_DIR, 'servers', serverId);
        const dbPath = path.join(serverPath, 'server.db');
        
        expect(fs.existsSync(dbPath)).toBe(true);

        // 2. Add a channel to ensure it's "in use" (DB is definitely loaded)
        const chanRes = await request(app)
            .post(`/api/servers/${serverId}/channels`)
            .set('Authorization', `Bearer ${testToken}`)
            .send({ name: 'temp-channel' });
        expect(chanRes.status).toBe(200);

        // 3. Delete server via API
        const delRes = await request(app)
            .delete(`/api/servers/${serverId}`)
            .set('Authorization', `Bearer ${testToken}`);
        
        if (delRes.status !== 200) {
            console.error("Server deletion failed:", delRes.status, delRes.body);
        }
        
        expect(delRes.status).toBe(200);
        expect(delRes.body.success).toBe(true);

        // 4. Verify the server.db file is closed and directory is safe to remove
        await new Promise(resolve => setTimeout(resolve, 500));
        
        expect(() => {
            fs.rmSync(serverPath, { recursive: true, force: true });
        }, "Should be able to remove directory after server deletion").not.toThrow();
        
        expect(fs.existsSync(serverPath)).toBe(false);
    });

    it('TASK 1.6: Federation Edge Cases - Login handles remote failure gracefully', async () => {
        const originalFetch = global.fetch;
        global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

        const res = await request(app).post('/api/accounts/login').send({
            email: 'remote_fail@federated.com',
            serverAuthKey: 'any',
            initialServerUrl: 'https://broken-node.com'
        });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid credentials');

        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Remote crash' })
        } as any);

        const res2 = await request(app).post('/api/accounts/login').send({
            email: 'remote_500@federated.com',
            serverAuthKey: 'any',
            initialServerUrl: 'https://crashing-node.com'
        });

        expect(res2.status).toBe(401);
        global.fetch = originalFetch;
    });

    it('TASK 1.7: Identity Stitching - Message list includes public_key from Node DB', async () => {
        const channels = await request(app)
            .get(`/api/servers/${createdServerId}/channels`)
            .set('Authorization', `Bearer ${testToken}`);
        const channelId = channels.body[0].id;

        const res = await request(app)
            .get(`/api/channels/${channelId}/messages`)
            .set('Authorization', `Bearer ${testToken}`);
        expect(res.status).toBe(200);
        expect(res.body.length).toBeGreaterThan(0);
        
        const msg = res.body.find((m: any) => m.content === 'System test message');
        expect(msg).toBeDefined();
        expect(msg.public_key).toBeDefined();
        expect(typeof msg.public_key).toBe('string');
        expect(msg.public_key.length).toBeGreaterThan(50);

        const login = await request(app).post('/api/accounts/login').send({
            email: 'test@system.local',
            serverAuthKey: 'password123'
        });
        expect(msg.public_key).toBe(login.body.public_key);
    });
});
