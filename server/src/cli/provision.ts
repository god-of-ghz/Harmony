/**
 * CLI: Provision Code Management
 *
 * Provision codes allow node operators to grant guild-creation rights
 * to users who would otherwise be unauthorized.
 *
 * Usage (via server.ts arg parsing):
 *   --generate-provision-code [--expires <hours>] [--max-members <n>]
 *   --list-provision-codes
 *   --revoke-provision-code <code>
 *   --toggle-open-creation
 */

import dbManager from '../database';

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

function formatTimestamp(epoch: number | null): string {
    if (!epoch) return 'Never';
    const d = new Date(epoch * 1000);
    return d.toISOString().replace('T', ' ').substring(0, 16);
}

// ---------------------------------------------------------------------------
// Command Handlers
// ---------------------------------------------------------------------------

export async function handleGenerateProvisionCode(args: {
    expiresInHours?: number;
    maxMembers?: number;
}): Promise<void> {
    // Get the node operator's account
    const operator = await dbManager.getNodeQuery<{ id: string; email: string }>(
        'SELECT id, email FROM accounts WHERE is_creator = 1 LIMIT 1'
    );
    if (!operator) {
        console.error(colors.red('✗ No node operator account found (is_creator = 1).'));
        console.error('  Register an account first before generating provision codes.');
        process.exitCode = 1;
        return;
    }

    const { expiresInHours, maxMembers } = args;

    // Calculate expiration timestamp
    let expiresAt: number | undefined;
    if (expiresInHours !== undefined && expiresInHours > 0) {
        expiresAt = Math.floor(Date.now() / 1000) + (expiresInHours * 3600);
    }

    const code = await dbManager.createProvisionCode(
        operator.id,
        expiresAt,
        maxMembers || 0
    );

    const expiresStr = expiresAt ? formatTimestamp(expiresAt) : 'Never';
    const maxMembersStr = maxMembers ? maxMembers.toString() : 'Unlimited';

    console.log(colors.green(`✓ Provision code generated: ${code}`));
    console.log(`  Expires: ${expiresStr}`);
    console.log(`  Max members: ${maxMembersStr}`);
    console.log('');
    console.log(colors.dim('Share this code with someone to let them create a guild on your server.'));
}

export async function handleListProvisionCodes(): Promise<void> {
    const codes = await dbManager.getProvisionCodes();

    if (codes.length === 0) {
        console.log(colors.dim('No provision codes found.'));
        return;
    }

    const rows: string[][] = [];
    for (const code of codes) {
        // Determine status
        let status: string;
        const now = Math.floor(Date.now() / 1000);
        if (code.used_by) {
            status = 'used';
        } else if (code.expires_at && code.expires_at < now) {
            status = 'expired';
        } else {
            status = 'active';
        }

        // Get used-by info
        let usedByStr = '—';
        if (code.used_by) {
            const user = await dbManager.getNodeQuery<{ email: string }>(
                'SELECT email FROM accounts WHERE id = ?',
                [code.used_by]
            );
            const email = user?.email || code.used_by;
            usedByStr = `${email} → ${code.resulting_guild_id || '?'}`;
        }

        rows.push([
            code.code,
            status,
            formatTimestamp(code.created_at),
            formatTimestamp(code.expires_at),
            usedByStr,
        ]);
    }

    const table = formatTable(
        ['Code', 'Status', 'Created', 'Expires', 'Used By'],
        rows,
        [34, 8, 18, 18, 30]
    );
    console.log(table);
}

export async function handleRevokeProvisionCode(code: string): Promise<void> {
    if (!code || code.trim() === '') {
        console.error(colors.red('✗ Provision code is required.'));
        console.error('  Usage: --revoke-provision-code <code>');
        process.exitCode = 1;
        return;
    }

    // Verify code exists
    const validation = await dbManager.validateProvisionCode(code);
    if (!validation.code && !validation.valid) {
        console.error(colors.red(`✗ Provision code not found: ${code}`));
        console.error('  Run --list-provision-codes to see available codes.');
        process.exitCode = 1;
        return;
    }

    await dbManager.revokeProvisionCode(code);
    console.log(colors.green(`✓ Provision code revoked: ${code}`));
}

export async function handleToggleOpenCreation(): Promise<void> {
    const currentValue = await dbManager.getNodeSetting('allow_open_guild_creation');
    const newValue = currentValue === 'true' ? 'false' : 'true';

    await dbManager.setNodeSetting('allow_open_guild_creation', newValue);

    const statusStr = newValue === 'true'
        ? colors.green('enabled')
        : colors.dim('disabled');

    console.log(colors.green(`✓ Open guild creation: ${newValue === 'true' ? 'enabled' : 'disabled'}`));
}
