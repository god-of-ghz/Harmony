import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import dbManager from '../database';
import { performAuditForServer } from '../jobs/auditJob';

describe('Phase 5: Audit Divergence Tampering Tests', () => {
    let testServerId = 'audit_server_' + Date.now();

    beforeAll(async () => {
        await dbManager.initializeServerBundle(testServerId, "Audit Test Server", "");

        // Insert category & channel for foreign keys
        await dbManager.runServerQuery(testServerId, `INSERT INTO channel_categories (id, server_id, name, position) VALUES ('cat1', ?, 'test', 0)`, [testServerId]);
        await dbManager.runServerQuery(testServerId, `INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES ('chan1', ?, 'cat1', 'general', 'text', 0)`, [testServerId]);

        // Insert messages
        await dbManager.runServerQuery(testServerId, `
            INSERT INTO messages (id, channel_id, author_id, content, timestamp, edited_at, is_pinned, attachments, signature)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, ['m1', 'chan1', 'user1', 'Hello there', new Date().toISOString(), null, 0, '[]', 'sig1']);

        await dbManager.runServerQuery(testServerId, `
            INSERT INTO messages (id, channel_id, author_id, content, timestamp, edited_at, is_pinned, attachments, signature)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, ['m2', 'chan1', 'user2', 'General Kenobi', new Date().toISOString(), null, 0, '[]', 'sig2']);
    });

    test('Audit cron job correctly fingerprints database', async () => {
        // Run audit
        await performAuditForServer(testServerId, 24);

        const logs = await dbManager.allServerQuery(testServerId, `SELECT * FROM integrity_audits ORDER BY id DESC LIMIT 1`);
        expect(logs.length).toBe(1);
        
        const hashBase = (logs[0] as any).hash;
        expect(hashBase).toBeDefined();

        // SIMULATE DATABASE COMPROMISE: Malicious edit bypassing App constraints
        await dbManager.runServerQuery(testServerId, `UPDATE messages SET content = 'I shot first' WHERE id = 'm1'`);

        // Run audit again
        await performAuditForServer(testServerId, 24);

        const newLogs = await dbManager.allServerQuery(testServerId, `SELECT * FROM integrity_audits ORDER BY id DESC LIMIT 2`);
        expect(newLogs.length).toBe(2);
        
        const newHash = (newLogs[0] as any).hash; // Top one is newest
        
        // Assert divergence! 
        expect(newHash).not.toBe(hashBase);
    });
});
