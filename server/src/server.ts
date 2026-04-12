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
import { setupConnectionTracking } from './websocket';
import { getOrGenerateCerts } from './certs';

const importArgIndex = process.argv.findIndex(arg => arg === '--import' || arg === 'import');
const elevateArgIndex = process.argv.findIndex(arg => arg === '--elevate' || arg === 'elevate');

const portArgIndex = process.argv.indexOf('--port');
const portArgValue = portArgIndex !== -1 ? process.argv[portArgIndex + 1] : null;
const portEqualsArg = process.argv.find(arg => arg.startsWith('--port='));
const portEqualsValue = portEqualsArg ? portEqualsArg.split('=')[1] : null;
const isNumberArg = process.argv.slice(2).find(arg => !isNaN(Number(arg)) && arg.length >= 4);

const PORT = portEqualsValue || portArgValue || isNumberArg || process.env.PORT || 3001;
const isMock = process.argv.indexOf('--mock') !== -1;

if (importArgIndex !== -1) {
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
                const serverId = 'server-' + Date.now().toString();
                await dbManager.initializeServerBundle(serverId, serverName, '');
                await importDiscordJson(targetPath, serverId, 'legacy-id');
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
    const startServer = async () => {
        await startMediasoup().catch(console.error);
        
        const useHttps = process.env.USE_HTTPS !== 'false';
        let server: http.Server | https.Server;
        let protocol = 'http';

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

        const broadcastMessage = (data: any) => {
            const payload = JSON.stringify(data);
            clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(payload);
                }
            });
        };

        wss.on('connection', (ws) => {
            console.log('New WebSocket connection');
            clients.add(ws);
            setupWebRTC(ws as any);
            setupConnectionTracking(ws, broadcastMessage);

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
                    const serverId = 'mock-server-001';
                    await dbManager.initializeServerBundle(serverId, "Harmony Mock Server", "");
                    
                    const categoryId = 'mock-cat-001';
                    await dbManager.runServerQuery(serverId, 'INSERT INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)', [categoryId, serverId, 'Text Channels', 0]);
                    
                    const channelId = 'mock-chan-001';
                    await dbManager.runServerQuery(serverId, 'INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, ?)', [channelId, serverId, categoryId, 'general', 'text', 0]);
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

        server.listen(PORT as number, '0.0.0.0', () => {
            console.log(`Server is running and accessible at ${protocol}://localhost:${PORT}`);
            if (isMock) console.log("Mock mode is enabled. Use admin@harmony.local / password123 to login.");
            if (protocol === 'https') {
                console.log("NOTE: If using self-signed certs locally, you may need NODE_TLS_REJECT_UNAUTHORIZED=0 in your client environment.");
            }
        });
    };

    const bootstrap = async () => {
        await startServer();
    };

    if (require.main === module || !process.env.VITEST) {
        bootstrap();
    }
}

export {}; // Ensure it's a module
