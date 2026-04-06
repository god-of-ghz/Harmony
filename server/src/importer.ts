import fs from 'fs';
import path from 'path';
import { Transform, pipeline } from 'stream';
import { promisify } from 'util';
import StreamArray from 'stream-json/src/streamers/stream-array';
import dbManager from './database';

const streamPipeline = promisify(pipeline);

// Shared locks to ensure SQLite transactions don't overlap for the same server
const serverLocks = new Map<string, Promise<any>>();

async function withServerLock(serverId: string, fn: () => Promise<any>) {
    const lastLock = serverLocks.get(serverId) || Promise.resolve();
    const nextLock = (async () => {
        try { await lastLock; } catch (e) { /* ignore previous errors */ }
        return fn();
    })();
    serverLocks.set(serverId, nextLock);
    return nextLock;
}

/**
 * A transform stream that finds large Discord IDs in JSON and wraps them in quotes
 * before parsing, preventing precision loss.
 */
class DiscordIdFixer extends Transform {
    private tail = '';
    _transform(chunk: any, encoding: string, callback: any) {
        const data = this.tail + chunk.toString();
        // Find the last safe place to split to avoid cutting a "key": value pair in half.
        const lastSafe = Math.max(
            data.lastIndexOf(','),
            data.lastIndexOf('{'),
            data.lastIndexOf('['),
            data.lastIndexOf('}'),
            data.lastIndexOf(']')
        );

        if (lastSafe !== -1) {
            const toProcess = data.slice(0, lastSafe + 1);
            this.tail = data.slice(lastSafe + 1);
            const fixed = toProcess.replace(/"(author_id|id)":\s*(\d+)/g, '"$1": "$2"');
            this.push(fixed);
        } else {
            this.tail = data;
        }
        callback();
    }
    _flush(callback: any) {
        if (this.tail) {
            const fixed = this.tail.replace(/"(author_id|id)":\s*(\d+)/g, '"$1": "$2"');
            this.push(fixed);
        }
        callback();
    }
}


interface DiscordMessage {
    id: string | number;
    timestamp: string;
    author_id: string | number;
    author_name: string;
    content: string;
    is_pinned: boolean;
}

export async function importDiscordJson(filePath: string, serverId: string, profileCache: Set<string> = new Set()) {
    try {
        const baseName = path.basename(filePath, '.json');
        const parts = baseName.split('-');
        let channelId = Date.now().toString() + Math.random().toString().slice(2, 6);
        let channelName = 'imported-channel';

        if (parts.length >= 3 && parts[0] === 'History') {
            channelId = parts[parts.length - 1];
            channelName = parts.slice(1, parts.length - 1).join('-');
        }

        // Ensure the Channel exists
        await dbManager.runServerQuery(serverId,
            `INSERT OR IGNORE INTO channels (id, server_id, name) VALUES (?, ?, ?)`,
            [channelId, serverId, channelName]
        );

        console.log(`Streaming import for "${channelName}"...`);

        let profileInserts: any[][] = [];
        let messageInserts: any[][] = [];
        const BATCH_SIZE = 1000;
        let count = 0;

        const processBatch = async (profiles: any[][], messages: any[][]) => {
            if (profiles.length === 0 && messages.length === 0) return;

            await dbManager.beginTransaction(serverId);
            try {
                if (profiles.length > 0) {
                    await dbManager.runBatch(serverId,
                        `INSERT OR IGNORE INTO profiles (id, server_id, original_username, nickname, avatar, role, aliases) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        profiles
                    );
                }
                if (messages.length > 0) {
                    await dbManager.runBatch(serverId,
                        `INSERT OR IGNORE INTO messages (id, channel_id, author_id, content, timestamp, is_pinned) VALUES (?, ?, ?, ?, ?, ?)`,
                        messages
                    );
                }
                await dbManager.commit(serverId);
            } catch (err) {
                await dbManager.rollback(serverId);
                throw err;
            }
        };


        // Create stream pipeline
        const arrayStream = StreamArray.withParserAsStream();
        const idFixer = new DiscordIdFixer();

        // Use a simple Transform to handle message processing so pipeline() works correctly
        const processor = new Transform({
            objectMode: true,
            async transform(data: { key: number, value: DiscordMessage }, encoding, callback) {
                try {
                    const msg = data.value;
                    const authorId = msg.author_id.toString();
                    const msgId = msg.id.toString();

                    if (!profileCache.has(authorId)) {
                        profileInserts.push([authorId, serverId, msg.author_name, msg.author_name, '', 'USER', authorId]);
                        profileCache.add(authorId);
                    }

                    messageInserts.push([msgId, channelId, authorId, msg.content, msg.timestamp, msg.is_pinned ? 1 : 0]);
                    count++;

                    if (messageInserts.length >= BATCH_SIZE) {
                        const p = profileInserts;
                        const m = messageInserts;
                        profileInserts = [];
                        messageInserts = [];
                        await withServerLock(serverId, () => processBatch(p, m));
                    }
                    callback();


                } catch (err) {
                    callback(err as Error);
                }
            },
            async flush(callback) {
                try {
                    await withServerLock(serverId, () => processBatch(profileInserts, messageInserts));
                    callback();
                } catch (err) {
                    callback(err as Error);
                }
            }


        });

        await streamPipeline(
            fs.createReadStream(filePath),
            idFixer,
            arrayStream,
            processor
        );
        
        console.log(`Successfully imported channel "#${channelName}" (${count} messages)!`);

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
        await dbManager.initializeServerBundle(serverId, serverName, '');

        console.log(`Created server bundle "${serverName}" (${serverId}). Importing ${jsonFiles.length} channels...`);

        // Shared cache for profiles within the server context
        const profileCache: Set<string> = new Set();
        
        // Import channels in parallel with a controlled concurrency limit
        const CONCURRENCY_LIMIT = 4;
        const activePromises: Set<Promise<any>> = new Set();

        for (const file of jsonFiles) {
            const fullPath = path.join(dirPath, file);
            const promise = importDiscordJson(fullPath, serverId, profileCache).finally(() => {
                activePromises.delete(promise);
            });
            
            activePromises.add(promise);
            if (activePromises.size >= CONCURRENCY_LIMIT) {
                await Promise.race(activePromises);
            }
        }
        await Promise.all(activePromises);


        console.log(`Finished importing directory: ${dirPath}`);
    } catch (error) {
        console.error('Failed to import directory:', error);
    }
}
