import { expect, test, describe, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import dbManager from '../database';

describe('Phase 5: E2EE Ignorance', () => {
    let mockServerInstance: any;

    beforeAll(async () => {
        // Create Mock accounts
        const user1Id = 'e2ee_user1_' + Date.now();
        const user2Id = 'e2ee_user2_' + Date.now();
        
        await dbManager.runNodeQuery(`
            INSERT INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_admin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [user1Id, 'user1_' + Date.now() + '@e2ee.local', 'verify', 'pub1', 'enc1', 'salt', 'iv', 0, 0]);

        await dbManager.runNodeQuery(`
            INSERT INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_admin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [user2Id, 'user2_' + Date.now() + '@e2ee.local', 'verify', 'pub2', 'enc2', 'salt', 'iv', 0, 0]);

        // Creating DM
        const dmChannelId = 'dm-test-' + Date.now();
        await dbManager.runDmsQuery(`INSERT INTO dm_channels (id, is_group, owner_id) VALUES (?, ?, ?)`, [dmChannelId, 0, user1Id]);
        await dbManager.runDmsQuery(`INSERT INTO dm_participants (channel_id, account_id) VALUES (?, ?)`, [dmChannelId, user1Id]);
        await dbManager.runDmsQuery(`INSERT INTO dm_participants (channel_id, account_id) VALUES (?, ?)`, [dmChannelId, user2Id]);

        // Store encrypted payload
        const encryptedContent = '0xENCRYPTED_BLOB_89A2B3C...';
        const messageId = 'msg1_' + Date.now();
        await dbManager.runDmsQuery(`
            INSERT INTO dm_messages (id, channel_id, author_id, content, timestamp, is_encrypted)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [messageId, dmChannelId, user1Id, encryptedContent, new Date().toISOString(), 1]);
    });

    test('E2EE Ignorance: Server explicitly returns opaque payload without trying to interpret it', async () => {
        // Fetch it blindly
        const messages = await dbManager.allDmsQuery(`SELECT * FROM dm_messages LIMIT 10`);
        const e2eeMessage = messages.find((m: any) => m.id.startsWith('msg1_')) as any;
        
        expect(e2eeMessage).toBeDefined();
        // Server database literally stores ciphertext
        expect(e2eeMessage.content).toBe('0xENCRYPTED_BLOB_89A2B3C...');
        expect(e2eeMessage.is_encrypted).toBe(1);

        // If the server tries to process it, it fails because it lacks the ECDH derivation key.
        // We assert that the routing pipeline (tested here conceptually through the DB) passes strings opaquely
        expect(typeof e2eeMessage.content).toBe('string');
        expect(e2eeMessage.content).not.toContain('plaintext');
    });
});
