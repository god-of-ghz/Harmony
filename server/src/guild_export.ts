/**
 * Guild Export System — ZIP Bundle + Manifest
 *
 * Exports a guild as a portable ZIP bundle containing:
 *   - manifest.json      — Export metadata and checksums
 *   - guild.db           — Complete SQLite database
 *   - guild_identity.key — Guild Ed25519 keypair (encrypted at rest)
 *   - guild_meta.json    — Human-readable guild metadata
 *   - uploads/           — All uploaded files
 *
 * This is a core feature of Harmony: guilds are portable and can be
 * moved between Harmony Servers. The owner exports from Server A,
 * imports to Server B, and members rejoin via new invite links.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import archiver from 'archiver';
import sqlite3 from 'sqlite3';
import dbManager, { GUILDS_DIR, GuildRegistryEntry } from './database';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ExportManifest {
    harmony_export_version: number;
    guild_id: string;
    guild_name: string;
    guild_fingerprint: string;
    exported_at: number;
    exported_by_account_id: string;
    source_server_url: string;
    harmony_server_version: string;
    stats: ExportStats;
    files: {
        guild_db_sha256: string;
        guild_identity_sha256: string;
        uploads_sha256: string;
    };
}

export interface ExportStats {
    member_count: number;
    channel_count: number;
    message_count: number;
    upload_count: number;
    upload_total_bytes: number;
}

export interface ExportProgress {
    guildId: string;
    status: 'preparing' | 'copying_db' | 'copying_uploads' | 'creating_zip' | 'complete' | 'error';
    percent: number;
    currentFile?: string;
    error?: string;
}

export interface GuildMeta {
    id: string;
    name: string;
    icon: string;
    description: string;
    owner_account_id: string;
    created_at: number;
}

// ---------------------------------------------------------------------------
// In-memory progress tracking
// ---------------------------------------------------------------------------

const exportProgress = new Map<string, ExportProgress>();

export function getExportProgress(guildId: string): ExportProgress | undefined {
    return exportProgress.get(guildId);
}

export function setExportProgress(guildId: string, progress: ExportProgress): void {
    exportProgress.set(guildId, progress);
}

export function clearExportProgress(guildId: string): void {
    exportProgress.delete(guildId);
}

// ---------------------------------------------------------------------------
// Helper: SHA-256 of a file
// ---------------------------------------------------------------------------

function computeFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

// ---------------------------------------------------------------------------
// Helper: SHA-256 of all files in a directory (combined hash)
// ---------------------------------------------------------------------------

async function computeDirectorySha256(dirPath: string): Promise<string> {
    if (!fs.existsSync(dirPath)) return '';

    const hash = crypto.createHash('sha256');
    const files = getAllFiles(dirPath);
    files.sort(); // Deterministic ordering

    for (const file of files) {
        const fileHash = await computeFileSha256(file);
        hash.update(fileHash);
        hash.update(path.relative(dirPath, file)); // Include relative path in hash
    }

    return files.length > 0 ? hash.digest('hex') : '';
}

// ---------------------------------------------------------------------------
// Helper: Recursively collect all files in a directory
// ---------------------------------------------------------------------------

function getAllFiles(dirPath: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dirPath)) return files;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isFile()) {
            files.push(fullPath);
        } else if (entry.isDirectory()) {
            files.push(...getAllFiles(fullPath));
        }
    }
    return files;
}

// ---------------------------------------------------------------------------
// Helper: Get directory size and file count
// ---------------------------------------------------------------------------

function getDirectoryStats(dirPath: string): { count: number; totalBytes: number } {
    if (!fs.existsSync(dirPath)) return { count: 0, totalBytes: 0 };

    let count = 0;
    let totalBytes = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isFile()) {
            count++;
            totalBytes += fs.statSync(fullPath).size;
        } else if (entry.isDirectory()) {
            const sub = getDirectoryStats(fullPath);
            count += sub.count;
            totalBytes += sub.totalBytes;
        }
    }
    return { count, totalBytes };
}

// ---------------------------------------------------------------------------
// Helper: Copy file using streams (memory-efficient for large files)
// ---------------------------------------------------------------------------

function copyFileStream(src: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

        const readStream = fs.createReadStream(src);
        const writeStream = fs.createWriteStream(dest);
        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('close', resolve);
        readStream.pipe(writeStream);
    });
}

// ---------------------------------------------------------------------------
// Helper: Copy a directory recursively using streams
// ---------------------------------------------------------------------------

async function copyDirectoryStream(src: string, dest: string, onFile?: (filePath: string) => void): Promise<void> {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isFile()) {
            onFile?.(srcPath);
            await copyFileStream(srcPath, destPath);
        } else if (entry.isDirectory()) {
            await copyDirectoryStream(srcPath, destPath, onFile);
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: Query a standalone SQLite database (not managed by DatabaseManager)
// ---------------------------------------------------------------------------

function queryStandaloneDb<T>(dbPath: string, sql: string, params: any[] = []): Promise<T[]> {
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

function queryStandaloneDbGet<T>(dbPath: string, sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) return reject(err);
            db.get(sql, params, (qErr, row) => {
                db.close();
                if (qErr) return reject(qErr);
                resolve(row as T | undefined);
            });
        });
    });
}

// ---------------------------------------------------------------------------
// WAL Checkpoint
// ---------------------------------------------------------------------------

function walCheckpoint(guildId: string): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            const guildDb = dbManager.getGuildDb(guildId);
            guildDb.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
                if (err) {
                    console.warn(`[GuildExport] WAL checkpoint warning for ${guildId}:`, err.message);
                    // Non-fatal — continue with export
                }
                resolve();
            });
        } catch (err) {
            // Guild DB might not be loaded — non-fatal for export
            console.warn(`[GuildExport] Could not checkpoint WAL for ${guildId}:`, err);
            resolve();
        }
    });
}

// ---------------------------------------------------------------------------
// Read package.json version
// ---------------------------------------------------------------------------

function getHarmonyVersion(): string {
    try {
        const pkgPath = path.resolve(__dirname, '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}

// ---------------------------------------------------------------------------
// getExportStats — Collect export statistics without performing the export
// ---------------------------------------------------------------------------

export async function getExportStats(guildId: string): Promise<ExportStats> {
    // Validate guild exists
    const registry = await dbManager.getGuildRegistryEntry(guildId);
    if (!registry) {
        throw new Error(`Guild not found: ${guildId}`);
    }

    // Query the live guild DB for counts
    let memberCount = 0;
    let channelCount = 0;
    let messageCount = 0;

    try {
        const mc = await dbManager.getGuildQuery<{ count: number }>(guildId, 'SELECT COUNT(*) as count FROM profiles');
        memberCount = mc?.count || 0;
    } catch { /* ignore */ }

    try {
        const cc = await dbManager.getGuildQuery<{ count: number }>(guildId, 'SELECT COUNT(*) as count FROM channels');
        channelCount = cc?.count || 0;
    } catch { /* ignore */ }

    try {
        const msgc = await dbManager.getGuildQuery<{ count: number }>(guildId, 'SELECT COUNT(*) as count FROM messages');
        messageCount = msgc?.count || 0;
    } catch { /* ignore */ }

    // Count upload files
    const uploadsDir = path.join(GUILDS_DIR, guildId, 'uploads');
    const uploadStats = getDirectoryStats(uploadsDir);

    return {
        member_count: memberCount,
        channel_count: channelCount,
        message_count: messageCount,
        upload_count: uploadStats.count,
        upload_total_bytes: uploadStats.totalBytes,
    };
}

// ---------------------------------------------------------------------------
// exportGuild — Main export function
// ---------------------------------------------------------------------------

export async function exportGuild(
    guildId: string,
    outputPath: string,
    sourceServerUrl: string
): Promise<{ zipPath: string; manifest: ExportManifest }> {
    const timestamp = Date.now();
    const tempDirName = `harmony_export_${guildId}_${timestamp}`;
    const tempDir = path.join(os.tmpdir(), tempDirName);

    try {
        // 1. Validate guild exists and is not suspended
        setExportProgress(guildId, { guildId, status: 'preparing', percent: 0 });

        const registry = await dbManager.getGuildRegistryEntry(guildId);
        if (!registry) {
            throw new Error(`Guild not found: ${guildId}`);
        }
        if (registry.status === 'suspended') {
            throw new Error(`Cannot export suspended guild: ${guildId}`);
        }

        // 2. Create temp directory
        fs.mkdirSync(tempDir, { recursive: true });

        const guildDir = path.join(GUILDS_DIR, guildId);
        const guildDbPath = path.join(guildDir, 'guild.db');
        const identityPath = path.join(guildDir, 'guild_identity.key');
        const uploadsDir = path.join(guildDir, 'uploads');

        if (!fs.existsSync(guildDbPath)) {
            throw new Error(`Guild database not found: ${guildDbPath}`);
        }

        // 3. Checkpoint the WAL
        setExportProgress(guildId, { guildId, status: 'copying_db', percent: 10 });
        await walCheckpoint(guildId);

        // 4. Copy guild.db (exclude WAL and SHM files)
        const tempDbPath = path.join(tempDir, 'guild.db');
        await copyFileStream(guildDbPath, tempDbPath);
        setExportProgress(guildId, { guildId, status: 'copying_db', percent: 25 });

        // 5. Copy guild_identity.key (if it exists — it's already encrypted at rest)
        const tempIdentityPath = path.join(tempDir, 'guild_identity.key');
        let hasIdentity = false;
        if (fs.existsSync(identityPath)) {
            await copyFileStream(identityPath, tempIdentityPath);
            hasIdentity = true;
        }

        // 6. Copy uploads/ recursively
        setExportProgress(guildId, { guildId, status: 'copying_uploads', percent: 30 });
        const tempUploadsDir = path.join(tempDir, 'uploads');
        await copyDirectoryStream(uploadsDir, tempUploadsDir, (filePath) => {
            setExportProgress(guildId, {
                guildId,
                status: 'copying_uploads',
                percent: 40,
                currentFile: path.basename(filePath),
            });
        });

        // 7. Generate guild_meta.json
        setExportProgress(guildId, { guildId, status: 'copying_uploads', percent: 50 });

        let guildMeta: GuildMeta;
        try {
            const guildInfo = await queryStandaloneDbGet<any>(tempDbPath,
                'SELECT * FROM guild_info LIMIT 1'
            );
            guildMeta = {
                id: guildId,
                name: guildInfo?.name || registry.name,
                icon: guildInfo?.icon || registry.icon || '',
                description: guildInfo?.description || registry.description || '',
                owner_account_id: registry.owner_account_id,
                created_at: registry.created_at,
            };
        } catch {
            guildMeta = {
                id: guildId,
                name: registry.name,
                icon: registry.icon || '',
                description: registry.description || '',
                owner_account_id: registry.owner_account_id,
                created_at: registry.created_at,
            };
        }

        const tempMetaPath = path.join(tempDir, 'guild_meta.json');
        fs.writeFileSync(tempMetaPath, JSON.stringify(guildMeta, null, 2));

        // 8. Compute checksums
        setExportProgress(guildId, { guildId, status: 'creating_zip', percent: 55 });

        const dbChecksum = await computeFileSha256(tempDbPath);
        const identityChecksum = hasIdentity ? await computeFileSha256(tempIdentityPath) : '';
        const uploadsChecksum = await computeDirectorySha256(tempUploadsDir);

        // 9. Count stats by querying the copied guild.db
        let stats: ExportStats;
        try {
            const memberRow = await queryStandaloneDbGet<{ count: number }>(tempDbPath,
                'SELECT COUNT(*) as count FROM profiles'
            );
            const channelRow = await queryStandaloneDbGet<{ count: number }>(tempDbPath,
                'SELECT COUNT(*) as count FROM channels'
            );
            const messageRow = await queryStandaloneDbGet<{ count: number }>(tempDbPath,
                'SELECT COUNT(*) as count FROM messages'
            );

            const uploadStats = getDirectoryStats(tempUploadsDir);

            stats = {
                member_count: memberRow?.count || 0,
                channel_count: channelRow?.count || 0,
                message_count: messageRow?.count || 0,
                upload_count: uploadStats.count,
                upload_total_bytes: uploadStats.totalBytes,
            };
        } catch (err) {
            console.warn('[GuildExport] Failed to query stats from copied DB:', err);
            stats = {
                member_count: 0,
                channel_count: 0,
                message_count: 0,
                upload_count: 0,
                upload_total_bytes: 0,
            };
        }

        // 10. Generate manifest.json
        const manifest: ExportManifest = {
            harmony_export_version: 1,
            guild_id: guildId,
            guild_name: guildMeta.name,
            guild_fingerprint: registry.fingerprint || '',
            exported_at: Math.floor(timestamp / 1000),
            exported_by_account_id: registry.owner_account_id,
            source_server_url: sourceServerUrl,
            harmony_server_version: getHarmonyVersion(),
            stats,
            files: {
                guild_db_sha256: dbChecksum,
                guild_identity_sha256: identityChecksum,
                uploads_sha256: uploadsChecksum,
            },
        };

        const tempManifestPath = path.join(tempDir, 'manifest.json');
        fs.writeFileSync(tempManifestPath, JSON.stringify(manifest, null, 2));

        // 11. Create ZIP
        setExportProgress(guildId, { guildId, status: 'creating_zip', percent: 70 });

        const zipPath = outputPath;
        const zipDir = path.dirname(zipPath);
        if (!fs.existsSync(zipDir)) fs.mkdirSync(zipDir, { recursive: true });

        await createZipFromDirectory(tempDir, zipPath, (entryName) => {
            setExportProgress(guildId, {
                guildId,
                status: 'creating_zip',
                percent: 80,
                currentFile: entryName,
            });
        });

        // 12. Complete
        setExportProgress(guildId, { guildId, status: 'complete', percent: 100 });

        return { zipPath, manifest };

    } catch (err: any) {
        setExportProgress(guildId, {
            guildId,
            status: 'error',
            percent: 0,
            error: err.message,
        });
        throw err;

    } finally {
        // 13. Cleanup temp directory
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (cleanupErr) {
            console.warn(`[GuildExport] Failed to cleanup temp dir ${tempDir}:`, cleanupErr);
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: Create ZIP from a directory using archiver
// ---------------------------------------------------------------------------

function createZipFromDirectory(
    sourceDir: string,
    outputPath: string,
    onEntry?: (entryName: string) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', {
            zlib: { level: 6 }, // Moderate compression — balance speed vs size
        });

        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));
        archive.on('entry', (entry) => {
            onEntry?.(entry.name);
        });

        archive.pipe(output);

        // Add all files from the temp directory
        const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(sourceDir, entry.name);
            if (entry.isFile()) {
                archive.file(fullPath, { name: entry.name });
            } else if (entry.isDirectory()) {
                archive.directory(fullPath, entry.name);
            }
        }

        archive.finalize();
    });
}
