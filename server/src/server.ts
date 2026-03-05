import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as baseDb from './database';
import { createApp } from './app';
import { importDirectory, importDiscordJson } from './importer';
import fs from 'fs';
import path from 'path';

const importArgIndex = process.argv.indexOf('--import');
const elevateArgIndex = process.argv.indexOf('--elevate');

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
                await baseDb.runQuery(`INSERT OR IGNORE INTO servers (id, name, icon) VALUES (?, ?, ?)`, [serverId, serverName, '']);
                await importDiscordJson(targetPath, serverId);
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
            await baseDb.runQuery('UPDATE accounts SET is_creator = 1 WHERE email = ?', [email]);
            console.log(`Successfully elevated ${email} to GLOBAL CREATOR.`);
            process.exit(0);
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    }, 500);

} else {
    // --- STANDARD SERVER BOOT ---
    const server = http.createServer();
    const wss = new WebSocketServer({ server });

    const clients = new Set<WebSocket>();

    wss.on('connection', (ws) => {
        console.log('New WebSocket connection');
        clients.add(ws);

        ws.on('close', () => {
            console.log('Connection closed');
            clients.delete(ws);
        });
    });

    const broadcastMessage = (data: any) => {
        const payload = JSON.stringify(data);
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    };

    const app = createApp(baseDb, broadcastMessage);
    server.on('request', app);

    const portArgIndex = process.argv.indexOf('--port');
    const portArgValue = portArgIndex !== -1 ? process.argv[portArgIndex + 1] : null;
    const portEqualsArg = process.argv.find(arg => arg.startsWith('--port='));
    const portEqualsValue = portEqualsArg ? portEqualsArg.split('=')[1] : null;

    const PORT = portEqualsValue || portArgValue || process.env.PORT || 3001;

    server.listen(PORT as number, '0.0.0.0', () => {
        console.log(`Server is running and accessible at http://localhost:${PORT}`);
    });
}
