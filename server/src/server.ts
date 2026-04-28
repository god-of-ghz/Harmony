import './setup';
import http from 'http';
import https from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import dbManager from './database';
import { createApp } from './app';
import { importDirectory, importDiscordJson } from './importer';
import fs from 'fs';
import path from 'path';
import { startMediasoup } from './media/sfu';
import { setupWebRTC } from './media/signaling';
import { setupConnectionTracking, createScopedBroadcast } from './websocket';
import { getOrGenerateCerts } from './certs';
import { initializeServerIdentity } from './crypto/pki';
import { DATA_DIR } from './database';
import { startAuditJob } from './jobs/auditJob';
import { handleCreateGuild, handleListGuilds, handleStopGuild, handleStartGuild, handleDeleteGuild, handleGuildStatus, handleExportGuild, handleImportGuild } from './cli/guild';
import { handleGenerateProvisionCode, handleListProvisionCodes, handleRevokeProvisionCode, handleToggleOpenCreation } from './cli/provision';

// ---------------------------------------------------------------------------
// Help Text
// ---------------------------------------------------------------------------
// TODO [VISION:Beta] Add the following CLI commands to the help text and dispatch:
//   --list-accounts              List all accounts on this node
//   --deactivate-account <email> Deactivate an account (block login)
//   --reset-password <email>     Force-reset an account's password
//   --interactive / --shell      Enter persistent REPL for bulk operations
//   --logs [--guild <id>]        Stream structured server logs in real-time

const HELP_TEXT = `
Harmony Server CLI

  Server:
    --port <number>              Set the server port (default: 3001)
    --import <path>              Import a Discord ServerSaver export
    --elevate <email>            Elevate an account to creator/admin
    --mock                       Start with mock data for development

  Guild Management:
    --create-guild <name>        Create a new guild
      --owner <email>            Assign ownership (default: node operator)
      --description <text>       Set guild description
    --list-guilds                List all guilds on this node
    --stop-guild <id>            Stop a guild (preserve data)
    --start-guild <id>           Start a stopped guild
    --delete-guild <id>          Delete a guild
      --preserve-data            Keep files after deletion
    --guild-status               Show node and guild dashboard
    --export-guild <id>          Export a guild as a portable ZIP bundle
      --output <path>            Set output path for the export ZIP
    --import-guild <path>        Import a guild from an export ZIP bundle
      --provision-code <code>    Use a provision code for authorization

  Provision Codes:
    --generate-provision-code        Generate a guild creation code
      --expires <hours>              Set expiration (default: never)
      --max-members <number>         Set member limit (default: unlimited)
    --list-provision-codes           List all provision codes
    --revoke-provision-code <code>   Revoke a provision code
    --toggle-open-creation           Toggle whether any user can create guilds

  Security:
    --revoke-identity            Revoke this server's Ed25519 identity

  Other:
    --help                       Show this help message
`;

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

function getArgValue(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    const val = args[idx + 1];
    return val && !val.startsWith('--') ? val : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
    return args.includes(flag);
}

/**
 * Wait for the node DB to be ready (tables created, guild DBs loaded).
 * The DatabaseManager constructor kicks off async init via callbacks,
 * so we need a small delay to let SQLite serialize() chains finish.
 */
async function waitForDbReady(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 500));
}

const importArgIndex = process.argv.findIndex(arg => arg === '--import' || arg === 'import');
const elevateArgIndex = process.argv.findIndex(arg => arg === '--elevate' || arg === 'elevate');

const portArgIndex = process.argv.indexOf('--port');
const portArgValue = portArgIndex !== -1 ? process.argv[portArgIndex + 1] : null;
const portEqualsArg = process.argv.find(arg => arg.startsWith('--port='));
const portEqualsValue = portEqualsArg ? portEqualsArg.split('=')[1] : null;
const isNumberArg = process.argv.slice(2).find(arg => !isNaN(Number(arg)) && arg.length >= 4);

const PORT = portEqualsValue || portArgValue || isNumberArg || process.env.PORT || 3001;
const isMock = process.argv.indexOf('--mock') !== -1;

// ---------------------------------------------------------------------------
// CLI Command Dispatch
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (hasFlag(args, '--help')) {
    console.log(HELP_TEXT);
    process.exit(0);

} else if (hasFlag(args, '--create-guild')) {
    const name = getArgValue(args, '--create-guild');
    if (!name) {
        console.error("Usage: --create-guild <name> [--owner <email>] [--description <text>]");
        process.exit(1);
    }
    const ownerEmail = getArgValue(args, '--owner');
    const description = getArgValue(args, '--description');
    waitForDbReady().then(() =>
        handleCreateGuild({ name, ownerEmail, description })
    ).then(() => process.exit(process.exitCode || 0))
     .catch((e) => { console.error(e); process.exit(1); });

} else if (hasFlag(args, '--list-guilds')) {
    waitForDbReady().then(() => handleListGuilds())
        .then(() => process.exit(0))
        .catch((e) => { console.error(e); process.exit(1); });

} else if (hasFlag(args, '--stop-guild')) {
    const guildId = getArgValue(args, '--stop-guild');
    if (!guildId) {
        console.error("Usage: --stop-guild <guildId>");
        process.exit(1);
    }
    waitForDbReady().then(() => handleStopGuild(guildId))
        .then(() => process.exit(process.exitCode || 0))
        .catch((e) => { console.error(e); process.exit(1); });

} else if (hasFlag(args, '--start-guild')) {
    const guildId = getArgValue(args, '--start-guild');
    if (!guildId) {
        console.error("Usage: --start-guild <guildId>");
        process.exit(1);
    }
    waitForDbReady().then(() => handleStartGuild(guildId))
        .then(() => process.exit(process.exitCode || 0))
        .catch((e) => { console.error(e); process.exit(1); });

} else if (hasFlag(args, '--delete-guild')) {
    const guildId = getArgValue(args, '--delete-guild');
    if (!guildId) {
        console.error("Usage: --delete-guild <guildId> [--preserve-data]");
        process.exit(1);
    }
    const preserveData = hasFlag(args, '--preserve-data');
    waitForDbReady().then(() => handleDeleteGuild(guildId, preserveData))
        .then(() => process.exit(process.exitCode || 0))
        .catch((e) => { console.error(e); process.exit(1); });

} else if (hasFlag(args, '--guild-status')) {
    waitForDbReady().then(() => handleGuildStatus())
        .then(() => process.exit(0))
        .catch((e) => { console.error(e); process.exit(1); });

} else if (hasFlag(args, '--export-guild')) {
    const guildId = getArgValue(args, '--export-guild');
    if (!guildId) {
        console.error("Usage: --export-guild <guildId> [--output <path>]");
        process.exit(1);
    }
    const outputPath = getArgValue(args, '--output');
    waitForDbReady().then(() => handleExportGuild(guildId, outputPath))
        .then(() => process.exit(process.exitCode || 0))
        .catch((e) => { console.error(e); process.exit(1); });

} else if (hasFlag(args, '--import-guild')) {
    const zipPath = getArgValue(args, '--import-guild');
    if (!zipPath) {
        console.error("Usage: --import-guild <path> [--provision-code <code>]");
        process.exit(1);
    }
    const provisionCode = getArgValue(args, '--provision-code');
    waitForDbReady().then(() => handleImportGuild(zipPath, provisionCode))
        .then(() => process.exit(process.exitCode || 0))
        .catch((e) => { console.error(e); process.exit(1); });

} else if (hasFlag(args, '--generate-provision-code')) {
    const expiresStr = getArgValue(args, '--expires');
    const maxMembersStr = getArgValue(args, '--max-members');
    const expiresInHours = expiresStr ? parseInt(expiresStr, 10) : undefined;
    const maxMembers = maxMembersStr ? parseInt(maxMembersStr, 10) : undefined;
    waitForDbReady().then(() => handleGenerateProvisionCode({ expiresInHours, maxMembers }))
        .then(() => process.exit(process.exitCode || 0))
        .catch((e) => { console.error(e); process.exit(1); });

} else if (hasFlag(args, '--list-provision-codes')) {
    waitForDbReady().then(() => handleListProvisionCodes())
        .then(() => process.exit(0))
        .catch((e) => { console.error(e); process.exit(1); });

} else if (hasFlag(args, '--revoke-provision-code')) {
    const code = getArgValue(args, '--revoke-provision-code');
    if (!code) {
        console.error("Usage: --revoke-provision-code <code>");
        process.exit(1);
    }
    waitForDbReady().then(() => handleRevokeProvisionCode(code))
        .then(() => process.exit(process.exitCode || 0))
        .catch((e) => { console.error(e); process.exit(1); });

} else if (hasFlag(args, '--toggle-open-creation')) {
    waitForDbReady().then(() => handleToggleOpenCreation())
        .then(() => process.exit(0))
        .catch((e) => { console.error(e); process.exit(1); });

} else if (importArgIndex !== -1) {
    const targetPath = process.argv[importArgIndex + 1];
    if (!targetPath || targetPath.startsWith('--')) {
        console.error("Usage: harmony-server.exe --import <path> [Optional Server Name]");
        process.exit(1);
    }
    const potentialName = process.argv[importArgIndex + 2];
    const serverName = (potentialName && !potentialName.startsWith('--')) ? potentialName : "Imported Server";

    console.log(`Starting import for ${targetPath}...`);
    setTimeout(async () => {
        try {
            const stat = fs.statSync(targetPath);
            if (stat.isDirectory()) {
                await importDirectory(targetPath, serverName !== "Imported Server" ? serverName : path.basename(targetPath));
            } else {
                const guildId = 'server-' + Date.now().toString();
                await dbManager.initializeServerBundle(guildId, serverName, '');
                await importDiscordJson(targetPath, guildId, 'legacy-id');
            }
            console.log("Import complete. You can now start the server normally.");
            process.exit(0);
        } catch (error) {
            console.error("Import failed:", error);
            process.exit(1);
        }
    }, 500);

} else if (elevateArgIndex !== -1) {
    const email = process.argv[elevateArgIndex + 1];
    if (!email || email.startsWith('--')) {
        console.error("Usage: harmony-server.exe --elevate <email>");
        process.exit(1);
    }
    console.log(`Elevating account ${email}...`);
    setTimeout(async () => {
        try {
            await dbManager.runNodeQuery('UPDATE accounts SET is_creator = 1, is_admin = 1 WHERE email = ?', [email]);
            console.log(`Successfully elevated ${email} to GLOBAL CREATOR and ADMIN.`);
            process.exit(0);
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    }, 500);
} else {
    // --- STANDARD SERVER BOOT ---
    // TODO [VISION:Beta] Add `--dev` flag support: forces HTTP, disables TLS warnings,
    // enables verbose logging. Currently dev mode is implicit (no NODE_ENV=production).
    //
    // TODO [VISION:Beta] Add mDNS advertisement here after PKI init. The server should
    // broadcast a `_harmony._tcp.local` service record with its server_id, fingerprint,
    // public_url, name, and version. Use Node.js `mdns-js` package.
    //
    // TODO [VISION:Beta] Add first-run setup wizard. On first boot (no DB detected),
    // serve a browser-based wizard at http://localhost:PORT/setup. All other routes
    // return 503 until setup completes. See HARMONY_VISION.md "First-Run Setup Wizard".
    const startServer = async () => {
        // Initialize server cryptographic identity (PKI)
        try {
            initializeServerIdentity(DATA_DIR);
        } catch (err) {
            console.error('[BOOT] Failed to initialize server identity:', err);
            console.error('[BOOT] The server will continue without a cryptographic identity.');
        }

        await startMediasoup().catch(console.error);
        
        const isProduction = process.env.NODE_ENV === 'production';
        const useHttps = isProduction || process.env.USE_HTTPS === 'true';

        let server: http.Server | https.Server;
        let protocol = 'http';

        if (!useHttps) {
            console.log("[DEV] HTTP mode active — TLS is disabled.");
            console.log("[DEV] Set NODE_ENV=production or USE_HTTPS=true for HTTPS.");
            console.log(`[DEV] Server URL: http://localhost:${PORT}`);
            console.log("[DEV] Do not use HTTP mode with real users on the internet.");
        }

        if (useHttps) {
            try {
                const certs = await getOrGenerateCerts();
                
                if (certs) {
                    server = https.createServer({ key: certs.key, cert: certs.cert });
                    protocol = 'https';
                    console.log("TLS/HTTPS enabled: Loaded or generated cert.pem and key.pem");
                } else {
                    console.warn("HTTPS initialization failed. Falling back to HTTP.");
                    server = http.createServer();
                }
            } catch (err) {
                console.error("Failed to initialize HTTPS server, falling back to HTTP:", err);
                server = http.createServer();
            }
        } else {
            server = http.createServer();
        }

        const wss = new WebSocketServer({ server });

        const clients = new Set<WebSocket>();

        // Guild-scoped broadcast: routes messages with guildId to guild members only;
        // messages without guildId are broadcast globally (presence, DMs).
        const broadcastMessage = createScopedBroadcast(wss);

        wss.on('connection', (ws) => {
            console.log('New WebSocket connection');
            clients.add(ws);
            setupWebRTC(ws as any);
            setupConnectionTracking(ws, broadcastMessage, dbManager);

            ws.on('close', () => {
                console.log('Connection closed');
                clients.delete(ws);
            });
        });

        if (isMock) {
            // Seed logic
            try {
                const servers = await dbManager.getAllLoadedServers();
                if (servers.length === 0) {
                    console.log("Seeding initial mock server...");
                    const guildId = 'mock-server-001';
                    await dbManager.initializeServerBundle(guildId, "Harmony Mock Server", "");
                    
                    const categoryId = 'mock-cat-001';
                    await dbManager.runGuildQuery(guildId, 'INSERT INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)', [categoryId, guildId, 'Text Channels', 0]);
                    
                    const channelId = 'mock-chan-001';
                    await dbManager.runGuildQuery(guildId, 'INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, ?)', [channelId, guildId, categoryId, 'general', 'text', 0]);
                    // Populate channel→server cache (loadServerInstance scans before these inserts)
                    dbManager.channelToServerId.set(channelId, guildId);

                    // Seed @everyone role with basic permissions so new users can send messages
                    // Permission bits: SEND_MESSAGES(1<<7) | ATTACH_FILES(1<<8) | VIEW_CHANNEL(1<<10) | READ_MESSAGE_HISTORY(1<<11)
                    const everyonePerms = (1 << 7) | (1 << 8) | (1 << 10) | (1 << 11);
                    await dbManager.runGuildQuery(guildId, 'INSERT INTO roles (id, server_id, name, color, permissions, position) VALUES (?, ?, ?, ?, ?, ?)', ['mock-role-everyone', guildId, '@everyone', '#FFFFFF', everyonePerms, 0]);
                    console.log("Mock server seeded: 'Harmony Mock Server'");
                }

                const users = await dbManager.allNodeQuery('SELECT id FROM accounts');
                if (users.length === 0) {
                    console.log("Seeding mock admin account...");
                    const userId = 'mock-admin-id';
                    const email = 'admin@harmony.local';
                    const pass = 'password123';
                    const auth_verifier = 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f3883d4473e94f'; // sha256('password123')
                    // Mock keys (base64)
                    const pub = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq8G5...'; 
                    const enc = '...'; 
                    await dbManager.runNodeQuery(
                        `INSERT INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [userId, email, auth_verifier, pub, enc, 'salt', 'iv', 1, 1]
                    );
                    console.log(`Mock admin seeded: ${email} / ${pass}`);
                }
            } catch (e) {
                console.error("Failed to seed mock data:", e);
            }
        }

        const app = createApp(dbManager, broadcastMessage);
        server.on('request', app);

        server.listen(PORT as number, () => {
            console.log(`Server is running and accessible at ${protocol}://localhost:${PORT}`);
            if (isMock) console.log("Mock mode is enabled. Use admin@harmony.local / password123 to login.");
            if (protocol === 'https') {
                console.log(`\n⚠️  LOCAL HTTPS SETUP — ACTION REQUIRED FOR CLIENTS`);
                console.log(`   This server is using a self-signed TLS certificate.`);
                console.log(`   Browser clients must manually trust it before connecting.`);
                console.log(`   Open this URL in your browser and click "Advanced → Proceed":`);
                console.log(`   → ${protocol}://localhost:${PORT}/api/health\n`);
                console.log(`   (Repeat this for every server port you are running locally.)`);
            }
        });
    };

    const bootstrap = async () => {
        await startServer();
        startAuditJob();
    };

    if (require.main === module || !process.env.VITEST) {
        bootstrap();
    }
}

export {}; // Ensure it's a module
