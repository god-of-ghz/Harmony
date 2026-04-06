import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireRole, isCreator, requirePermission, Permission } from './middleware/rbac';
import { DATA_DIR } from './database';

export const createApp = (db: any, broadcastMessage: (v: any) => void) => {
    const app = express();
    app.use(cors());
    app.use(express.json());

    // Static serving for attachments — derived from DATA_DIR so mocks can override it
    const uploadsBase = path.join(DATA_DIR, 'servers');
    app.use('/uploads/:serverId', (req, res, next) => {
        const { serverId } = req.params;
        const serverUploads = path.join(uploadsBase, serverId, 'uploads');
        express.static(serverUploads)(req, res, next);
    });

    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', time: new Date().toISOString() });
    });

    app.get('/api/servers', async (req, res) => {
        try {
            const servers = await db.getAllLoadedServers();
            res.json(servers);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/servers/:serverId/channels', async (req, res) => {
        try {
            const { serverId } = req.params;
            const channels = await db.allServerQuery(serverId, 'SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC', [serverId]);
            res.json(channels);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/servers/:serverId', requireRole(['OWNER']), async (req, res) => {
        try {
            const { serverId } = req.params;
            // The node DB doesn't have a servers table; we scan folders. 
            // So we just unload the DB instance and return success. 
            // The caller handles UI/filesystem removal if needed (though the API usually shouldn't delete folders unless it's a destroy-everything op).
            db.unloadServerInstance(serverId);
            res.json({ success: true, message: 'Server deleted successfully' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/servers/:serverId/rename', requireRole(['OWNER']), async (req, res) => {
        try {
            const { serverId } = req.params;
            const { name } = req.body;
            await db.runNodeQuery('UPDATE servers SET name = ? WHERE id = ?', [name, serverId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/servers', async (req, res) => {
        try {
            const { name } = req.body;
            const id = 'server-' + crypto.randomUUID();
            await db.initializeServerBundle(id, name || 'Unnamed Server', '');
            
            // Seed default category and channel
            const categoryId = crypto.randomUUID();
            await db.runServerQuery(id, 'INSERT INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)', [categoryId, id, 'Text Channels', 0]);
            const channelId = crypto.randomUUID();
            await db.runServerQuery(id, 'INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, ?)', [channelId, id, categoryId, 'general', 'text', 0]);

            const accountId = req.headers['x-account-id'] as string;
            if (accountId) {
                const id_profile = crypto.randomUUID();
                const account: any = await db.getNodeQuery('SELECT email FROM accounts WHERE id = ?', [accountId]);
                const nickname = account?.email?.split('@')[0] || 'Creator';
                await db.runServerQuery(id, 'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role) VALUES (?, ?, ?, ?, ?, ?, ?)', [id_profile, id, accountId, nickname, nickname, '', 'OWNER']);
                
                const creatorProfile = await db.getServerQuery(id, 'SELECT * FROM profiles WHERE id = ? AND server_id = ?', [id_profile, id]);
                broadcastMessage({ type: 'PROFILE_UPDATE', data: creatorProfile });
            }

            const newServer = await db.getServerQuery(id, 'SELECT * FROM servers WHERE id = ?', [id]);
            res.json(newServer);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/servers/:serverId/channels', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { serverId } = req.params;
            const { name, categoryId } = req.body;
            const id = crypto.randomUUID();
            await db.runServerQuery(serverId, 'INSERT INTO channels (id, server_id, category_id, name) VALUES (?, ?, ?, ?)', [id, serverId, categoryId || null, name]);
            const newChannel = await db.getServerQuery(serverId, 'SELECT * FROM channels WHERE id = ?', [id]);
            res.json(newChannel);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/servers/:serverId/categories', async (req, res) => {
        try {
            const { serverId } = req.params;
            const categories = await db.allServerQuery(serverId, 'SELECT * FROM channel_categories WHERE server_id = ? ORDER BY position ASC', [serverId]);
            res.json(categories);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/servers/:serverId/categories', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { serverId } = req.params;
            const { name, position } = req.body;
            const id = crypto.randomUUID();
            await db.runServerQuery(serverId, 'INSERT INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)', [id, serverId, name, position || 0]);
            const newCategory = await db.getServerQuery(serverId, 'SELECT * FROM channel_categories WHERE id = ?', [id]);
            res.json(newCategory);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/channels/:channelId/category', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { channelId } = req.params;
            const { categoryId, serverId } = req.body;
            await db.runServerQuery(serverId, 'UPDATE channels SET category_id = ? WHERE id = ?', [categoryId || null, channelId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/categories/:categoryId', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { categoryId } = req.params;
            const { name, serverId } = req.body;
            await db.runServerQuery(serverId, 'UPDATE channel_categories SET name = ? WHERE id = ?', [name, categoryId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/categories/:categoryId', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { categoryId } = req.params;
            const serverId = req.query.serverId as string || req.body.serverId;
            await db.runServerQuery(serverId, 'DELETE FROM channel_categories WHERE id = ?', [categoryId]);
            res.json({ success: true, message: 'Category deleted' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/servers/:serverId/reorder', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { categories, channels } = req.body;
            const { serverId } = req.params;
            if (categories && categories.length > 0) {
                for (const cat of categories) {
                    await db.runServerQuery(serverId, 'UPDATE channel_categories SET position = ? WHERE id = ?', [cat.position, cat.id]);
                }
            }
            if (channels && channels.length > 0) {
                for (const ch of channels) {
                    await db.runServerQuery(serverId, 'UPDATE channels SET position = ?, category_id = ? WHERE id = ?', [ch.position, ch.categoryId || null, ch.id]);
                }
            }
            res.json({ success: true, message: 'Reordered' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * findServerId: Scans all loaded server DBs for a channel by ID.
     * Replaces the old resource_map approach (table doesn't exist in schema).
     */
    const findServerId = async (_table: string, id: string): Promise<string | null> => {
        try {
            const servers = await db.getAllLoadedServers();
            for (const server of servers) {
                const row: any = await db.getServerQuery(server.id, 'SELECT * FROM channels WHERE id = ?', [id]);
                if (row) return row.server_id;
            }
        } catch (e) {}
        return null;
    };

    app.patch('/api/channels/:channelId', requirePermission(Permission.MANAGE_CHANNELS), async (req, res) => {
        try {
            const { channelId } = req.params;
            const { name } = req.body;
            const serverId = req.query.serverId as string || req.body.serverId as string || await findServerId('channels', channelId as string);
            if (!serverId) return res.status(404).json({error: "Server Not found"});
            
            await db.runServerQuery(serverId, 'UPDATE channels SET name = ? WHERE id = ?', [name, channelId]);
            const updated = await db.getServerQuery(serverId, 'SELECT * FROM channels WHERE id = ?', [channelId]);
            res.json(updated);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/channels/:channelId', requirePermission(Permission.MANAGE_CHANNELS), async (req, res) => {
        try {
            const { channelId } = req.params;
            const serverId = req.query.serverId as string || req.body.serverId as string || await findServerId('channels', channelId as string);
            if (!serverId) return res.status(404).json({error: "Server Not found"});
            
            await db.runServerQuery(serverId, 'DELETE FROM channels WHERE id = ?', [channelId]);
            res.json({ success: true, message: 'Channel deleted' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/channels/:channelId/messages', async (req, res) => {
        try {
            const { channelId } = req.params;
            const serverId = req.query.serverId as string || await findServerId('channels', channelId);
            if (!serverId) return res.status(404).json({ error: "Server context not found for channel" });

            const limit = parseInt(req.query.limit as string) || 100;
            const cursor = req.query.cursor as string; // timestamp

            let sql = `SELECT m.*, 
                              COALESCE(p.nickname, 'UnknownProfile') as username, 
                              COALESCE(p.avatar, '') as avatar, 
                              p.account_id,
                              rp.nickname as replied_author,
                              rm.content as replied_content
                       FROM messages m 
                       JOIN channels c ON m.channel_id = c.id
                       LEFT JOIN profiles p ON m.author_id = p.id AND c.server_id = p.server_id
                       LEFT JOIN messages rm ON m.reply_to = rm.id
                       LEFT JOIN profiles rp ON rm.author_id = rp.id AND c.server_id = rp.server_id
                       WHERE m.channel_id = ?`;
            const params: any[] = [channelId];

            if (cursor) {
                sql += ` AND m.timestamp < ?`;
                params.push(cursor);
            }

            sql += ` ORDER BY m.timestamp DESC LIMIT ?`;
            params.push(limit);

            const messages = await db.allServerQuery(serverId, sql, params);
            
            // Stitch in public_keys from account DB for identity verification
            const accountIds = [...new Set(messages.map((m: any) => m.account_id).filter(Boolean))];
            let accountMap: Record<string, string> = {};
            if (accountIds.length > 0) {
                const placeholders = accountIds.map(() => '?').join(', ');
                const accounts = await db.allNodeQuery(`SELECT id, public_key FROM accounts WHERE id IN (${placeholders})`, accountIds);
                for (const acc of accounts) {
                    accountMap[acc.id] = acc.public_key;
                }
            }

            const result = messages.map((m: any) => ({
                ...m,
                public_key: accountMap[m.account_id] || ''
            }));

            res.json(result.reverse()); // Reverse to return chronologically ASC
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/channels/:channelId/messages/:messageId', async (req, res) => {
        try {
            const { channelId, messageId } = req.params;
            const accountId = req.headers['x-account-id'] as string;
            const serverId = req.query.serverId as string || await findServerId('channels', channelId);
            if (!serverId) return res.status(404).json({ error: "Server context not found" });

            const message: any = await db.getServerQuery(serverId, 'SELECT author_id FROM messages WHERE id = ?', [messageId]);
            if (!message) return res.status(404).json({ error: 'Message not found' });

            const profile: any = await db.getServerQuery(serverId, 'SELECT id FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, serverId]);
            const isAuthor = profile && message.author_id === profile.id;

            // Check if user has MANAGE_MESSAGES permission via roles
            let hasPerm = isAuthor;
            if (!hasPerm && profile) {
                const roles: any[] = await db.allServerQuery(serverId,
                    `SELECT r.permissions FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = ? AND pr.server_id = ?`,
                    [profile.id, serverId]
                );
                let perm = 0;
                for (const r of roles) perm |= r.permissions;
                hasPerm = (perm & Permission.MANAGE_MESSAGES) !== 0 || (perm & Permission.ADMINISTRATOR) !== 0;
            }

            // Global admin/creator bypass
            const account: any = await db.getNodeQuery('SELECT is_creator, is_admin FROM accounts WHERE id = ?', [accountId]);
            if (account && (account.is_creator || account.is_admin)) hasPerm = true;

            if (!hasPerm) return res.status(403).json({ error: 'Forbidden' });

            await db.runServerQuery(serverId, 'DELETE FROM messages WHERE id = ?', [messageId]);
            broadcastMessage({ type: 'MESSAGE_DELETE', data: { message_id: messageId, channel_id: channelId } });
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/channels/:channelId/messages/:messageId/reactions', async (req, res) => {
        try {
            const { channelId, messageId } = req.params;
            const { emoji } = req.body;
            const accountId = req.headers['x-account-id'] as string;
            const serverId = req.query.serverId as string || await findServerId('channels', channelId);
            if (!serverId) return res.status(404).json({ error: "Server context not found" });

            const profile: any = await db.getServerQuery(serverId, 'SELECT id FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, serverId]);
            if (!profile) return res.status(403).json({ error: "Not a member of this server" });

            await db.runServerQuery(serverId, 'INSERT OR IGNORE INTO message_reactions (message_id, author_id, emoji) VALUES (?, ?, ?)', [messageId, profile.id, emoji]);
            const reactionData = { message_id: messageId, author_id: profile.id, emoji, channel_id: channelId };
            broadcastMessage({ type: 'REACTION_ADD', data: reactionData });
            res.json(reactionData);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/channels/:channelId/messages/:messageId/reactions/:emoji', async (req, res) => {
        try {
            const { channelId, messageId, emoji } = req.params;
            const accountId = req.headers['x-account-id'] as string;
            const serverId = req.query.serverId as string || await findServerId('channels', channelId);
            if (!serverId) return res.status(404).json({ error: "Server context not found" });

            const profile: any = await db.getServerQuery(serverId, 'SELECT id FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, serverId]);
            if (!profile) return res.status(403).json({ error: "Not a member of this server" });

            await db.runServerQuery(serverId, 'DELETE FROM message_reactions WHERE message_id = ? AND author_id = ? AND emoji = ?', [messageId, profile.id, emoji]);
            broadcastMessage({ type: 'REACTION_REMOVE', data: { message_id: messageId, author_id: profile.id, emoji, channel_id: channelId } });
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/servers/:serverId/profiles', async (req, res) => {
        try {
            const { serverId } = req.params;
            const profiles = await db.allServerQuery(serverId, 'SELECT * FROM profiles WHERE server_id = ?', [serverId]);
            res.json(profiles);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/servers/:serverId/profiles', async (req, res) => {
        try {
            const { serverId } = req.params;
            const { accountId, nickname, isGuest } = req.body;
            const id = crypto.randomUUID();
            await db.runServerQuery(serverId,
                `INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, serverId, isGuest ? null : accountId, nickname, nickname, '', 'ADMIN']
            );
            const newProfile = await db.getServerQuery(serverId, 'SELECT * FROM profiles WHERE id = ? AND server_id = ?', [id, serverId]);
            broadcastMessage({ type: 'PROFILE_UPDATE', data: newProfile });
            res.json(newProfile);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/channels/:channelId/messages', async (req, res) => {
        const { channelId } = req.params;
        const { content, authorId, signature, attachments, reply_to } = req.body;
        const id = Date.now().toString();
        const timestamp = new Date().toISOString();

        try {
            const serverId = req.query.serverId as string || await findServerId('channels', channelId);
            if (!serverId) return res.status(404).json({ error: "Server context not found" });

            await db.runServerQuery(serverId,
                `INSERT INTO messages (id, channel_id, author_id, content, timestamp, is_pinned, signature, attachments, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, channelId, authorId, content, timestamp, 0, signature || '', attachments || '[]', reply_to || null]
            );
            const author: any = await db.getServerQuery(serverId, 'SELECT nickname as username, avatar, account_id FROM profiles WHERE id = ? AND server_id = ?', [authorId, serverId]);
            
            // Stitch in public_key for signature verification
            let public_key = '';
            if (author?.account_id) {
                const acc: any = await db.getNodeQuery('SELECT public_key FROM accounts WHERE id = ?', [author.account_id]);
                public_key = acc?.public_key || '';
            }

            let repliedAuthor = null;
            let repliedContent = null;
            if (reply_to) {
                const rm: any = await db.getServerQuery(serverId, 
                    `SELECT m.content, p.nickname as author 
                     FROM messages m 
                     JOIN channels c ON m.channel_id = c.id
                     LEFT JOIN profiles p ON m.author_id = p.id AND c.server_id = p.server_id
                     WHERE m.id = ?`, [reply_to]);
                if (rm) {
                    repliedAuthor = rm.author;
                    repliedContent = rm.content;
                }
            }

            const newMessage = {
                id, channel_id: channelId, author_id: authorId, content, timestamp, is_pinned: 0,
                username: author?.username || 'UnknownProfile', avatar: author?.avatar || '',
                signature: signature || '', attachments: attachments || '[]', public_key,
                reply_to: reply_to || null,
                replied_author: repliedAuthor,
                replied_content: repliedContent
            };
            broadcastMessage({ type: 'NEW_MESSAGE', data: newMessage });
            if (author?.account_id) {
                broadcastMessage({ type: 'TYPING_STOP', data: { channelId, accountId: author.account_id } });
            }
            res.json(newMessage);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/servers/:serverId/roles', async (req, res) => {
        try {
            const { serverId } = req.params;
            const roles = await db.allServerQuery(serverId, 'SELECT * FROM roles WHERE server_id = ? ORDER BY position ASC', [serverId]);
            res.json(roles);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/servers/:serverId/roles', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { serverId } = req.params;
            const { name, color, permissions, position } = req.body;
            const id = crypto.randomUUID();
            await db.runServerQuery(serverId, 'INSERT INTO roles (id, server_id, name, color, permissions, position) VALUES (?, ?, ?, ?, ?, ?)', [id, serverId, name, color || '#99aab5', permissions || 0, position || 0]);
            const newRole = await db.getServerQuery(serverId, 'SELECT * FROM roles WHERE id = ?', [id]);
            res.json(newRole);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/servers/:serverId/profiles/:profileId/roles', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { serverId, profileId } = req.params;
            const { roleId } = req.body;
            await db.runServerQuery(serverId, 'INSERT INTO profile_roles (profile_id, server_id, role_id) VALUES (?, ?, ?)', [profileId, serverId, roleId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // Allowed MIME types for attachments
    const ALLOWED_MIME_TYPES = new Set([
        'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
        'video/mp4', 'video/webm',
        'audio/mpeg', 'audio/ogg', 'audio/wav',
        'application/pdf',
        'text/plain',
    ]);

    app.post('/api/servers/:serverId/attachments', requirePermission(Permission.ATTACH_FILES), multer().array('files'), async (req, res) => {
        try {
            const serverId = req.params.serverId as string;
            const files = req.files as any[];
            if (!files || files.length === 0) return res.status(400).json({ error: "No files provided" });

            const serverDir = path.join(DATA_DIR, 'servers', serverId);
            const uploadsDir = path.join(serverDir, 'uploads');
            if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

            // Validate file types using `file-type` (magic byte inspection)
            const fileType = await import('file-type');
            const fromBuffer = fileType.fromBuffer || (fileType as any).fileTypeFromBuffer;
            const urls = [];
            for (const file of files) {
                const detected = await fromBuffer(file.buffer);
                if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
                    return res.status(400).json({ error: `Rejected dangerous file type: ${detected?.mime ?? 'unknown'} for file ${file.originalname}` });
                }

                const filename = `${Date.now()}-${file.originalname}`;
                const filePath = path.join(uploadsDir, filename);
                fs.writeFileSync(filePath, file.buffer);
                urls.push(`/uploads/${serverId}/${filename}`);
            }

            res.json({ success: true, urls });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/accounts/owner-exists', async (req, res) => {
        try {
            const owner: any = await db.getNodeQuery('SELECT id FROM accounts WHERE is_creator = 1 LIMIT 1');
            res.json({ exists: !!owner });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/signup', async (req, res) => {
        const { email, serverAuthKey, public_key, encrypted_private_key, key_salt, key_iv, claimOwnership } = req.body;
        const id = crypto.randomUUID();
        try {
            // Check for key collision
            const existing: any = await db.getNodeQuery('SELECT id FROM accounts WHERE email = ?', [email]);
            if (existing) return res.status(409).json({ error: "Email already exists" });
            
            let isCreator = 0;
            let isAdmin = 0;

            if (claimOwnership) {
                const owner: any = await db.getNodeQuery('SELECT id FROM accounts WHERE is_creator = 1 LIMIT 1');
                if (!owner) {
                    isCreator = 1;
                    isAdmin = 1;
                }
            }

            await db.runNodeQuery(
                `INSERT INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, email, serverAuthKey, public_key, encrypted_private_key, key_salt, key_iv, isCreator, isAdmin]
            );
            const account = await db.getNodeQuery('SELECT id, email, is_creator, is_admin FROM accounts WHERE id = ?', [id]);
            res.json(account);
        } catch (err: any) {
            console.error("Signup error:", err);
            res.status(500).json({ error: "Email already exists or error occurred" });
        }
    });

    app.post('/api/accounts/login', async (req, res) => {
        const { email, serverAuthKey, initialServerUrl } = req.body;
        try {
            let account: any = await db.getNodeQuery('SELECT * FROM accounts WHERE email = ?', [email]);
            if (account && account.auth_verifier === serverAuthKey) {
                const ts = await db.allNodeQuery('SELECT server_url FROM trusted_servers WHERE account_id = ?', [account.id]);
                return res.json({
                    id: account.id, email: account.email, is_creator: account.is_creator, is_admin: account.is_admin,
                    public_key: account.public_key, encrypted_private_key: account.encrypted_private_key,
                    key_salt: account.key_salt, key_iv: account.key_iv,
                    trusted_servers: ts.map((s: any) => s.server_url)
                });
            }

            // Attempt federation if an initial server URL is provided and local lookup failed
            if (initialServerUrl) {
                try {
                    const fedRes = await fetch(`${initialServerUrl}/api/accounts/federate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, serverAuthKey })
                    });
                    if (fedRes.ok) {
                        const { account: remoteAccount, trusted_servers } = await fedRes.json() as any;
                        // Upsert the federated account locally
                        await db.runNodeQuery(
                            `INSERT OR REPLACE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_admin, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [remoteAccount.id, remoteAccount.email, remoteAccount.auth_verifier, remoteAccount.public_key, remoteAccount.encrypted_private_key, remoteAccount.key_salt, remoteAccount.key_iv, remoteAccount.is_creator, remoteAccount.is_admin, remoteAccount.updated_at]
                        );
                        return res.json({
                            id: remoteAccount.id, email: remoteAccount.email, is_creator: remoteAccount.is_creator, is_admin: remoteAccount.is_admin,
                            trusted_servers: trusted_servers || []
                        });
                    }
                } catch (fedErr) {
                    console.error("Federation failed:", fedErr);
                }
            }

            res.status(401).json({ error: "Invalid credentials" });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/federate', async (req, res) => {
        const { email, serverAuthKey } = req.body;
        try {
            const account: any = await db.getNodeQuery('SELECT * FROM accounts WHERE email = ?', [email]);
            if (account && account.auth_verifier === serverAuthKey) {
                const servers = await db.allNodeQuery('SELECT server_url FROM trusted_servers WHERE account_id = ?', [account.id]);
                res.json({ account, trusted_servers: servers.map((s: any) => s.server_url) });
            } else {
                res.status(401).json({ error: "Invalid credentials" });
            }
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/sync', async (req, res) => {
        const { account, trusted_servers } = req.body;
        try {
            const existing: any = await db.getNodeQuery('SELECT updated_at FROM accounts WHERE id = ?', [account.id]);
            if (existing) {
                if (account.updated_at > existing.updated_at) {
                    await db.runNodeQuery(
                        'UPDATE accounts SET email = ?, auth_verifier = ?, public_key = ?, encrypted_private_key = ?, key_salt = ?, key_iv = ?, is_creator = ?, is_admin = ?, updated_at = ? WHERE id = ?',
                        [account.email, account.auth_verifier, account.public_key, account.encrypted_private_key, account.key_salt, account.key_iv, account.is_creator, account.is_admin, account.updated_at, account.id]
                    );
                } else {
                    return res.json({ success: true, message: 'Local is newer or same' });
                }
            } else {
                await db.runNodeQuery(
                    'INSERT INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_admin, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [account.id, account.email, account.auth_verifier, account.public_key, account.encrypted_private_key, account.key_salt, account.key_iv, account.is_creator, account.is_admin, account.updated_at]
                );
            }

            await db.runNodeQuery('DELETE FROM trusted_servers WHERE account_id = ?', [account.id]);
            for (const url of (trusted_servers || [])) {
                await db.runNodeQuery('INSERT INTO trusted_servers (account_id, server_url) VALUES (?, ?)', [account.id, url]);
            }
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/:accountId/trusted_servers', async (req, res) => {
        const { accountId } = req.params;
        const { serverUrl } = req.body;
        try {
            await db.runNodeQuery('INSERT OR IGNORE INTO trusted_servers (account_id, server_url) VALUES (?, ?)', [accountId, serverUrl]);
            await db.runNodeQuery("UPDATE accounts SET updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?", [accountId]);

            // Push the full updated account struct to the new peer
            const fullAccount: any = await db.getNodeQuery('SELECT * FROM accounts WHERE id = ?', [accountId]);
            const trustedList = await db.allNodeQuery('SELECT server_url FROM trusted_servers WHERE account_id = ?', [accountId]);

            try {
                await fetch(`${serverUrl}/api/accounts/sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account: fullAccount,
                        trusted_servers: trustedList.map((t: any) => t.server_url)
                    })
                });
            } catch (syncErr) {
                console.error(`Failed to push identity sync to ${serverUrl}:`, syncErr);
            }

            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/guest/login', async (req, res) => {
        try {
            const guestId = `guest-${crypto.randomUUID()}`;
            res.json({ id: guestId, email: 'Guest', is_creator: false, isGuest: true, trusted_servers: [] });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/guest/merge', async (req, res) => {
        const { profileId, serverId, accountId } = req.body;
        try {
            await db.runServerQuery(serverId, `UPDATE profiles SET account_id = ? WHERE id = ? AND server_id = ?`, [accountId, profileId, serverId]);
            const updated = await db.getServerQuery(serverId, 'SELECT * FROM profiles WHERE id = ? AND server_id = ?', [profileId, serverId]);
            broadcastMessage({ type: 'PROFILE_UPDATE', data: updated });
            res.json({ success: true, profileId });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/profiles/claim', async (req, res) => {
        const { profileId, serverId, accountId } = req.body;
        try {
            await db.runServerQuery(serverId, `UPDATE profiles SET account_id = ? WHERE id = ? AND server_id = ?`, [accountId, profileId, serverId]);
            const updated = await db.getServerQuery(serverId, 'SELECT * FROM profiles WHERE id = ? AND server_id = ?', [profileId, serverId]);
            broadcastMessage({ type: 'PROFILE_UPDATE', data: updated });
            res.json({ success: true, profileId });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /api/accounts/:accountId/profiles
     * Aggregates profiles from ALL loaded server DBs for a given account.
     * This is needed because profiles live in server-scoped databases.
     */
    app.get('/api/accounts/:accountId/profiles', async (req, res) => {
        try {
            const { accountId } = req.params;
            const servers = await db.getAllLoadedServers();
            const allProfiles: any[] = [];
            for (const server of servers) {
                const profiles = await db.allServerQuery(server.id, 'SELECT * FROM profiles WHERE account_id = ?', [accountId]);
                allProfiles.push(...profiles);
            }
            res.json(allProfiles);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /api/accounts/:accountId/profile
     * Returns a single "global" profile for the account — the most recently joined server profile.
     */
    app.get('/api/accounts/:accountId/profile', async (req, res) => {
        try {
            const { accountId } = req.params;
            const servers = await db.getAllLoadedServers();
            for (const server of servers) {
                const profile: any = await db.getServerQuery(server.id, 'SELECT * FROM profiles WHERE account_id = ?', [accountId]);
                if (profile) return res.json(profile);
            }
            res.status(404).json({ error: 'No profile found for account' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/import', isCreator, async (req, res) => {
        const { path: filePath } = req.body;
        try {
            const { importDirectory, importDiscordJson } = await import('./importer');
            const fsMod = require('fs');
            const stat = fsMod.statSync(filePath);
            if (stat.isDirectory()) {
                const pathNode = require('path');
                const serverName = pathNode.basename(filePath);
                await importDirectory(filePath, serverName);
            } else {
                const serverId = 'server-' + Date.now().toString();
                await db.runNodeQuery(`INSERT OR IGNORE INTO servers (id, name, icon) VALUES (?, ?, ?)`, [serverId, "Imported Server", '']);
                await importDiscordJson(filePath, serverId);
            }
            res.json({ success: true, message: 'Import triggered' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/admin/profiles/:profileId/reset', isCreator, async (req, res) => {
        try {
            const { profileId } = req.params;
            const { serverId } = req.body;
            await db.runServerQuery(serverId, 'UPDATE profiles SET account_id = NULL WHERE id = ?', [profileId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/profiles/:profileId/aliases', isCreator, async (req, res) => {
        try {
            const { profileId } = req.params;
            const { aliases, serverId } = req.body;
            await db.runServerQuery(serverId, 'UPDATE profiles SET aliases = ? WHERE id = ?', [aliases || '', profileId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/accounts/password', async (req, res) => {
        const { email, serverAuthKey, encrypted_private_key, key_salt, key_iv } = req.body;
        try {
            await db.runNodeQuery(
                'UPDATE accounts SET auth_verifier = ?, encrypted_private_key = ?, key_salt = ?, key_iv = ?, updated_at = CAST(strftime(\'%s\',\'now\') AS INTEGER) WHERE email = ?',
                [serverAuthKey, encrypted_private_key, key_salt, key_iv, email]
            );
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // Friends & Relationships
    app.post('/api/accounts/relationships/request', async (req, res) => {
        try {
            const accountId = req.headers['x-account-id'] as string;
            const { targetId } = req.body;
            if (!accountId || !targetId) return res.status(400).json({ error: 'Missing accountId or targetId' });
            const existing: any = await db.getNodeQuery('SELECT status FROM relationships WHERE account_id = ? AND target_id = ?', [accountId, targetId]);
            if (existing) return res.status(409).json({ error: 'Relationship already exists' });
            await db.runNodeQuery('INSERT INTO relationships (account_id, target_id, status, timestamp) VALUES (?, ?, ?, ?)', [accountId, targetId, 'pending', Date.now()]);
            broadcastMessage({ type: 'RELATIONSHIP_UPDATE', data: { account_id: accountId, target_id: targetId, status: 'pending' } });
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/accounts/relationships/accept', async (req, res) => {
        try {
            const accountId = req.headers['x-account-id'] as string;
            const { targetId } = req.body;
            await db.runNodeQuery('UPDATE relationships SET status = ? WHERE target_id = ? AND account_id = ? AND status = ?', ['friend', targetId, accountId, 'pending']);
            broadcastMessage({ type: 'RELATIONSHIP_UPDATE', data: { account_id: targetId, target_id: accountId, status: 'friend' } });
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/accounts/relationships/:targetId', async (req, res) => {
        try {
            const accountId = req.headers['x-account-id'] as string;
            const { targetId } = req.params;
            await db.runNodeQuery('DELETE FROM relationships WHERE (account_id = ? AND target_id = ?) OR (account_id = ? AND target_id = ?)', [accountId, targetId, targetId, accountId]);
            broadcastMessage({ type: 'RELATIONSHIP_UPDATE', data: { account_id: accountId, target_id: targetId, status: 'none' } });
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // Global Error Handler
    app.use((err: any, req: any, res: any, next: any) => {
        console.error("GLOBAL SERVER ERROR:", err);
        res.status(500).json({ 
            error: "Internal Server Error", 
            message: err.message, 
            stack: err.stack 
        });
    });

    return app;
};
