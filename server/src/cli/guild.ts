/**
 * CLI: Guild Lifecycle Management
 *
 * Provides terminal commands for node operators to manage guilds
 * without needing the client UI.
 *
 * Usage (via server.ts arg parsing):
 *   --create-guild <name> [--owner <email>] [--description <text>]
 *   --list-guilds
 *   --stop-guild <guildId>
 *   --start-guild <guildId>
 *   --delete-guild <guildId> [--preserve-data]
 *   --guild-status
 *   --export-guild <guildId> [--output <path>]
 *   --import-guild <path> [--provision-code <code>]
 *
 * TODO [VISION:Beta] Interactive mode (--interactive / --shell): Drop into a
 * persistent REPL shell so the operator can run multiple commands without
 * re-parsing args and re-initializing the DB each time. Useful for bulk
 * operations like stopping/starting multiple guilds.
 *
 * TODO [VISION:Beta] --logs / --tail: Stream the server's structured log
 * output in real-time from the CLI, filtered by guild or severity level.
 * Currently operators must read raw stdout or redirect to a file.
 *
 * TODO [VISION:Beta] Account management CLI: --list-accounts, --deactivate-account,
 * --reset-password. Currently account management requires direct DB access
 * or the client UI.
 *
 * TODO [VISION:V1] --backup-schedule: Automated periodic guild exports to a
 * configured directory with retention policies (keep last N backups, max age).
 * Currently exports are manual one-shot operations.
 */

import dbManager, { GUILDS_DIR } from '../database';
import { generateGuildIdentity } from '../crypto/guild_identity';
import { exportGuild, getExportStats } from '../guild_export';
import { validateExportBundle, importGuild } from '../guild_import';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// ---------------------------------------------------------------------------
// Formatting Helpers
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY;

const colors = {
    green: (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
    red: (s: string) => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
    yellow: (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
    cyan: (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
    dim: (s: string) => isTTY ? `\x1b[2m${s}\x1b[0m` : s,
    bold: (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
};

function padRight(str: string, len: number): string {
    return str.length >= len ? str.substring(0, len) : str + ' '.repeat(len - str.length);
}

function formatTable(headers: string[], rows: string[][], colWidths: number[]): string {
    const lines: string[] = [];
    const header = headers.map((h, i) => padRight(h, colWidths[i])).join('  ');
    lines.push(header);
    lines.push('─'.repeat(colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * 2));
    for (const row of rows) {
        lines.push(row.map((cell, i) => padRight(cell, colWidths[i])).join('  '));
    }
    return lines.join('\n');
}

function getDirectorySize(dirPath: string): number {
    if (!fs.existsSync(dirPath)) return 0;
    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isFile()) {
            total += fs.statSync(fullPath).size;
        } else if (entry.isDirectory()) {
            total += getDirectorySize(fullPath);
        }
    }
    return total;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Command Handlers
// ---------------------------------------------------------------------------

export async function handleCreateGuild(args: {
    name: string;
    ownerEmail?: string;
    description?: string;
}): Promise<void> {
    const { name, ownerEmail, description } = args;

    if (!name || name.trim() === '') {
        console.error(colors.red('✗ Guild name is required.'));
        console.error('  Usage: --create-guild <name> [--owner <email>] [--description <text>]');
        process.exitCode = 1;
        return;
    }

    // Resolve owner account
    let owner: { id: string; email: string; public_key: string } | undefined;

    if (ownerEmail) {
        owner = await dbManager.getNodeQuery<{ id: string; email: string; public_key: string }>(
            'SELECT id, email, public_key FROM accounts WHERE email = ?',
            [ownerEmail]
        );
        if (!owner) {
            console.error(colors.red(`✗ No account found with email: ${ownerEmail}`));
            console.error('  Create an account first, or omit --owner to use the node operator account.');
            process.exitCode = 1;
            return;
        }
    } else {
        // Use the node operator's account (is_creator = 1)
        owner = await dbManager.getNodeQuery<{ id: string; email: string; public_key: string }>(
            'SELECT id, email, public_key FROM accounts WHERE is_creator = 1 LIMIT 1'
        );
        if (!owner) {
            console.error(colors.red('✗ No node operator account found (is_creator = 1).'));
            console.error('  Register an account first or specify --owner <email>.');
            process.exitCode = 1;
            return;
        }
    }

    // Generate guild ID
    const guildId = 'guild-' + crypto.randomUUID();

    // Initialize guild bundle (creates directory, DB, and registers in node.db)
    await dbManager.initializeGuildBundle(
        guildId,
        name,
        '',                          // icon
        owner.id,                    // ownerId
        description || '',           // description
        owner.public_key             // ownerPublicKey for guild identity encryption
    );

    // Wait for async DB initialization to settle
    await new Promise(resolve => setTimeout(resolve, 200));

    // Seed default category and channel
    const categoryId = 'cat-' + crypto.randomUUID();
    await dbManager.runGuildQuery(
        guildId,
        'INSERT INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)',
        [categoryId, guildId, 'Text Channels', 0]
    );

    const channelId = 'chan-' + crypto.randomUUID();
    await dbManager.runGuildQuery(
        guildId,
        'INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, ?)',
        [channelId, guildId, categoryId, 'general', 'text', 0]
    );
    dbManager.channelToGuildId.set(channelId, guildId);

    // Create the owner's profile in the guild DB
    const profileId = owner.id;
    await dbManager.runGuildQuery(
        guildId,
        `INSERT INTO profiles (id, server_id, account_id, original_username, role)
         VALUES (?, ?, ?, ?, ?)`,
        [profileId, guildId, owner.id, owner.email.split('@')[0], 'OWNER']
    );

    // Look up the fingerprint from the registry
    const registryEntry = await dbManager.getGuildRegistryEntry(guildId);
    const fingerprint = registryEntry?.fingerprint || 'N/A';

    console.log(colors.green(`✓ Guild created: "${name}" (${guildId})`));
    console.log(`  Owner: ${owner.email}`);
    console.log(`  Fingerprint: ${fingerprint}`);
}

export async function handleListGuilds(): Promise<void> {
    const guilds = await dbManager.getAllRegisteredGuilds();

    if (guilds.length === 0) {
        console.log(colors.dim('No guilds registered on this node.'));
        return;
    }

    const rows: string[][] = [];
    for (const guild of guilds) {
        // Get owner email
        const ownerRow = await dbManager.getNodeQuery<{ email: string }>(
            'SELECT email FROM accounts WHERE id = ?',
            [guild.owner_account_id]
        );
        const ownerEmail = ownerRow?.email || 'unknown';

        // Count members (profiles in guild DB)
        let memberCount = 0;
        try {
            const countRow = await dbManager.getGuildQuery<{ count: number }>(
                guild.id,
                'SELECT COUNT(*) as count FROM profiles'
            );
            memberCount = countRow?.count || 0;
        } catch {
            // Guild DB not loaded
            memberCount = 0;
        }

        rows.push([
            guild.id,
            guild.name,
            ownerEmail,
            guild.status,
            memberCount.toString(),
        ]);
    }

    const table = formatTable(
        ['ID', 'Name', 'Owner', 'Status', 'Members'],
        rows,
        [38, 20, 25, 10, 7]
    );
    console.log(table);
}

export async function handleStopGuild(guildId: string): Promise<void> {
    if (!guildId || guildId.trim() === '') {
        console.error(colors.red('✗ Guild ID is required.'));
        console.error('  Usage: --stop-guild <guildId>');
        process.exitCode = 1;
        return;
    }

    const entry = await dbManager.getGuildRegistryEntry(guildId);
    if (!entry) {
        console.error(colors.red(`✗ Guild not found: ${guildId}`));
        console.error('  Run --list-guilds to see available guilds.');
        process.exitCode = 1;
        return;
    }

    if (entry.status === 'stopped') {
        console.log(colors.yellow(`ℹ Guild "${entry.name}" is already stopped.`));
        return;
    }

    await dbManager.updateGuildStatus(guildId, 'stopped');
    console.log(colors.green(`✓ Guild "${entry.name}" stopped.`));
    console.log('  Data is preserved. Use --start-guild to resume.');
}

export async function handleStartGuild(guildId: string): Promise<void> {
    if (!guildId || guildId.trim() === '') {
        console.error(colors.red('✗ Guild ID is required.'));
        console.error('  Usage: --start-guild <guildId>');
        process.exitCode = 1;
        return;
    }

    const entry = await dbManager.getGuildRegistryEntry(guildId);
    if (!entry) {
        console.error(colors.red(`✗ Guild not found: ${guildId}`));
        console.error('  Run --list-guilds to see available guilds.');
        process.exitCode = 1;
        return;
    }

    if (entry.status === 'active') {
        console.log(colors.yellow(`ℹ Guild "${entry.name}" is already active.`));
        return;
    }

    await dbManager.updateGuildStatus(guildId, 'active');
    console.log(colors.green(`✓ Guild "${entry.name}" started.`));
}

export async function handleDeleteGuild(
    guildId: string,
    preserveData: boolean,
    confirmFn?: () => Promise<string>
): Promise<void> {
    if (!guildId || guildId.trim() === '') {
        console.error(colors.red('✗ Guild ID is required.'));
        console.error('  Usage: --delete-guild <guildId> [--preserve-data]');
        process.exitCode = 1;
        return;
    }

    const entry = await dbManager.getGuildRegistryEntry(guildId);
    if (!entry) {
        console.error(colors.red(`✗ Guild not found: ${guildId}`));
        console.error('  Run --list-guilds to see available guilds.');
        process.exitCode = 1;
        return;
    }

    const guildDir = path.join(GUILDS_DIR, guildId);

    console.log(colors.yellow(`⚠ WARNING: This will permanently delete guild "${entry.name}" and all its data.`));
    if (preserveData) {
        console.log(colors.cyan(`ℹ Data directory will be preserved at: ${guildDir}`));
    }

    // Get confirmation — use injected function for tests, readline for real CLI
    let answer: string;
    if (confirmFn) {
        answer = await confirmFn();
    } else {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        answer = await new Promise<string>((resolve) => {
            rl.question(`Type the guild name to confirm: `, (ans) => {
                rl.close();
                resolve(ans.trim());
            });
        });
    }

    if (answer !== entry.name) {
        console.log(colors.red('✗ Name does not match. Deletion cancelled.'));
        return;
    }

    // Unload the guild instance
    dbManager.unloadGuildInstance(guildId);

    // Remove registry entry
    await dbManager.deleteGuildRegistryEntry(guildId);

    // Optionally delete data directory
    if (!preserveData && fs.existsSync(guildDir)) {
        fs.rmSync(guildDir, { recursive: true, force: true });
    }

    console.log(colors.green('✓ Guild deleted.'));
}

export async function handleGuildStatus(): Promise<void> {
    const guilds = await dbManager.getAllRegisteredGuilds();
    const settings = await dbManager.getAllNodeSettings();

    // Count by status
    const counts = { active: 0, suspended: 0, stopped: 0 };
    for (const g of guilds) {
        if (g.status in counts) counts[g.status as keyof typeof counts]++;
    }

    // Count active provision codes
    const allCodes = await dbManager.getProvisionCodes();
    const now = Math.floor(Date.now() / 1000);
    const activeCodes = allCodes.filter(c => !c.used_by && (!c.expires_at || c.expires_at > now));

    // Node URL — best effort from env or settings
    const nodeUrl = process.env.PUBLIC_URL || process.env.HARMONY_PUBLIC_URL || 'http://localhost:3001';
    const openCreation = settings['allow_open_guild_creation'] === 'true';

    console.log('');
    console.log(colors.bold('Harmony Node Status'));
    console.log('══════════════════════════════════');
    console.log(`Node: ${nodeUrl}`);
    console.log(`Guilds: ${counts.active} active, ${counts.suspended} suspended, ${counts.stopped} stopped`);
    console.log(`Open Creation: ${openCreation ? colors.green('enabled') : colors.dim('disabled')}`);
    console.log(`Provision Codes: ${activeCodes.length} active`);
    console.log('');

    if (guilds.length === 0) {
        console.log(colors.dim('No guilds on this node.'));
        return;
    }

    const rows: string[][] = [];
    for (const guild of guilds) {
        let memberCount = 0;
        try {
            const countRow = await dbManager.getGuildQuery<{ count: number }>(
                guild.id,
                'SELECT COUNT(*) as count FROM profiles'
            );
            memberCount = countRow?.count || 0;
        } catch {
            memberCount = 0;
        }

        const guildDir = path.join(GUILDS_DIR, guild.id);
        const storageBytes = getDirectorySize(guildDir);

        const statusIcon = guild.status === 'active' ? '●' :
                           guild.status === 'suspended' ? '◉' : '○';

        rows.push([
            guild.name,
            `${statusIcon} ${guild.status}`,
            memberCount.toString(),
            formatBytes(storageBytes),
        ]);
    }

    const table = formatTable(
        ['Guild', 'Status', 'Members', 'Storage'],
        rows,
        [20, 14, 8, 10]
    );
    console.log(table);
}

export async function handleExportGuild(guildId: string, outputPath?: string): Promise<void> {
    if (!guildId || guildId.trim() === '') {
        console.error(colors.red('✗ Guild ID is required.'));
        console.error('  Usage: --export-guild <guildId> [--output <path>]');
        process.exitCode = 1;
        return;
    }

    const entry = await dbManager.getGuildRegistryEntry(guildId);
    if (!entry) {
        console.error(colors.red(`✗ Guild not found: ${guildId}`));
        console.error('  Run --list-guilds to see available guilds.');
        process.exitCode = 1;
        return;
    }

    if (entry.status === 'suspended') {
        console.error(colors.red(`✗ Cannot export suspended guild: ${guildId}`));
        process.exitCode = 1;
        return;
    }

    // Default output path: current directory, named guild_export_{id}_{date}.zip
    const defaultPath = path.join(
        process.cwd(),
        `guild_export_${guildId}_${new Date().toISOString().slice(0, 10)}.zip`
    );
    const finalPath = outputPath || defaultPath;

    console.log(colors.cyan(`Exporting guild "${entry.name}" (${guildId})...`));

    // Show pre-export stats
    try {
        const stats = await getExportStats(guildId);
        console.log(`  Members: ${stats.member_count}`);
        console.log(`  Channels: ${stats.channel_count}`);
        console.log(`  Messages: ${stats.message_count}`);
        console.log(`  Uploads: ${stats.upload_count} (${formatBytes(stats.upload_total_bytes)})`);
        console.log(`  Estimated size: ~${formatBytes(stats.upload_total_bytes + 1024 * 1024)}`);
    } catch (err: any) {
        console.warn(colors.yellow(`  Could not gather stats: ${err.message}`));
    }

    console.log('');

    try {
        const result = await exportGuild(guildId, finalPath, 'cli-export');
        console.log(colors.green(`✓ Export complete: ${result.zipPath}`));
        console.log(`  Guild: ${result.manifest.guild_name}`);
        console.log(`  Messages: ${result.manifest.stats.message_count}`);
        console.log(`  DB checksum: ${result.manifest.files.guild_db_sha256.substring(0, 16)}...`);
    } catch (err: any) {
        console.error(colors.red(`✗ Export failed: ${err.message}`));
        process.exitCode = 1;
    }
}

export async function handleImportGuild(zipPath: string, provisionCode?: string): Promise<void> {
    if (!zipPath || zipPath.trim() === '') {
        console.error(colors.red('✗ ZIP file path is required.'));
        console.error('  Usage: --import-guild <path> [--provision-code <code>]');
        process.exitCode = 1;
        return;
    }

    if (!fs.existsSync(zipPath)) {
        console.error(colors.red(`✗ File not found: ${zipPath}`));
        process.exitCode = 1;
        return;
    }

    console.log(colors.cyan(`Validating export bundle: ${zipPath}`));

    const validation = await validateExportBundle(zipPath);
    if (!validation.valid) {
        console.error(colors.red('✗ Invalid export bundle:'));
        validation.errors.forEach(e => console.error(`  - ${e}`));
        process.exitCode = 1;
        return;
    }

    console.log(colors.green(`✓ Valid export: "${validation.manifest!.guild_name}"`));
    console.log(`  Messages: ${validation.manifest!.stats.message_count}`);
    console.log(`  Members: ${validation.manifest!.stats.member_count}`);
    console.log(`  Uploads: ${formatBytes(validation.manifest!.stats.upload_total_bytes)}`);

    // Validate provision code if provided
    if (provisionCode) {
        const codeValidation = await dbManager.validateProvisionCode(provisionCode);
        if (!codeValidation.valid) {
            console.error(colors.red(`✗ Invalid provision code: ${codeValidation.error}`));
            process.exitCode = 1;
            return;
        }
    }

    // For CLI, the node operator is the importer
    const operator = await dbManager.getNodeQuery<{ id: string; email: string; public_key: string }>(
        'SELECT id, email, public_key FROM accounts WHERE is_creator = 1 LIMIT 1'
    );

    if (!operator) {
        console.error(colors.red('✗ No node operator account found (is_creator = 1).'));
        console.error('  Register an account first.');
        process.exitCode = 1;
        return;
    }

    console.log('');

    try {
        const result = await importGuild(zipPath, operator.id, operator.public_key);
        console.log(colors.green(`✓ Guild imported: "${result.name}" (${result.guildId})`));
        console.log(`  Fingerprint: ${result.fingerprint}`);
        console.log(`  Generate invite links to let members rejoin.`);

        // Consume provision code if used
        if (provisionCode) {
            await dbManager.consumeProvisionCode(provisionCode, operator.id, result.guildId);
            console.log(`  Provision code consumed.`);
        }
    } catch (err: any) {
        console.error(colors.red(`✗ Import failed: ${err.message}`));
        process.exitCode = 1;
    }
}
