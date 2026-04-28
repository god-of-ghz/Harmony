/**
 * Guild Import System — Extract, Validate, Register, Member Relinking
 *
 * Imports a guild from an export ZIP bundle onto this Harmony Server.
 * This is the other half of guild portability:
 *   - P09 (guild_export.ts) creates the bundle
 *   - P10 (this file) imports it
 *
 * Import flow:
 *   1. Extract ZIP to temp directory (stream-based via unzipper)
 *   2. Validate manifest, checksums, schema
 *   3. Create guild directory and move files
 *   4. Register in guild registry (node.db)
 *   5. Update ownership
 *   6. Load guild instance
 *   7. Members rejoin manually; relinking restores their old roles/history
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import unzipper from 'unzipper';
import dbManager, { GUILDS_DIR } from './database';
import { loadGuildPublicIdentity } from './crypto/guild_identity';
import type { ExportManifest } from './guild_export';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ValidationResult {
    valid: boolean;
    manifest?: ExportManifest;
    errors: string[];
}

export interface ImportResult {
    guildId: string;
    name: string;
    fingerprint: string;
}

export interface RelinkResult {
    relinked: boolean;
    oldProfileId?: string;
}

// ---------------------------------------------------------------------------
// Helper: SHA-256 of a file (stream-based)
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

async function computeDirectorySha256(dirPath: string): Promise<string> {
    if (!fs.existsSync(dirPath)) return '';

    const hash = crypto.createHash('sha256');
    const files = getAllFiles(dirPath);
    files.sort(); // Deterministic ordering

    for (const file of files) {
        const fileHash = await computeFileSha256(file);
        hash.update(fileHash);
        hash.update(path.relative(dirPath, file));
    }

    return files.length > 0 ? hash.digest('hex') : '';
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
// Helper: Run a write query on a standalone SQLite database
// ---------------------------------------------------------------------------

function runStandaloneDb(dbPath: string, sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
            if (err) return reject(err);
            db.run(sql, params, (runErr) => {
                db.close();
                if (runErr) return reject(runErr);
                resolve();
            });
        });
    });
}

// ---------------------------------------------------------------------------
// Helper: Extract ZIP to directory using unzipper (stream-based)
// ---------------------------------------------------------------------------

async function extractZipToDir(zipPath: string, destDir: string): Promise<void> {
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    const directory = await unzipper.Open.file(zipPath);
    for (const file of directory.files) {
        const outputPath = path.join(destDir, file.path);
        if (file.type === 'Directory') {
            fs.mkdirSync(outputPath, { recursive: true });
        } else {
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            await new Promise<void>((resolve, reject) => {
                file.stream()
                    .pipe(fs.createWriteStream(outputPath))
                    .on('finish', resolve)
                    .on('error', reject);
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: Copy a directory recursively
// ---------------------------------------------------------------------------

function copyDirectorySync(src: string, dest: string): void {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        } else if (entry.isDirectory()) {
            copyDirectorySync(srcPath, destPath);
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: Clean up a temp directory (safe, non-throwing)
// ---------------------------------------------------------------------------

function cleanupTemp(tempDir: string): void {
    try {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    } catch (err) {
        console.warn(`[GuildImport] Failed to cleanup temp dir ${tempDir}:`, err);
    }
}

// ---------------------------------------------------------------------------
// validateExportBundle — Validate a guild export bundle without importing
// ---------------------------------------------------------------------------

/**
 * Validate a guild export bundle without importing it.
 * Checks manifest, checksums, schema compatibility.
 */
export async function validateExportBundle(zipPath: string): Promise<ValidationResult> {
    const errors: string[] = [];

    if (!fs.existsSync(zipPath)) {
        return { valid: false, errors: ['ZIP file not found'] };
    }

    const tempDir = path.join(os.tmpdir(), `harmony_import_validate_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);

    try {
        // 1. Extract ZIP
        await extractZipToDir(zipPath, tempDir);

        // 2. Parse and validate manifest
        const manifestPath = path.join(tempDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            errors.push('manifest.json not found in export bundle');
            return { valid: false, errors };
        }

        let manifest: ExportManifest;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        } catch {
            errors.push('manifest.json is not valid JSON');
            return { valid: false, errors };
        }

        // Check export version
        if (manifest.harmony_export_version !== 1) {
            errors.push(`Unsupported export version: ${manifest.harmony_export_version} (expected: 1)`);
        }

        // Check required fields
        const requiredFields: (keyof ExportManifest)[] = [
            'harmony_export_version', 'guild_id', 'guild_name',
            'exported_at', 'stats', 'files',
        ];
        for (const field of requiredFields) {
            if (manifest[field] === undefined || manifest[field] === null) {
                errors.push(`Missing required manifest field: ${field}`);
            }
        }

        if (errors.length > 0) {
            return { valid: false, manifest, errors };
        }

        // 3. Verify checksums
        const guildDbPath = path.join(tempDir, 'guild.db');
        if (!fs.existsSync(guildDbPath)) {
            errors.push('guild.db not found in export bundle');
            return { valid: false, manifest, errors };
        }

        const dbChecksum = await computeFileSha256(guildDbPath);
        if (manifest.files.guild_db_sha256 && dbChecksum !== manifest.files.guild_db_sha256) {
            errors.push('Export bundle is corrupted — checksum mismatch for guild.db');
        }

        const identityPath = path.join(tempDir, 'guild_identity.key');
        if (fs.existsSync(identityPath) && manifest.files.guild_identity_sha256) {
            const identityChecksum = await computeFileSha256(identityPath);
            if (identityChecksum !== manifest.files.guild_identity_sha256) {
                errors.push('Export bundle is corrupted — checksum mismatch for guild_identity.key');
            }
        }

        if (errors.length > 0) {
            return { valid: false, manifest, errors };
        }

        // 4. Validate guild.db schema — check core tables exist
        const coreTables = ['channels', 'messages', 'profiles', 'roles'];
        // guild_info is the new name, servers is legacy — either is acceptable
        try {
            const tables = await queryStandaloneDb<{ name: string }>(guildDbPath,
                "SELECT name FROM sqlite_master WHERE type='table'"
            );
            const tableNames = new Set(tables.map(t => t.name));

            const hasGuildInfo = tableNames.has('guild_info') || tableNames.has('servers');
            if (!hasGuildInfo) {
                errors.push('Schema validation failed: neither guild_info nor servers table found');
            }

            for (const table of coreTables) {
                if (!tableNames.has(table)) {
                    errors.push(`Schema validation failed: missing table "${table}"`);
                }
            }
        } catch (err: any) {
            errors.push(`Schema validation failed: ${err.message}`);
        }

        if (errors.length > 0) {
            return { valid: false, manifest, errors };
        }

        return { valid: true, manifest, errors: [] };

    } catch (err: any) {
        errors.push(`Validation failed: ${err.message}`);
        return { valid: false, errors };
    } finally {
        cleanupTemp(tempDir);
    }
}

// ---------------------------------------------------------------------------
// importGuild — Main import function
// ---------------------------------------------------------------------------

/**
 * Import a guild from an export ZIP bundle.
 * @param zipPath - Path to the guild export ZIP file
 * @param ownerAccountId - Account ID of the person importing (becomes the guild owner)
 * @param ownerPublicKey - The owner's Ed25519 public key (base64 DER string)
 * @returns The imported guild's registry entry
 */
export async function importGuild(
    zipPath: string,
    ownerAccountId: string,
    ownerPublicKey: string
): Promise<ImportResult> {
    const tempDir = path.join(os.tmpdir(), `harmony_import_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);

    try {
        // 1. Extract ZIP
        await extractZipToDir(zipPath, tempDir);

        // 2. Validate manifest and checksums
        const manifestPath = path.join(tempDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error('manifest.json not found in export bundle');
        }

        const manifest: ExportManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        if (manifest.harmony_export_version !== 1) {
            throw new Error(`Unsupported export version: ${manifest.harmony_export_version}`);
        }

        const guildId = manifest.guild_id;
        if (!guildId) {
            throw new Error('Missing guild_id in manifest');
        }

        // 3. Verify checksums
        const tempDbPath = path.join(tempDir, 'guild.db');
        if (!fs.existsSync(tempDbPath)) {
            throw new Error('guild.db not found in export bundle');
        }

        const dbChecksum = await computeFileSha256(tempDbPath);
        if (manifest.files.guild_db_sha256 && dbChecksum !== manifest.files.guild_db_sha256) {
            throw new Error('Export bundle is corrupted — checksum mismatch for guild.db');
        }

        const tempIdentityPath = path.join(tempDir, 'guild_identity.key');
        if (fs.existsSync(tempIdentityPath) && manifest.files.guild_identity_sha256) {
            const identityChecksum = await computeFileSha256(tempIdentityPath);
            if (identityChecksum !== manifest.files.guild_identity_sha256) {
                throw new Error('Export bundle is corrupted — checksum mismatch for guild_identity.key');
            }
        }

        // 4. Check for conflicts
        const guildDir = path.join(GUILDS_DIR, guildId);
        if (fs.existsSync(guildDir)) {
            throw new Error('A guild with this ID already exists on this node');
        }

        const existingRegistry = await dbManager.getGuildRegistryEntry(guildId);
        if (existingRegistry) {
            throw new Error('Guild already registered');
        }

        // 5. Validate guild.db schema
        const coreTables = ['channels', 'messages', 'profiles', 'roles'];
        try {
            const tables = await queryStandaloneDb<{ name: string }>(tempDbPath,
                "SELECT name FROM sqlite_master WHERE type='table'"
            );
            const tableNames = new Set(tables.map(t => t.name));

            const hasGuildInfo = tableNames.has('guild_info') || tableNames.has('servers');
            if (!hasGuildInfo) {
                throw new Error('Schema validation failed: neither guild_info nor servers table found');
            }

            for (const table of coreTables) {
                if (!tableNames.has(table)) {
                    throw new Error(`Schema validation failed: missing table "${table}"`);
                }
            }
        } catch (err: any) {
            if (err.message.startsWith('Schema validation failed')) throw err;
            throw new Error(`Schema validation failed: ${err.message}`);
        }

        // 6. Create guild directory and move files
        fs.mkdirSync(guildDir, { recursive: true });

        const destDbPath = path.join(guildDir, 'guild.db');
        fs.copyFileSync(tempDbPath, destDbPath);

        if (fs.existsSync(tempIdentityPath)) {
            const destIdentityPath = path.join(guildDir, 'guild_identity.key');
            fs.copyFileSync(tempIdentityPath, destIdentityPath);
        }

        const tempUploadsDir = path.join(tempDir, 'uploads');
        const destUploadsDir = path.join(guildDir, 'uploads');
        if (fs.existsSync(tempUploadsDir)) {
            copyDirectorySync(tempUploadsDir, destUploadsDir);
        } else {
            fs.mkdirSync(destUploadsDir, { recursive: true });
        }

        // Copy guild_meta.json if present
        const tempMetaPath = path.join(tempDir, 'guild_meta.json');
        if (fs.existsSync(tempMetaPath)) {
            fs.copyFileSync(tempMetaPath, path.join(guildDir, 'guild_meta.json'));
        }

        // 7. Read guild name and fingerprint
        let guildName = manifest.guild_name || 'Imported Guild';

        // Try guild_meta.json first
        if (fs.existsSync(tempMetaPath)) {
            try {
                const meta = JSON.parse(fs.readFileSync(tempMetaPath, 'utf-8'));
                if (meta.name) guildName = meta.name;
            } catch { /* fall through to manifest name */ }
        }

        // Load fingerprint from guild_identity.key
        let fingerprint = manifest.guild_fingerprint || '';
        try {
            const identity = loadGuildPublicIdentity(guildDir);
            if (identity) {
                fingerprint = identity.fingerprint;
            }
        } catch {
            // Non-fatal — guild identity is optional
        }

        // 8. Register in guild registry (node.db)
        await dbManager.registerGuild(guildId, guildName, ownerAccountId, fingerprint);

        // 9. Update ownership in guild DB
        // We need to modify the guild DB before loading it into the manager,
        // because loadGuildInstance would run initGuildDb migrations.
        // Use standalone DB queries on the file directly.
        try {
            // Find original owner profile
            const originalOwner = await queryStandaloneDbGet<{ id: string; account_id: string }>(
                destDbPath,
                "SELECT id, account_id FROM profiles WHERE role = 'OWNER' LIMIT 1"
            );

            if (originalOwner && originalOwner.account_id !== ownerAccountId) {
                // Demote original owner to ADMIN
                await runStandaloneDb(destDbPath,
                    "UPDATE profiles SET role = 'ADMIN' WHERE role = 'OWNER'"
                );

                // Check if importing user already has a profile
                const existingProfile = await queryStandaloneDbGet<{ id: string }>(
                    destDbPath,
                    "SELECT id FROM profiles WHERE account_id = ?",
                    [ownerAccountId]
                );

                if (existingProfile) {
                    // Update existing profile to OWNER
                    await runStandaloneDb(destDbPath,
                        "UPDATE profiles SET role = 'OWNER' WHERE account_id = ?",
                        [ownerAccountId]
                    );
                } else {
                    // Create new owner profile
                    const newProfileId = 'profile-' + crypto.randomUUID();
                    // Get email for username
                    const ownerAccount = await dbManager.getNodeQuery<{ email: string }>(
                        'SELECT email FROM accounts WHERE id = ?',
                        [ownerAccountId]
                    );
                    const username = ownerAccount?.email?.split('@')[0] || 'Owner';

                    // Write the new profile using a writable DB connection
                    await new Promise<void>((resolve, reject) => {
                        const writeDb = new sqlite3.Database(destDbPath, (err) => {
                            if (err) return reject(err);
                            writeDb.run(
                                `INSERT INTO profiles (id, server_id, account_id, original_username, nickname, role, membership_status)
                                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [newProfileId, guildId, ownerAccountId, username, username, 'OWNER', 'active'],
                                (runErr) => {
                                    writeDb.close();
                                    if (runErr) return reject(runErr);
                                    resolve();
                                }
                            );
                        });
                    });
                }
            }
        } catch (err: any) {
            console.warn(`[GuildImport] Non-fatal: Failed to update ownership in guild DB: ${err.message}`);
        }

        // 10. Load guild instance
        dbManager.loadGuildInstance(guildId, destDbPath);

        // Wait for DB initialization to settle
        await new Promise(resolve => setTimeout(resolve, 200));

        console.log(`[GuildImport] Guild imported: "${guildName}" (${guildId})`);
        console.log(`[GuildImport]   Fingerprint: ${fingerprint}`);

        return { guildId, name: guildName, fingerprint };

    } finally {
        cleanupTemp(tempDir);
    }
}

// ---------------------------------------------------------------------------
// relinkMemberProfile — Restore old roles/history when a migrated member rejoins
// ---------------------------------------------------------------------------

/**
 * After a user creates a profile on an imported guild, check if they had
 * a previous profile (from before the migration) and relink them.
 * This restores their old roles, nickname, and message attribution.
 *
 * This function is idempotent — safe to call multiple times.
 */
export async function relinkMemberProfile(
    guildId: string,
    accountId: string,
    newProfileId: string
): Promise<RelinkResult> {
    if (!accountId || !newProfileId) {
        return { relinked: false };
    }

    try {
        // Find an old profile with the same account_id that is NOT the new profile
        // and has not already been migrated
        const oldProfiles = await dbManager.allGuildQuery<{
            id: string;
            role: string;
            nickname: string | null;
            membership_status: string | null;
        }>(
            guildId,
            `SELECT id, role, nickname, membership_status FROM profiles
             WHERE account_id = ? AND server_id = ? AND id != ?
             AND (membership_status IS NULL OR membership_status != 'migrated')`,
            [accountId, guildId, newProfileId]
        );

        if (oldProfiles.length === 0) {
            return { relinked: false };
        }

        // Use the first matching old profile (there should typically be only one)
        const oldProfile = oldProfiles[0];

        // Transfer role and nickname from old profile to new profile
        // Only transfer if old role is higher than USER (preserve ADMIN/MOD status)
        const roleHierarchy: Record<string, number> = {
            'OWNER': 4, 'ADMIN': 3, 'MOD': 2, 'USER': 1
        };
        const oldRoleLevel = roleHierarchy[oldProfile.role] || 1;
        const updateFields: string[] = [];
        const updateParams: any[] = [];

        if (oldRoleLevel > 1) {
            updateFields.push('role = ?');
            updateParams.push(oldProfile.role);
        }

        if (oldProfile.nickname) {
            updateFields.push('nickname = ?');
            updateParams.push(oldProfile.nickname);
        }

        if (updateFields.length > 0) {
            updateParams.push(newProfileId, guildId);
            await dbManager.runGuildQuery(guildId,
                `UPDATE profiles SET ${updateFields.join(', ')} WHERE id = ? AND server_id = ?`,
                updateParams
            );
        }

        // Transfer profile_roles entries
        try {
            const oldRoles = await dbManager.allGuildQuery<{ role_id: string }>(
                guildId,
                'SELECT role_id FROM profile_roles WHERE profile_id = ? AND server_id = ?',
                [oldProfile.id, guildId]
            );

            for (const pr of oldRoles) {
                // Insert or ignore (in case the new profile already has the role)
                await dbManager.runGuildQuery(guildId,
                    'INSERT OR IGNORE INTO profile_roles (profile_id, server_id, role_id) VALUES (?, ?, ?)',
                    [newProfileId, guildId, pr.role_id]
                );
            }
        } catch {
            // Non-fatal — profile_roles table might not exist in legacy DBs
        }

        // Update messages: change author_id from old profile to new profile
        try {
            await dbManager.runGuildQuery(guildId,
                'UPDATE messages SET author_id = ? WHERE author_id = ?',
                [newProfileId, oldProfile.id]
            );
        } catch {
            // Non-fatal
        }

        // Mark old profile as migrated
        await dbManager.runGuildQuery(guildId,
            "UPDATE profiles SET membership_status = 'migrated' WHERE id = ? AND server_id = ?",
            [oldProfile.id, guildId]
        );

        console.log(`[GuildImport] Relinked member ${accountId}: old profile ${oldProfile.id} → new profile ${newProfileId}`);

        return { relinked: true, oldProfileId: oldProfile.id };

    } catch (err: any) {
        console.error(`[GuildImport] Error relinking member ${accountId} in guild ${guildId}:`, err);
        return { relinked: false };
    }
}
