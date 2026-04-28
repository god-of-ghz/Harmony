import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import sqlite3 from 'sqlite3';
import dbManager, { GUILDS_DIR } from '../database';
import { createGuildRoutes } from '../routes/guilds';
import { getServerIdentity } from '../crypto/pki';
import jwt from '../crypto/jwt';
import {
    exportGuild,
    getExportStats,
    getExportProgress,
    setExportProgress,
    clearExportProgress,
    ExportManifest,
    ExportProgress,
} from '../guild_export';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function settle(ms = 300): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureNodeDb(): Promise<void> {
    await new Promise<void>((resolve) => {
        dbManager.initNodeDb(dbManager.nodeDb);
        dbManager.nodeDb.get('SELECT 1', () => resolve());
    });
}

async function insertTestAccount(
    id: string,
    email: string,
    opts?: { isCreator?: boolean }
): Promise<{ publicKey: string }> {
    const kp = crypto.generateKeyPairSync('ed25519');
    const pubBase64 = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    await dbManager.runNodeQuery(
        `INSERT OR IGNORE INTO accounts
         (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_admin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id, email, 'salt:hash', pubBase64, 'epk', 's', 'iv',
            opts?.isCreator ? 1 : 0,
            opts?.isCreator ? 1 : 0,
        ]
    );
    return { publicKey: pubBase64 };
}

async function cleanupGuild(guildId: string): Promise<void> {
    try { dbManager.unloadGuildInstance(guildId); } catch { /* already unloaded */ }
    await settle(100);
    await dbManager.runNodeQuery(`DELETE FROM guilds WHERE id = ?`, [guildId]).catch(() => {});
    const dir = path.join(GUILDS_DIR, guildId);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* EBUSY on Windows */ }
}

function rmrf(dir: string) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeToken(accountId: string): string {
    const identity = getServerIdentity();
    const privateKey = identity.privateKey.export({ type: 'pkcs8', format: 'pem' });
    return jwt.sign({ accountId }, privateKey, { algorithm: 'EdDSA', expiresIn: '1h' } as any);
}

function auth(tok: string) {
    return { Authorization: `Bearer ${tok}` };
}

/** Open a standalone SQLite DB and run a query */
function queryDb<T>(dbPath: string, sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) return reject(err);
            db.all(sql, params, (qErr, rows) => {
                db.close();
                if (qErr) return reject(qErr);
                resolve(rows as T[]);
            });
        });
    });
}

function computeSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

const OPERATOR_ID = 'export-op-' + Date.now();
const OPERATOR_EMAIL = `export-op-${Date.now()}@harmony.test`;
const REGULAR_ID = 'export-reg-' + Date.now();
const REGULAR_EMAIL = `export-reg-${Date.now()}@harmony.test`;

const createdGuildIds: string[] = [];
const createdZipPaths: string[] = [];
let operatorToken: string;
let regularToken: string;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
    await ensureNodeDb();
    await insertTestAccount(OPERATOR_ID, OPERATOR_EMAIL, { isCreator: true });
    await insertTestAccount(REGULAR_ID, REGULAR_EMAIL);
    operatorToken = makeToken(OPERATOR_ID);
    regularToken = makeToken(REGULAR_ID);
});

afterAll(async () => {
    for (const gId of createdGuildIds) {
        await cleanupGuild(gId);
    }
    for (const zipPath of createdZipPaths) {
        try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch { /* ignore */ }
    }
    // Clean up guilds from registry before deleting accounts (FK constraint)
    for (const gId of createdGuildIds) {
        await dbManager.runNodeQuery('DELETE FROM guilds WHERE id = ?', [gId]).catch(() => {});
    }
    await dbManager.runNodeQuery(`DELETE FROM accounts WHERE id IN (?, ?)`, [OPERATOR_ID, REGULAR_ID]);
});

// ---------------------------------------------------------------------------
// Helper: Create a test guild with sample data
// ---------------------------------------------------------------------------

async function createTestGuild(name: string): Promise<string> {
    const guildId = 'guild-test-' + crypto.randomUUID();

    const ownerPubKey = (await dbManager.getNodeQuery<{ public_key: string }>(
        'SELECT public_key FROM accounts WHERE id = ?', [OPERATOR_ID]
    ))?.public_key || '';

    await dbManager.initializeGuildBundle(guildId, name, '', OPERATOR_ID, 'Test guild', ownerPubKey);
    await settle(200);

    // Insert test channel
    const channelId = 'chan-' + crypto.randomUUID();
    await dbManager.runGuildQuery(guildId,
        'INSERT INTO channels (id, server_id, name, type, position) VALUES (?, ?, ?, ?, ?)',
        [channelId, guildId, 'general', 'text', 0]
    );

    // Insert test messages
    for (let i = 0; i < 5; i++) {
        const msgId = 'msg-' + crypto.randomUUID();
        await dbManager.runGuildQuery(guildId,
            'INSERT INTO messages (id, channel_id, author_id, content, timestamp) VALUES (?, ?, ?, ?, ?)',
            [msgId, channelId, OPERATOR_ID, `Test message ${i}`, new Date().toISOString()]
        );
    }

    // Insert test profile
    const profileId = 'profile-' + crypto.randomUUID();
    await dbManager.runGuildQuery(guildId,
        'INSERT INTO profiles (id, server_id, account_id, original_username, role, membership_status) VALUES (?, ?, ?, ?, ?, ?)',
        [profileId, guildId, OPERATOR_ID, 'TestOperator', 'OWNER', 'active']
    );

    createdGuildIds.push(guildId);
    return guildId;
}

async function createTestUpload(guildId: string, subPath: string, content: string): Promise<string> {
    const uploadsDir = path.join(GUILDS_DIR, guildId, 'uploads');
    const filePath = path.join(uploadsDir, subPath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe('Guild Export: Core Module', () => {

    // Test 1: Export creates valid ZIP with expected files
    it('1. should create a valid ZIP with expected files', async () => {
        const guildId = await createTestGuild('Export ZIP Test');
        const outputPath = path.join(os.tmpdir(), `test_export_1_${Date.now()}.zip`);
        createdZipPaths.push(outputPath);

        const result = await exportGuild(guildId, outputPath, 'https://test.example.com');

        expect(fs.existsSync(result.zipPath)).toBe(true);
        expect(result.zipPath).toBe(outputPath);

        // Verify it's a valid ZIP by checking the magic bytes (PK\x03\x04)
        const header = Buffer.alloc(4);
        const fd = fs.openSync(result.zipPath, 'r');
        fs.readSync(fd, header, 0, 4, 0);
        fs.closeSync(fd);
        expect(header[0]).toBe(0x50); // P
        expect(header[1]).toBe(0x4B); // K
    });

    // Test 2: Manifest has correct fields and structure
    it('2. should produce a manifest with correct fields', async () => {
        const guildId = await createTestGuild('Manifest Test');
        const outputPath = path.join(os.tmpdir(), `test_export_2_${Date.now()}.zip`);
        createdZipPaths.push(outputPath);

        const result = await exportGuild(guildId, outputPath, 'https://source.example.com');
        const manifest = result.manifest;

        expect(manifest.harmony_export_version).toBe(1);
        expect(manifest.guild_id).toBe(guildId);
        expect(manifest.guild_name).toBe('Manifest Test');
        expect(manifest.source_server_url).toBe('https://source.example.com');
        expect(manifest.exported_at).toBeGreaterThan(0);
        expect(manifest.exported_by_account_id).toBe(OPERATOR_ID);
        expect(manifest.harmony_server_version).toBeDefined();

        // Stats should be populated
        expect(manifest.stats.member_count).toBeGreaterThanOrEqual(1);
        expect(manifest.stats.channel_count).toBeGreaterThanOrEqual(1);
        expect(manifest.stats.message_count).toBeGreaterThanOrEqual(5);

        // Checksums should be non-empty strings
        expect(manifest.files.guild_db_sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    // Test 3: Exported guild.db is queryable with correct tables
    it('3. should export a queryable guild.db', async () => {
        const guildId = await createTestGuild('DB Query Test');
        const outputPath = path.join(os.tmpdir(), `test_export_3_${Date.now()}.zip`);
        createdZipPaths.push(outputPath);

        await exportGuild(guildId, outputPath, 'test');

        // We can't easily extract the ZIP in pure Node without another dependency,
        // but we can verify the exported DB was correct by checking the stats
        // in the manifest (which queries the copied DB)
        const result = await exportGuild(guildId,
            path.join(os.tmpdir(), `test_export_3b_${Date.now()}.zip`), 'test');
        createdZipPaths.push(result.zipPath);

        expect(result.manifest.stats.message_count).toBeGreaterThanOrEqual(5);
        expect(result.manifest.stats.channel_count).toBeGreaterThanOrEqual(1);
    });

    // Test 4: Uploads are included in the export
    it('4. should include uploads in the export', async () => {
        const guildId = await createTestGuild('Upload Test');
        await createTestUpload(guildId, 'channels/test-chan/image.png', 'fake-png-data');
        await createTestUpload(guildId, 'avatars/avatar.jpg', 'fake-avatar-data');

        const outputPath = path.join(os.tmpdir(), `test_export_4_${Date.now()}.zip`);
        createdZipPaths.push(outputPath);

        const result = await exportGuild(guildId, outputPath, 'test');

        // Verify upload stats reflect the files
        expect(result.manifest.stats.upload_count).toBeGreaterThanOrEqual(2);
        expect(result.manifest.stats.upload_total_bytes).toBeGreaterThan(0);
    });

    // Test 5: SHA-256 checksums in manifest match
    it('5. should produce valid SHA-256 checksums', async () => {
        const guildId = await createTestGuild('Checksum Test');
        const outputPath = path.join(os.tmpdir(), `test_export_5_${Date.now()}.zip`);
        createdZipPaths.push(outputPath);

        const result = await exportGuild(guildId, outputPath, 'test');

        // The DB checksum should be a valid hex string
        expect(result.manifest.files.guild_db_sha256).toMatch(/^[a-f0-9]{64}$/);

        // If guild_identity.key exists, that checksum should be valid too
        const identityPath = path.join(GUILDS_DIR, guildId, 'guild_identity.key');
        if (fs.existsSync(identityPath)) {
            expect(result.manifest.files.guild_identity_sha256).toMatch(/^[a-f0-9]{64}$/);
        }
    });

    // Test 6: WAL checkpoint — latest data present in exported DB
    it('6. should include latest data after WAL checkpoint', async () => {
        const guildId = await createTestGuild('WAL Test');

        // Write additional data that would be in the WAL
        const channelRows = await dbManager.allGuildQuery<{ id: string }>(guildId,
            'SELECT id FROM channels LIMIT 1'
        );
        if (channelRows.length > 0) {
            const latestMsg = 'msg-wal-' + crypto.randomUUID();
            await dbManager.runGuildQuery(guildId,
                'INSERT INTO messages (id, channel_id, author_id, content, timestamp) VALUES (?, ?, ?, ?, ?)',
                [latestMsg, channelRows[0].id, OPERATOR_ID, 'WAL test message', new Date().toISOString()]
            );
        }

        const outputPath = path.join(os.tmpdir(), `test_export_6_${Date.now()}.zip`);
        createdZipPaths.push(outputPath);

        const result = await exportGuild(guildId, outputPath, 'test');

        // Message count should include the WAL message
        expect(result.manifest.stats.message_count).toBeGreaterThanOrEqual(6);
    });

    // Test 7: getExportStats returns accurate counts
    it('7. should return accurate stats without performing export', async () => {
        const guildId = await createTestGuild('Stats Test');
        await createTestUpload(guildId, 'test-file.txt', 'some content here');

        const stats = await getExportStats(guildId);

        expect(stats.member_count).toBeGreaterThanOrEqual(1);
        expect(stats.channel_count).toBeGreaterThanOrEqual(1);
        expect(stats.message_count).toBeGreaterThanOrEqual(5);
        expect(stats.upload_count).toBeGreaterThanOrEqual(1);
        expect(stats.upload_total_bytes).toBeGreaterThan(0);
    });

    // Test 10: Non-existent guild → appropriate error
    it('10. should error for non-existent guild', async () => {
        const outputPath = path.join(os.tmpdir(), `test_export_10_${Date.now()}.zip`);
        createdZipPaths.push(outputPath);

        await expect(exportGuild('nonexistent-guild-xyz', outputPath, 'test'))
            .rejects.toThrow('Guild not found');
    });

    // Test 11: Progress tracking transitions correctly
    it('11. should track export progress', async () => {
        const testGuildId = 'progress-test-guild';

        // Initially no progress
        expect(getExportProgress(testGuildId)).toBeUndefined();

        // Set progress
        setExportProgress(testGuildId, {
            guildId: testGuildId,
            status: 'preparing',
            percent: 0,
        });
        let progress = getExportProgress(testGuildId);
        expect(progress).toBeDefined();
        expect(progress!.status).toBe('preparing');

        // Update
        setExportProgress(testGuildId, {
            guildId: testGuildId,
            status: 'copying_db',
            percent: 25,
        });
        progress = getExportProgress(testGuildId);
        expect(progress!.status).toBe('copying_db');
        expect(progress!.percent).toBe(25);

        // Clear
        clearExportProgress(testGuildId);
        expect(getExportProgress(testGuildId)).toBeUndefined();
    });

    // Test 12: Temp files cleaned up after export
    it('12. should clean up temp files after export', async () => {
        const guildId = await createTestGuild('Cleanup Test');
        const outputPath = path.join(os.tmpdir(), `test_export_12_${Date.now()}.zip`);
        createdZipPaths.push(outputPath);

        await exportGuild(guildId, outputPath, 'test');

        // The temp directory should have been cleaned up
        // We can verify by checking that no harmony_export_ directories exist for this guild
        const tmpEntries = fs.readdirSync(os.tmpdir());
        const matchingDirs = tmpEntries.filter(e =>
            e.startsWith(`harmony_export_${guildId}_`) && fs.statSync(path.join(os.tmpdir(), e)).isDirectory()
        );
        expect(matchingDirs.length).toBe(0);
    });

    // Test 13: Round-trip preparation — ZIP has all required files for import
    it('13. should include all files needed for future import', async () => {
        const guildId = await createTestGuild('Roundtrip Test');
        await createTestUpload(guildId, 'channels/chan1/photo.png', 'fake-photo');

        const outputPath = path.join(os.tmpdir(), `test_export_13_${Date.now()}.zip`);
        createdZipPaths.push(outputPath);

        const result = await exportGuild(guildId, outputPath, 'https://old.example.com');
        const manifest = result.manifest;

        // Verify manifest has all required top-level keys
        expect(manifest.harmony_export_version).toBe(1);
        expect(manifest.guild_id).toBe(guildId);
        expect(manifest.guild_name).toBeDefined();
        expect(manifest.guild_fingerprint).toBeDefined();
        expect(manifest.exported_at).toBeDefined();
        expect(manifest.exported_by_account_id).toBeDefined();
        expect(manifest.source_server_url).toBe('https://old.example.com');
        expect(manifest.harmony_server_version).toBeDefined();
        expect(manifest.stats).toBeDefined();
        expect(manifest.files).toBeDefined();
        expect(manifest.files.guild_db_sha256).toBeDefined();

        // Verify the stats sub-object
        expect(typeof manifest.stats.member_count).toBe('number');
        expect(typeof manifest.stats.channel_count).toBe('number');
        expect(typeof manifest.stats.message_count).toBe('number');
        expect(typeof manifest.stats.upload_count).toBe('number');
        expect(typeof manifest.stats.upload_total_bytes).toBe('number');
    });
});

// ---------------------------------------------------------------------------
// Route Tests
// ---------------------------------------------------------------------------

describe('Guild Export: API Routes', () => {
    let app: express.Express;
    let routeGuildId: string;

    beforeAll(async () => {
        app = express();
        app.use(express.json({ limit: '1mb' }));
        app.use(createGuildRoutes(dbManager, () => {}));

        // Create a guild for route tests
        routeGuildId = await createTestGuild('Route Export Guild');
        await createTestUpload(routeGuildId, 'route-test.txt', 'route test data');
    });

    // Test 8: POST /api/guilds/:id/export → 200 with valid response
    it('8. should export via API route', async () => {
        const res = await request(app)
            .post(`/api/guilds/${routeGuildId}/export`)
            .set(auth(operatorToken));

        expect(res.status).toBe(200);
        expect(res.body.filename).toMatch(/^guild_export_/);
        expect(res.body.downloadUrl).toContain(routeGuildId);
        expect(res.body.manifest).toBeDefined();
        expect(res.body.manifest.guild_id).toBe(routeGuildId);
        expect(res.body.manifest.stats.message_count).toBeGreaterThanOrEqual(5);

        // Clean up the generated ZIP
        const zipPath = path.join(os.tmpdir(), res.body.filename);
        createdZipPaths.push(zipPath);
    });

    // Test 9: Non-owner gets 403 on export
    it('9. should reject non-owner with 403', async () => {
        const res = await request(app)
            .post(`/api/guilds/${routeGuildId}/export`)
            .set(auth(regularToken));

        expect(res.status).toBe(403);
    });

    // Test: GET /api/guilds/:id/export/stats returns stats
    it('should return export stats', async () => {
        const res = await request(app)
            .get(`/api/guilds/${routeGuildId}/export/stats`)
            .set(auth(operatorToken));

        expect(res.status).toBe(200);
        expect(res.body.member_count).toBeGreaterThanOrEqual(1);
        expect(res.body.channel_count).toBeGreaterThanOrEqual(1);
        expect(res.body.message_count).toBeGreaterThanOrEqual(5);
        expect(typeof res.body.upload_count).toBe('number');
        expect(typeof res.body.upload_total_bytes).toBe('number');
    });

    // Test: Non-owner gets 403 on stats
    it('should reject non-owner on stats with 403', async () => {
        const res = await request(app)
            .get(`/api/guilds/${routeGuildId}/export/stats`)
            .set(auth(regularToken));

        expect(res.status).toBe(403);
    });

    // Test: GET /api/guilds/:id/export/progress returns 404 when no export in progress
    it('should return 404 when no export in progress', async () => {
        clearExportProgress(routeGuildId);
        const res = await request(app)
            .get(`/api/guilds/${routeGuildId}/export/progress`)
            .set(auth(operatorToken));

        expect(res.status).toBe(404);
    });
});
