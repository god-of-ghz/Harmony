import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dbManager, { GUILDS_DIR } from '../database';
import type { GuildRegistryEntry, ProvisionCodeEntry } from '../database';
import {
    handleCreateGuild,
    handleListGuilds,
    handleStopGuild,
    handleStartGuild,
    handleDeleteGuild,
    handleGuildStatus,
} from '../cli/guild';
import {
    handleGenerateProvisionCode,
    handleListProvisionCodes,
    handleRevokeProvisionCode,
    handleToggleOpenCreation,
} from '../cli/provision';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Wait for async DB init chains to settle. */
function settle(ms = 300): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Ensure the nodeDb tables exist (idempotent). */
async function ensureNodeDb(): Promise<void> {
    await new Promise<void>((resolve) => {
        dbManager.initNodeDb(dbManager.nodeDb);
        dbManager.nodeDb.get('SELECT 1', () => resolve());
    });
}

/** Insert a test account with a real Ed25519 keypair. */
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

/** Clean up a guild from disk + registry + memory. */
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

/** Capture console.log output during an async function. */
async function captureStdout(fn: () => Promise<void>): Promise<string> {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => {
        logs.push(args.map(a => String(a)).join(' '));
    };
    try {
        await fn();
    } finally {
        console.log = origLog;
    }
    return logs.join('\n');
}

/** Capture console.error output during an async function. */
async function captureStderr(fn: () => Promise<void>): Promise<string> {
    const logs: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => {
        logs.push(args.map(a => String(a)).join(' '));
    };
    try {
        await fn();
    } finally {
        console.error = origErr;
    }
    return logs.join('\n');
}

/** Extract guild ID from create output. */
function extractGuildId(output: string): string {
    const match = output.match(/\(guild-([a-f0-9-]+)\)/);
    if (!match) throw new Error('Could not extract guild ID from output: ' + output);
    return 'guild-' + match[1];
}

// ---------------------------------------------------------------------------
// 1. Guild CLI Commands
// ---------------------------------------------------------------------------

describe('CLI: Guild Lifecycle', () => {
    const testGuildIds: string[] = [];
    const OPERATOR_ID = 'cli-op-' + Date.now();
    const OPERATOR_EMAIL = `cli-op-${Date.now()}@harmony.test`;
    const USER_ID = 'cli-user-' + Date.now();
    const USER_EMAIL = `cli-user-${Date.now()}@harmony.test`;

    beforeEach(async () => {
        await ensureNodeDb();
        await insertTestAccount(OPERATOR_ID, OPERATOR_EMAIL, { isCreator: true });
        await insertTestAccount(USER_ID, USER_EMAIL);
    });

    afterEach(async () => {
        for (const id of testGuildIds) {
            await cleanupGuild(id);
        }
        testGuildIds.length = 0;
        await dbManager.runNodeQuery(`DELETE FROM accounts WHERE id IN (?, ?)`, [OPERATOR_ID, USER_ID]);
        process.exitCode = undefined;
    });

    // -- Test 1: Create guild (default owner) --
    it('should create a guild with default operator owner', async () => {
        const output = await captureStdout(async () => {
            await handleCreateGuild({ name: 'Test CLI Guild' });
        });

        expect(output).toContain('✓ Guild created: "Test CLI Guild"');
        expect(output).toContain('Fingerprint:');

        const guildId = extractGuildId(output);
        testGuildIds.push(guildId);

        // Verify registry entry
        const entry = await dbManager.getGuildRegistryEntry(guildId);
        expect(entry).toBeDefined();
        expect(entry!.name).toBe('Test CLI Guild');
        expect(entry!.status).toBe('active');

        // Verify guild DB exists on disk
        const guildDir = path.join(GUILDS_DIR, guildId);
        expect(fs.existsSync(guildDir)).toBe(true);
        expect(fs.existsSync(path.join(guildDir, 'guild.db'))).toBe(true);
    });

    // -- Test 2: Create guild with specific owner --
    it('should create a guild with specified owner email', async () => {
        const output = await captureStdout(async () => {
            await handleCreateGuild({ name: 'User Guild', ownerEmail: USER_EMAIL });
        });

        expect(output).toContain('✓ Guild created: "User Guild"');
        expect(output).toContain(USER_EMAIL);

        const guildId = extractGuildId(output);
        testGuildIds.push(guildId);

        const entry = await dbManager.getGuildRegistryEntry(guildId);
        expect(entry!.owner_account_id).toBe(USER_ID);
    });

    // -- Test 3: Create guild with bad owner --
    it('should error when owner email does not exist', async () => {
        const output = await captureStderr(async () => {
            await handleCreateGuild({ name: 'Bad Owner', ownerEmail: 'nonexistent@nope.com' });
        });

        expect(output).toContain('No account found with email: nonexistent@nope.com');
        expect(process.exitCode).toBe(1);
    });

    // -- Test 4: List guilds --
    it('should list created guilds', async () => {
        // Create two guilds with explicit owner so we know the email
        const out1 = await captureStdout(() =>
            handleCreateGuild({ name: 'Alpha Guild', ownerEmail: OPERATOR_EMAIL })
        );
        testGuildIds.push(extractGuildId(out1));

        const out2 = await captureStdout(() =>
            handleCreateGuild({ name: 'Beta Guild', ownerEmail: OPERATOR_EMAIL })
        );
        testGuildIds.push(extractGuildId(out2));

        const listOutput = await captureStdout(() => handleListGuilds());

        expect(listOutput).toContain('Alpha Guild');
        expect(listOutput).toContain('Beta Guild');
    });

    // -- Test 5: Stop guild --
    it('should stop a guild and update its status', async () => {
        const createOutput = await captureStdout(() =>
            handleCreateGuild({ name: 'Stoppable Guild' })
        );
        const guildId = extractGuildId(createOutput);
        testGuildIds.push(guildId);

        const stopOutput = await captureStdout(() => handleStopGuild(guildId));
        expect(stopOutput).toContain('stopped');

        const entry = await dbManager.getGuildRegistryEntry(guildId);
        expect(entry!.status).toBe('stopped');
    });

    // -- Test 6: Start guild --
    it('should start a stopped guild', async () => {
        const createOutput = await captureStdout(() =>
            handleCreateGuild({ name: 'Startable Guild' })
        );
        const guildId = extractGuildId(createOutput);
        testGuildIds.push(guildId);

        // Stop first
        await captureStdout(() => handleStopGuild(guildId));
        let entry = await dbManager.getGuildRegistryEntry(guildId);
        expect(entry!.status).toBe('stopped');

        // Start
        const startOutput = await captureStdout(() => handleStartGuild(guildId));
        expect(startOutput).toContain('started');

        entry = await dbManager.getGuildRegistryEntry(guildId);
        expect(entry!.status).toBe('active');
    });

    // -- Test 7: Delete guild --
    it('should delete a guild and remove its data', async () => {
        const createOutput = await captureStdout(() =>
            handleCreateGuild({ name: 'Deletable Guild' })
        );
        const guildId = extractGuildId(createOutput);
        testGuildIds.push(guildId);

        const guildDir = path.join(GUILDS_DIR, guildId);
        expect(fs.existsSync(guildDir)).toBe(true);

        // Use confirmFn instead of mocking readline
        const confirmFn = async () => 'Deletable Guild';

        const deleteOutput = await captureStdout(() =>
            handleDeleteGuild(guildId, false, confirmFn)
        );

        expect(deleteOutput).toContain('Guild deleted');

        // Registry entry should be gone
        const entry = await dbManager.getGuildRegistryEntry(guildId);
        expect(entry).toBeUndefined();

        // Data directory should be gone
        expect(fs.existsSync(guildDir)).toBe(false);
    });

    // -- Test 8: Delete guild with preserve-data --
    it('should delete a guild but preserve data directory', async () => {
        const createOutput = await captureStdout(() =>
            handleCreateGuild({ name: 'Preserved Guild' })
        );
        const guildId = extractGuildId(createOutput);
        testGuildIds.push(guildId);

        const guildDir = path.join(GUILDS_DIR, guildId);
        expect(fs.existsSync(guildDir)).toBe(true);

        const confirmFn = async () => 'Preserved Guild';

        await captureStdout(() => handleDeleteGuild(guildId, true, confirmFn));

        // Registry entry should be gone
        const entry = await dbManager.getGuildRegistryEntry(guildId);
        expect(entry).toBeUndefined();

        // Data directory should STILL exist
        expect(fs.existsSync(guildDir)).toBe(true);

        // Manual cleanup
        rmrf(guildDir);
    });

    // -- Test 13: Guild status --
    it('should show correct status counts', async () => {
        const out1 = await captureStdout(() =>
            handleCreateGuild({ name: 'Status Guild A' })
        );
        const guildA = extractGuildId(out1);
        testGuildIds.push(guildA);

        const out2 = await captureStdout(() =>
            handleCreateGuild({ name: 'Status Guild B' })
        );
        const guildB = extractGuildId(out2);
        testGuildIds.push(guildB);

        // Stop guild B
        await captureStdout(() => handleStopGuild(guildB));

        const statusOutput = await captureStdout(() => handleGuildStatus());

        expect(statusOutput).toContain('Harmony Node Status');
        expect(statusOutput).toContain('Status Guild A');
        expect(statusOutput).toContain('Status Guild B');
        expect(statusOutput).toContain('active');
        expect(statusOutput).toContain('stopped');
    });
});

// ---------------------------------------------------------------------------
// 2. Provision Code CLI Commands
// ---------------------------------------------------------------------------

describe('CLI: Provision Codes', () => {
    const PROV_OPERATOR_ID = 'prov-op-' + Date.now();
    const PROV_OPERATOR_EMAIL = `prov-op-${Date.now()}@harmony.test`;
    const createdCodes: string[] = [];

    /** Extract the provision code hex string from CLI output. */
    function extractCode(output: string): string {
        // Output format: "✓ Provision code generated: <32-char hex>"
        const match = output.match(/generated:\s*([a-f0-9]{32})/);
        if (!match) throw new Error('Could not extract provision code from output: ' + output);
        return match[1];
    }

    beforeEach(async () => {
        await ensureNodeDb();
        await insertTestAccount(PROV_OPERATOR_ID, PROV_OPERATOR_EMAIL, { isCreator: true });
    });

    afterEach(async () => {
        // Clean up any codes we tracked
        for (const code of createdCodes) {
            await dbManager.revokeProvisionCode(code).catch(() => {});
        }
        createdCodes.length = 0;
        await dbManager.runNodeQuery(`DELETE FROM accounts WHERE id = ?`, [PROV_OPERATOR_ID]);
        process.exitCode = undefined;
    });

    // -- Test 9: Generate provision code --
    it('should generate a provision code', async () => {
        const output = await captureStdout(() => handleGenerateProvisionCode({}));

        expect(output).toContain('✓ Provision code generated:');
        expect(output).toContain('Expires: Never');
        expect(output).toContain('Max members: Unlimited');

        // Extract the code from output and verify it exists in DB
        const code = extractCode(output);
        createdCodes.push(code);

        const result = await dbManager.validateProvisionCode(code);
        expect(result.valid).toBe(true);
    });

    // -- Test 10: Generate with expiry --
    it('should generate a provision code with expiry', async () => {
        const output = await captureStdout(() =>
            handleGenerateProvisionCode({ expiresInHours: 24 })
        );

        const code = extractCode(output);
        createdCodes.push(code);

        // Look up the code directly
        const entry = await dbManager.getNodeQuery<ProvisionCodeEntry>(
            'SELECT * FROM guild_provision_codes WHERE code = ?', [code]
        );
        expect(entry).toBeDefined();
        expect(entry!.expires_at).toBeDefined();
        expect(entry!.expires_at).not.toBeNull();

        // Should be approximately 24 hours from now (within 60s tolerance)
        const expectedExpiry = Math.floor(Date.now() / 1000) + (24 * 3600);
        expect(Math.abs(entry!.expires_at! - expectedExpiry)).toBeLessThan(60);
    });

    // -- Test 11: List provision codes --
    it('should list provision codes', async () => {
        const out1 = await captureStdout(() => handleGenerateProvisionCode({}));
        createdCodes.push(extractCode(out1));
        const out2 = await captureStdout(() => handleGenerateProvisionCode({}));
        createdCodes.push(extractCode(out2));

        const output = await captureStdout(() => handleListProvisionCodes());

        expect(output).toContain('Code');
        expect(output).toContain('Status');
        expect(output).toContain('active');
    });

    // -- Test 12: Revoke provision code --
    it('should revoke a provision code', async () => {
        const genOutput = await captureStdout(() => handleGenerateProvisionCode({}));
        const code = extractCode(genOutput);

        const output = await captureStdout(() => handleRevokeProvisionCode(code));

        expect(output).toContain('✓ Provision code revoked:');

        // Verify it's gone
        const result = await dbManager.validateProvisionCode(code);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Code not found');
    });

    // -- Test 14: Toggle open creation --
    it('should toggle open guild creation setting', async () => {
        // Ensure initial state
        await dbManager.setNodeSetting('allow_open_guild_creation', 'false');

        let val = await dbManager.getNodeSetting('allow_open_guild_creation');
        expect(val).toBe('false');

        // Toggle on
        const output1 = await captureStdout(() => handleToggleOpenCreation());
        expect(output1).toContain('enabled');

        val = await dbManager.getNodeSetting('allow_open_guild_creation');
        expect(val).toBe('true');

        // Toggle off
        const output2 = await captureStdout(() => handleToggleOpenCreation());
        expect(output2).toContain('disabled');

        val = await dbManager.getNodeSetting('allow_open_guild_creation');
        expect(val).toBe('false');
    });
});

