import fs from 'fs';
import path from 'path';
import { runQuery } from './database';

interface DiscordMessage {
    id: string | number;
    timestamp: string;
    author_id: string | number;
    author_name: string;
    content: string;
    is_pinned: boolean;
}

export async function importDiscordJson(filePath: string, serverId: string) {
    try {
        const rawData = fs.readFileSync(filePath, 'utf-8');
        // Prevent JS Float64 precision loss on Discord Snowflake IDs by explicitly wrapping them in strings pre-parsing
        const safeData = rawData.replace(/"(author_id|id)":\s*(\d+)/g, '"$1": "$2"');
        const messages: DiscordMessage[] = JSON.parse(safeData);

        if (!messages || messages.length === 0) {
            console.log('No messages to import in', filePath);
            return;
        }

        const baseName = path.basename(filePath, '.json');
        const parts = baseName.split('-');
        let channelId = Date.now().toString() + Math.random().toString().slice(2, 6);
        let channelName = 'imported-channel';

        if (parts.length >= 3 && parts[0] === 'History') {
            channelId = parts[parts.length - 1];
            channelName = parts.slice(1, parts.length - 1).join('-');
        }

        // Ensure the Channel exists
        await runQuery(
            `INSERT OR IGNORE INTO channels (id, server_id, name) VALUES (?, ?, ?)`,
            [channelId, serverId, channelName]
        );

        // Process Users and Messages
        for (const msg of messages) {
            const safeAuthorId = msg.author_id.toString();
            const safeMsgId = msg.id.toString();

            await runQuery(
                `INSERT OR IGNORE INTO profiles (id, server_id, original_username, nickname, avatar, role, aliases) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [safeAuthorId, serverId, msg.author_name, msg.author_name, '', 'USER', safeAuthorId]
            );

            await runQuery(
                `INSERT OR IGNORE INTO messages (id, channel_id, author_id, content, timestamp, is_pinned) VALUES (?, ?, ?, ?, ?, ?)`,
                [safeMsgId, channelId, safeAuthorId, msg.content, msg.timestamp, msg.is_pinned ? 1 : 0]
            );
        }

        console.log(`Successfully imported ${messages.length} messages into channel "#${channelName}"!`);
    } catch (error) {
        console.error(`Failed to import JSON file ${filePath}:`, error);
    }
}

export async function importDirectory(dirPath: string, serverName: string) {
    try {
        const files = fs.readdirSync(dirPath);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        if (jsonFiles.length === 0) {
            console.log('No JSON files found in directory:', dirPath);
            return;
        }

        const serverId = 'server-' + Date.now().toString();
        await runQuery(
            `INSERT OR IGNORE INTO servers (id, name, icon) VALUES (?, ?, ?)`,
            [serverId, serverName, '']
        );

        console.log(`Created server "${serverName}" (${serverId}). Importing ${jsonFiles.length} channels...`);

        for (const file of jsonFiles) {
            const fullPath = path.join(dirPath, file);
            await importDiscordJson(fullPath, serverId);
        }

        console.log(`Finished importing directory: ${dirPath}`);
    } catch (error) {
        console.error('Failed to import directory:', error);
    }
}
