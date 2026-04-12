import fs from 'fs';
import path from 'path';
import { Transform, pipeline } from 'stream';
import { promisify } from 'util';
import StreamArray from '../node_modules/stream-json/src/streamers/stream-array.js';
import dbManager, { DATA_DIR, SERVERS_DIR } from './database';
import { downloadAvatar } from './media/downloader';

/**
 * Abstracted file operations for unit testing and graceful error handling.
 */
export const fileOps = {
    copyFileSync: (src: string, dest: string) => {
        fs.copyFileSync(src, dest);
    },
    mkdirSync: (dir: string) => {
        fs.mkdirSync(dir, { recursive: true });
    },
    existsSync: (path: string) => {
        return fs.existsSync(path);
    }
};

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
    attachments?: string[];
    embeds?: any[];
    reactions?: Array<{
        emoji: string;
        count: number;
        users?: Array<{ id: string | number; name: string }>;
    }>;
}

interface ChannelMetadata {
    id: string | number;
    name: string;
    topic?: string | null;
    position?: number;
    category_id?: string | number | null;
    nsfw?: boolean;
}

interface GuildRole {
    id: string | number;
    name: string;
    color: string;
    position: number;
    permissions: string | number;
}

interface GuildMember {
    id: string | number;
    name: string;
    global_name: string | null;
    nickname: string | null;
    avatar_url: string | null;
    server_avatar_url: string | null;
    bot: boolean;
    roles: (string | number)[];
}

interface GuildEmoji {
    id: string | number;
    name: string;
    url: string;
    animated: boolean;
}

interface GuildCategory {
    id: string | number;
    name: string;
    position: number;
}

export interface GuildMetadata {
    id: string | number;
    name: string;
    owner_id: string | number;
    description: string | null;
    icon_url: string | null;
    roles: GuildRole[];
    members: GuildMember[];
    emojis: GuildEmoji[];
    categories: GuildCategory[];
}

/**
 * Extracts and fixes Discord IDs in a JSON string, then parses it.
 */
export function parseGuildMetadata(json: string): GuildMetadata {
    const fixedJson = json.replace(/"(id|owner_id|author_id|category_id|role_id)":\s*(\d+)/g, '"$1": "$2"');
    return JSON.parse(fixedJson);
}

export async function importDiscordJson(filePath: string, serverId: string, channelId: string, profileCache: Set<string> = new Set()) {
    try {
        // Channel creation is now handled in importDirectory via channel_metadata.json

        const mediaSourceDir = path.join(path.dirname(filePath), 'media');
        const uploadsDestDir = path.resolve(SERVERS_DIR, serverId, 'uploads', 'channels', channelId);

        // Ensure destination folder exists
        try {
            fileOps.mkdirSync(uploadsDestDir);
        } catch (err) {
            console.error(`Failed to create uploads directory: ${uploadsDestDir}`, err);
        }

        console.log(`Streaming import for channel ID ${channelId}...`);

        let profileInserts: any[][] = [];
        let messageInserts: any[][] = [];
        let reactionInserts: any[][] = [];
        const BATCH_SIZE = 1000;
        let count = 0;

        const processBatch = async (profiles: any[][], messages: any[][], reactions: any[][]) => {
            if (profiles.length === 0 && messages.length === 0 && reactions.length === 0) return;

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
                        `INSERT OR IGNORE INTO messages (id, channel_id, author_id, content, timestamp, is_pinned, attachments, embeds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        messages
                    );
                }
                if (reactions.length > 0) {
                    await dbManager.runBatch(serverId,
                        `INSERT OR IGNORE INTO message_reactions (message_id, author_id, emoji) VALUES (?, ?, ?)`,
                        reactions
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

                    // Handle Attachments
                    const finalAttachments: string[] = [];
                    if (msg.attachments && Array.isArray(msg.attachments)) {
                        for (const fileName of msg.attachments) {
                            // fileName might be "media/xyz.png" or just "xyz.png" or a URL
                            const cleanFileName = fileName.replace(/^media\//, '');
                            const srcPath = path.join(mediaSourceDir, cleanFileName);

                            if (fileOps.existsSync(srcPath)) {
                                const destPath = path.join(uploadsDestDir, cleanFileName);
                                try {
                                    fileOps.copyFileSync(srcPath, destPath);
                                    finalAttachments.push(`/uploads/${serverId}/channels/${channelId}/${cleanFileName}`);
                                } catch (copyErr) {
                                    console.warn(`[Importer] Failed to copy local file ${cleanFileName}:`, copyErr);
                                }
                            } else if (fileName.startsWith('http')) {
                                finalAttachments.push(fileName);
                            }
                        }
                    }

                    messageInserts.push([
                        msgId, 
                        channelId, 
                        authorId, 
                        msg.content, 
                        msg.timestamp, 
                        msg.is_pinned ? 1 : 0, 
                        JSON.stringify(finalAttachments),
                        JSON.stringify(msg.embeds || [])
                    ]);

                    // Handle Reactions
                    if (msg.reactions && Array.isArray(msg.reactions)) {
                        for (const reaction of msg.reactions) {
                            if (reaction.users && reaction.users.length > 0) {
                                for (const user of reaction.users) {
                                    reactionInserts.push([msgId, user.id.toString(), reaction.emoji]);
                                }
                            } else if (reaction.count > 0) {
                                // Fallback: Assign to predefined "System" account. 
                                // To satisfy "distributed evenly" requirement for missing users, 
                                // we use a range of system IDs (0, 0-1, 0-2...) relative to the count
                                // ensuring unique PKs in the message_reactions table.
                                for (let i = 0; i < reaction.count; i++) {
                                    const systemId = i === 0 ? '0' : `0-${i}`;
                                    reactionInserts.push([msgId, systemId, reaction.emoji]);
                                }
                            }
                        }
                    }

                    count++;

                    if (messageInserts.length >= BATCH_SIZE || reactionInserts.length >= BATCH_SIZE) {
                        const p = profileInserts;
                        const m = messageInserts;
                        const r = reactionInserts;
                        profileInserts = [];
                        messageInserts = [];
                        reactionInserts = [];
                        await withServerLock(serverId, () => processBatch(p, m, r));
                    }
                    callback();


                } catch (err) {
                    callback(err as Error);
                }
            },
            async flush(callback) {
                try {
                    await withServerLock(serverId, () => processBatch(profileInserts, messageInserts, reactionInserts));
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
        
        console.log(`Successfully imported channel ID ${channelId} (${count} messages)!`);

    } catch (error) {
        console.error(`Failed to import JSON file ${filePath}:`, error);
    }
}


export async function importDirectory(dirPath: string, serverName: string) {
    try {
        const metadataPath = path.join(dirPath, 'guild_metadata.json');
        if (!fs.existsSync(metadataPath)) {
            // Check if we are in the root or one level up
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const serverDir = entries.find(e => e.isDirectory() && e.name.includes('-') && fs.existsSync(path.join(dirPath, e.name, 'guild_metadata.json')));
            if (serverDir) {
                return importDirectory(path.join(dirPath, serverDir.name), serverName);
            }
            console.error('guild_metadata.json not found in directory:', dirPath);
            
            // Legacy flat directory import fallback
            const files = fs.readdirSync(dirPath);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            if (jsonFiles.length === 0) return;

            const serverId = 'server-' + Date.now().toString();
            await dbManager.initializeServerBundle(serverId, serverName, '');
            console.log(`Fallback: Created legacy server bundle "${serverName}" (${serverId}). Importing ${jsonFiles.length} channels...`);

            const profileCache: Set<string> = new Set();
            const CONCURRENCY_LIMIT = 4;
            const activePromises: Set<Promise<any>> = new Set();

            for (const file of jsonFiles) {
                const fullPath = path.join(dirPath, file);
                const promise = importDiscordJson(fullPath, serverId, 'legacy-id', profileCache).finally(() => {
                    activePromises.delete(promise);
                });
                activePromises.add(promise);
                if (activePromises.size >= CONCURRENCY_LIMIT) await Promise.race(activePromises);
            }
            await Promise.all(activePromises);
            return;
        }

        const metadataRaw = fs.readFileSync(metadataPath, 'utf8');
        const metadata = parseGuildMetadata(metadataRaw);

        const serverId = metadata.id.toString();
        const name = metadata.name || serverName;

        console.log(`Ingesting guild metadata for "${name}" (${serverId})...`);

        await dbManager.initializeServerBundle(serverId, name, metadata.icon_url || '', metadata.owner_id.toString(), metadata.description || '');

        // 1. Roles
        if (metadata.roles && metadata.roles.length > 0) {
            const roleParams = metadata.roles.map(r => [r.id.toString(), serverId, r.name, r.color, r.permissions, r.position]);
            await dbManager.runBatch(serverId, `INSERT OR IGNORE INTO roles (id, server_id, name, color, permissions, position) VALUES (?, ?, ?, ?, ?, ?)`, roleParams);
        }

        // 2. Members (Global Discord Users & Server Profiles)
        const profileCache: Set<string> = new Set();
        if (metadata.members && metadata.members.length > 0) {
            const profileBatch: any[][] = [];
            for (const m of metadata.members) {
                const id = m.id.toString();
                const displayName = m.global_name || m.name;
                const nickname = m.nickname || displayName;

                // A. Node DB: imported_discord_users (Keep node query in loop for simplicity as runBatch is server-only)
                let globalAvatarPath: string | null = null;
                if (m.avatar_url) {
                    globalAvatarPath = await downloadAvatar(m.avatar_url, 'global', id);
                }

                await dbManager.runNodeQuery(
                    `INSERT OR IGNORE INTO imported_discord_users (id, global_name, avatar) VALUES (?, ?, ?)`,
                    [id, displayName, globalAvatarPath]
                );

                // B. Server DB: profiles
                let serverAvatarPath: string | null = null;
                if (m.server_avatar_url) {
                    serverAvatarPath = await downloadAvatar(m.server_avatar_url, 'server', id, serverId);
                } else if (globalAvatarPath) {
                    // Fallback Rule: Copy global avatar to server avatar directory
                    const ext = path.extname(globalAvatarPath);
                    // Remove leading slash for path.join to ensure it's treated as relative
                    const cleanGlobalPath = globalAvatarPath.startsWith('/') ? globalAvatarPath.slice(1) : globalAvatarPath;
                    const globalFile = path.join(DATA_DIR, cleanGlobalPath);
                    const serverAvatarsDir = path.join(DATA_DIR, 'servers', serverId, 'avatars');
                    if (!fileOps.existsSync(serverAvatarsDir)) fileOps.mkdirSync(serverAvatarsDir);
                    
                    const serverFile = path.join(serverAvatarsDir, `${id}${ext}`);
                    try {
                        if (fileOps.existsSync(globalFile)) {
                            fileOps.copyFileSync(globalFile, serverFile);
                            serverAvatarPath = `/servers/${serverId}/avatars/${id}${ext}`;
                        }
                    } catch (err) {
                        console.error(`[Importer] Failed to fallback copy avatar for ${id}:`, err);
                    }
                }

                profileBatch.push([id, serverId, m.name, nickname, serverAvatarPath, 'USER', id]);
                profileCache.add(id);
            }

            if (profileBatch.length > 0) {
                await dbManager.runBatch(serverId, `INSERT OR REPLACE INTO profiles (id, server_id, original_username, nickname, avatar, role, aliases) VALUES (?, ?, ?, ?, ?, ?, ?)`, profileBatch);
            }

            // 3. Profile Roles
            const profileRoleParams: any[][] = [];
            const validRoleIds = new Set((metadata.roles || []).map(r => r.id.toString()));
            metadata.members.forEach(m => {
                if (m.roles) {
                    m.roles.forEach(roleId => {
                        if (validRoleIds.has(roleId.toString())) {
                            profileRoleParams.push([m.id.toString(), serverId, roleId.toString()]);
                        } else {
                            console.warn(`[Importer] Skipping unknown role ${roleId} for member ${m.id}`);
                        }
                    });
                }
            });
            if (profileRoleParams.length > 0) {
                await dbManager.runBatch(serverId, `INSERT OR IGNORE INTO profile_roles (profile_id, server_id, role_id) VALUES (?, ?, ?)`, profileRoleParams);
            }
        }

        // 4. Emojis
        if (metadata.emojis && metadata.emojis.length > 0) {
            const emojiParams = metadata.emojis.map(e => [e.id.toString(), serverId, e.name, e.url, e.animated ? 1 : 0]);
            await dbManager.runBatch(serverId, `INSERT OR IGNORE INTO server_emojis (id, server_id, name, url, animated) VALUES (?, ?, ?, ?, ?)`, emojiParams);
        }

        // 5. Categories
        if (metadata.categories && metadata.categories.length > 0) {
            const categoryParams = metadata.categories.map(c => [c.id.toString(), serverId, c.name, c.position]);
            await dbManager.runBatch(serverId, `INSERT OR IGNORE INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)`, categoryParams);
        }

        // Channel discovery
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const channelDirs = entries.filter(e => e.isDirectory() && e.name.includes('-'));

        const CONCURRENCY_LIMIT = 4;
        const activePromises: Set<Promise<any>> = new Set();

        const validCategoryIds = new Set(metadata.categories?.map(c => c.id.toString()) || []);
        for (const entry of channelDirs) {
            const channelPath = path.join(dirPath, entry.name);
            const channelMetadataPath = path.join(channelPath, 'channel_metadata.json');
            const messagesPath = path.join(channelPath, 'messages.json');

            if (!fs.existsSync(channelMetadataPath) || !fs.existsSync(messagesPath)) continue;

            const promise = (async () => {
                try {
                    const channelMetadata: ChannelMetadata = JSON.parse(fs.readFileSync(channelMetadataPath, 'utf8').replace(/"(id|category_id)":\s*(\d+)/g, '"$1": "$2"'));
                    const channelId = channelMetadata.id.toString();
                    
                    let categoryId = channelMetadata.category_id?.toString() || null;
                    if (categoryId && !validCategoryIds.has(categoryId)) {
                        console.warn(`[Importer] Nullifying unknown category ${categoryId} for channel ${channelId}`);
                        categoryId = null;
                    }

                    await dbManager.runServerQuery(serverId,
                        `INSERT OR IGNORE INTO channels (id, server_id, category_id, name, topic, nsfw, position) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            channelId,
                            serverId,
                            categoryId,
                            channelMetadata.name,
                            channelMetadata.topic || null,
                            channelMetadata.nsfw ? 1 : 0,
                            channelMetadata.position || 0
                        ]
                    );

                    await importDiscordJson(messagesPath, serverId, channelId, profileCache);
                } catch (err) {
                    console.error(`Failed to import channel ${entry.name}:`, err);
                }
            })();
            
            activePromises.add(promise);
            promise.finally(() => activePromises.delete(promise));

            if (activePromises.size >= CONCURRENCY_LIMIT) {
                await Promise.race(activePromises);
            }
        }
        await Promise.all(activePromises);

        console.log(`Finished importing server: ${name}`);
    } catch (error) {
        console.error('Failed to import directory:', error);
    }
}
