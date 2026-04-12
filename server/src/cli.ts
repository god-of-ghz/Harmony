import path from 'path';
import fs from 'fs';
import { importDirectory, importDiscordJson } from './importer';
import dbManager from './database';

const targetPath = process.argv[2];
if (!targetPath) {
    console.error("Usage: npm run import -- <path-to-json-or-directory> [Server Name]");
    process.exit(1);
}

const main = async () => {
    // Wait briefly for the async Database initialize query to establish tables
    setTimeout(async () => {
        try {
            const stat = fs.statSync(targetPath);
            if (stat.isDirectory()) {
                const serverName = process.argv[3] || path.basename(targetPath);
                await importDirectory(targetPath, serverName);
            } else {
                const serverName = process.argv[3] || "Imported Server";
                const serverId = 'server-' + Date.now().toString();
                await dbManager.initializeServerBundle(serverId, serverName, '');
                await importDiscordJson(targetPath, serverId, 'legacy-id');
            }
            console.log("Import complete. You can now start the server.");
            process.exit(0);
        } catch (error) {
            console.error("Import failed:", error);
            process.exit(1);
        }
    }, 500);
};

main();
