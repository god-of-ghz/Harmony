import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth, requireGuildPermission, Permission } from '../middleware/rbac';
import { verifyMessageSignature } from '../crypto/signatures';
import { federationFetch } from '../utils/federationFetch';
import jwt from '../crypto/jwt';
import { MAX_MESSAGE_LENGTH, sanitizeMessageContent, MessageRateLimiter } from '../middleware/messageGuardrails';

export const createMessageRoutes = (db: any, broadcastMessage: (v: any) => void) => {
    const router = Router();

    const findServerId = async (_table: string, id: string): Promise<string | null> => {
        return db.channelToServerId?.get(id) || null;
    };

    const injectServerId = async (req: any, res: any, next: any) => {
        if (!(req.query.guildId || req.query.serverId) && !(req.body.guildId || req.body.serverId) && req.params.channelId) {
            const resolved = await findServerId('channels', req.params.channelId as string);
            if (resolved) {
                req.params.guildId = resolved;
            } else {
                console.warn(`[MSG] injectServerId: Could not resolve channelId=${req.params.channelId} to a guildId`);
            }
        }
        next();
    };

    router.get('/api/channels/:channelId/messages', requireAuth, async (req: any, res: any) => {
        try {
            const { channelId } = req.params;
            const accountId = req.accountId;
            const limit = parseInt(req.query.limit as string) || 100;
            const cursor = req.query.cursor as string;
            const direction = req.query.direction as string || 'before';

            if (channelId.startsWith('dm-')) {
                // Check participation
                const isParticipant = await db.getDmsQuery(`SELECT 1 FROM dm_participants WHERE channel_id = ? AND account_id = ?`, [channelId, accountId]);
                if (!isParticipant) return res.status(403).json({error: "Forbidden"});

                let sql = `SELECT * FROM dm_messages WHERE channel_id = ?`;
                const params: any[] = [channelId];
                if (cursor) {
                    if (direction === 'after') {
                        sql += ` AND timestamp > ?`;
                    } else {
                        sql += ` AND timestamp < ?`;
                    }
                    params.push(cursor);
                }
                
                if (direction === 'after') {
                    sql += ` ORDER BY timestamp ASC LIMIT ?`;
                } else {
                    sql += ` ORDER BY timestamp DESC LIMIT ?`;
                }
                params.push(limit);

                const messages = await db.allDmsQuery(sql, params);
                const accountIds = [...new Set(messages.map((m: any) => m.author_id).filter(Boolean))];
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
                    public_key: accountMap[m.author_id] || '',
                    username: 'User ' + m.author_id.substring(0, 4) // Temporary minimal name
                }));
                return res.json(direction === 'after' ? result : result.reverse());
            }

            const guildId = ((req.query.guildId || (req.query.guildId || req.query.serverId)) as string) || await findServerId('channels', channelId as string);
            if (!guildId) return res.status(404).json({ error: "Server context not found for channel" });

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
                if (direction === 'after') {
                    sql += ` AND m.timestamp > ?`;
                } else {
                    sql += ` AND m.timestamp < ?`;
                }
                params.push(cursor);
            }

            if (direction === 'after') {
                sql += ` ORDER BY m.timestamp ASC LIMIT ?`;
            } else {
                sql += ` ORDER BY m.timestamp DESC LIMIT ?`;
            }
            params.push(limit);

            const messages = await db.allGuildQuery(guildId, sql, params);
            
            const msgIds = messages.map((m: any) => m.id);
            const rxMap: any = {};
            if (msgIds.length > 0) {
                const placeholders = msgIds.map(() => '?').join(', ');
                const reactions: any[] = await db.allGuildQuery(guildId, `SELECT message_id, author_id, emoji FROM message_reactions WHERE message_id IN (${placeholders})`, msgIds);
                for (const rx of reactions) {
                    if (!rxMap[rx.message_id]) rxMap[rx.message_id] = [];
                    rxMap[rx.message_id].push({ author_id: rx.author_id, emoji: rx.emoji });
                }
            }

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
                reactions: rxMap[m.id] || [],
                public_key: accountMap[m.account_id] || ''
            }));

            res.json(direction === 'after' ? result : result.reverse());
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/api/channels/:channelId/read', requireAuth, async (req: any, res: any) => {
        // Stub to avoid 404s
        res.json({ success: true });
    });

    router.get('/api/channels/:channelId/messages/around/:messageId', requireAuth, async (req: any, res: any) => {
        try {
            const { channelId, messageId } = req.params;
            const guildId = ((req.query.guildId || (req.query.guildId || req.query.serverId)) as string) || await findServerId('channels', channelId as string);
            if (!guildId) return res.status(404).json({ error: "Server context not found" });

            const target: any = await db.getGuildQuery(guildId, 'SELECT * FROM messages WHERE id = ?', [messageId]);
            if (!target) return res.status(404).json({ error: "Target message not found" });

            const limit = 50;
            const halfLimit = Math.floor(limit / 2);

            const sqlBase = `SELECT m.*, 
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

            const before = await db.allGuildQuery(guildId, 
                `${sqlBase} AND m.timestamp <= ? ORDER BY m.timestamp DESC LIMIT ?`, 
                [channelId, target.timestamp, halfLimit + 1]);

            const after = await db.allGuildQuery(guildId,
                `${sqlBase} AND m.timestamp > ? ORDER BY m.timestamp ASC LIMIT ?`, 
                [channelId, target.timestamp, halfLimit]);

            const messages = [...before.reverse(), ...after];
            
            const msgIds = messages.map((m: any) => m.id);
            const rxMap: any = {};
            if (msgIds.length > 0) {
                const placeholders = msgIds.map(() => '?').join(', ');
                const reactions: any[] = await db.allGuildQuery(guildId, `SELECT message_id, author_id, emoji FROM message_reactions WHERE message_id IN (${placeholders})`, msgIds);
                for (const rx of reactions) {
                    if (!rxMap[rx.message_id]) rxMap[rx.message_id] = [];
                    rxMap[rx.message_id].push({ author_id: rx.author_id, emoji: rx.emoji });
                }
            }

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
                reactions: rxMap[m.id] || [],
                public_key: accountMap[m.account_id] || ''
            }));

            res.json(result);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/api/channels/:channelId/messages/:messageId', requireAuth, async (req: any, res: any) => {
        try {
            const { channelId, messageId } = req.params;
            const { content, signature } = req.body;
            const accountId = req.accountId;

            if (content && content.length > MAX_MESSAGE_LENGTH) {
                return res.status(413).json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters.` });
            }
            const sanitizedContent = sanitizeMessageContent(content || '');

            const guildId = (req.query.guildId || (req.query.guildId || req.query.serverId)) as string || await findServerId('channels', channelId);
            if (!guildId) return res.status(404).json({ error: "Server context not found" });

            const message: any = await db.getGuildQuery(guildId, 'SELECT author_id, is_encrypted FROM messages WHERE id = ?', [messageId]);
            if (!message) return res.status(404).json({ error: 'Message not found' });

            const profile: any = await db.getGuildQuery(guildId, 'SELECT id FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, guildId]);
            const isAuthor = profile && message.author_id === profile.id;

            if (!isAuthor) {
                return res.status(403).json({ error: 'Forbidden: Only the author can edit a message' });
            }

            const senderAccount: any = await db.getNodeQuery('SELECT public_key FROM accounts WHERE id = ?', [accountId]);
            const senderPublicKey = senderAccount?.public_key || '';

            if (!message.is_encrypted) {
                if (!signature) {
                    return res.status(403).json({ error: "Signature required" });
                }
                if (!senderPublicKey) {
                    return res.status(403).json({ error: "Account has no public key" });
                }
                const isValid = await verifyMessageSignature(sanitizedContent, signature, senderPublicKey);
                if (!isValid) {
                    return res.status(403).json({ error: "Signature verification failed" });
                }
            }

            const editedAt = new Date().toISOString();
            await db.runGuildQuery(guildId, 'UPDATE messages SET content = ?, signature = ?, edited_at = ? WHERE id = ?', [sanitizedContent, signature || '', editedAt, messageId]);

            const updatedMessage: any = await db.getGuildQuery(guildId, 
                `SELECT m.*, 
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
                 WHERE m.id = ?`, [messageId]);

            const payloadMessage = {
                ...updatedMessage,
                public_key: senderPublicKey || '',
                is_encrypted: message.is_encrypted
            };

            broadcastMessage({ type: 'MESSAGE_UPDATE', data: payloadMessage, guildId });
            res.json(payloadMessage);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.delete('/api/channels/:channelId/messages/:messageId', requireAuth, async (req: any, res: any) => {
        try {
            const { channelId, messageId } = req.params;
            const accountId = req.accountId;
            const guildId = (req.query.guildId || (req.query.guildId || req.query.serverId)) as string || await findServerId('channels', channelId);
            if (!guildId) return res.status(404).json({ error: "Server context not found" });

            const message: any = await db.getGuildQuery(guildId, 'SELECT author_id FROM messages WHERE id = ?', [messageId]);
            if (!message) return res.status(404).json({ error: 'Message not found' });

            const profile: any = await db.getGuildQuery(guildId, 'SELECT id FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, guildId]);
            const isAuthor = profile && message.author_id === profile.id;

            let hasPerm = isAuthor;
            if (!hasPerm && profile) {
                const roles: any[] = await db.allGuildQuery(guildId,
                    `SELECT r.permissions FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = ? AND pr.server_id = ?`,
                    [profile.id, guildId]
                );
                let perm = 0;
                for (const r of roles) perm |= r.permissions;
                hasPerm = (perm & Permission.MANAGE_MESSAGES) !== 0 || (perm & Permission.ADMINISTRATOR) !== 0;
            }

            const account: any = await db.getNodeQuery('SELECT is_creator FROM accounts WHERE id = ?', [accountId]);
            if (account && account.is_creator) hasPerm = true;

            if (!hasPerm) return res.status(403).json({ error: 'Forbidden' });

            await db.runGuildQuery(guildId, 'DELETE FROM messages WHERE id = ?', [messageId]);
            broadcastMessage({ type: 'MESSAGE_DELETE', data: { message_id: messageId, channel_id: channelId }, guildId });
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/api/channels/:channelId/messages/:messageId/reactions', requireAuth, async (req: any, res: any) => {
        try {
            const { channelId, messageId } = req.params;
            const { emoji } = req.body;
            const accountId = req.accountId;
            const guildId = (req.query.guildId || (req.query.guildId || req.query.serverId)) as string || await findServerId('channels', channelId);
            if (!guildId) return res.status(404).json({ error: "Server context not found" });

            const profile: any = await db.getGuildQuery(guildId, 'SELECT id FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, guildId]);
            if (!profile) return res.status(403).json({ error: "Not a member of this server" });

            await db.runGuildQuery(guildId, 'INSERT OR IGNORE INTO message_reactions (message_id, author_id, emoji) VALUES (?, ?, ?)', [messageId, profile.id, emoji]);
            const reactionData = { message_id: messageId, author_id: profile.id, emoji, channel_id: channelId };
            broadcastMessage({ type: 'REACTION_ADD', data: reactionData, guildId });
            res.json(reactionData);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.delete('/api/channels/:channelId/messages/:messageId/reactions/:emoji', requireAuth, async (req: any, res: any) => {
        try {
            const { channelId, messageId, emoji } = req.params;
            const accountId = req.accountId;
            const guildId = (req.query.guildId || (req.query.guildId || req.query.serverId)) as string || await findServerId('channels', channelId);
            if (!guildId) return res.status(404).json({ error: "Server context not found" });

            const profile: any = await db.getGuildQuery(guildId, 'SELECT id FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, guildId]);
            if (!profile) return res.status(403).json({ error: "Not a member of this server" });

            await db.runGuildQuery(guildId, 'DELETE FROM message_reactions WHERE message_id = ? AND author_id = ? AND emoji = ?', [messageId, profile.id, emoji]);
            broadcastMessage({ type: 'REACTION_REMOVE', data: { message_id: messageId, author_id: profile.id, emoji, channel_id: channelId }, guildId });
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/api/channels/:channelId/messages', requireAuth, injectServerId, async (req: any, res: any, next: any) => {
        if (req.params.channelId.startsWith('dm-')) return next();
        const mwArray = requireGuildPermission(Permission.SEND_MESSAGES) as any[];
        mwArray[1](req, res, next);
    }, async (req: any, res: any) => {
        const { channelId } = req.params;
        let { content, authorId, signature, attachments, reply_to, is_encrypted } = req.body;
        const accountId = req.accountId;
        const id = crypto.randomUUID();
        const timestamp = new Date().toISOString();

        try {
            if (content && content.length > MAX_MESSAGE_LENGTH) {
                return res.status(413).json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters.` });
            }
            content = sanitizeMessageContent(content || '');

            if (channelId.startsWith('dm-')) {
                const isRateLimited = !(await MessageRateLimiter.checkRateLimit(accountId, null, db));
                if (isRateLimited) {
                    return res.status(429).json({ error: "Too Many Requests" });
                }

                const isParticipant = await db.getDmsQuery(`SELECT 1 FROM dm_participants WHERE channel_id = ? AND account_id = ?`, [channelId, accountId]);
                if (!isParticipant) return res.status(403).json({error: "Forbidden"});

                // Blindly store the payload
                await db.runDmsQuery(
                    `INSERT INTO dm_messages (id, channel_id, author_id, content, timestamp, is_pinned, edited_at, attachments, is_encrypted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, channelId, accountId, content, timestamp, 0, null, attachments || '[]', is_encrypted ? 1 : 0]
                );
                
                const acc: any = await db.getNodeQuery(`SELECT public_key FROM accounts WHERE id = ?`, [accountId]);
                const newMessage = {
                    id, channel_id: channelId, author_id: accountId, content, timestamp, is_pinned: 0,
                    username: 'User', attachments: attachments || '[]', public_key: acc?.public_key || '',
                    reply_to: reply_to || null, is_encrypted: is_encrypted ? 1 : 0
                };
                broadcastMessage({ type: 'NEW_DM_MESSAGE', data: newMessage });
                return res.json(newMessage);
            }

            const guildId = (req.query.guildId || (req.query.guildId || req.query.serverId)) as string || await findServerId('channels', channelId);
            if (!guildId) return res.status(404).json({ error: "Server context not found" });

            const isRateLimited = !(await MessageRateLimiter.checkRateLimit(accountId, guildId, db));
            if (isRateLimited) {
                return res.status(429).json({ error: "Too Many Requests" });
            }

            const profile: any = await db.getGuildQuery(guildId, 'SELECT account_id FROM profiles WHERE id = ? AND server_id = ?', [authorId, guildId]);
            if (!profile || profile.account_id !== accountId) {
                return res.status(403).json({ error: "Forbidden: You do not own this profile" });
            }

            // --- Signature Verification (Layer 1 Anti-Tampering) ---
            // Look up the sender's public key from their account
            const senderAccount: any = await db.getNodeQuery('SELECT public_key FROM accounts WHERE id = ?', [accountId]);
            let senderPublicKey = senderAccount?.public_key || '';

            // If the account doesn't exist locally (e.g. untrusted/unfederated server),
            // try to fetch the public key from the sender's primary server.
            // The JWT was already validated by requireAuth, so we can trust the primaryUrl claim.
            if (!senderPublicKey) {
                try {
                    const token = req.headers.authorization?.split(' ')[1];
                    if (token) {
                        const decoded = jwt.decode(token) as any;
                        const primaryUrl = decoded?.payload?.primaryUrl || decoded?.primaryUrl;
                        if (primaryUrl) {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 5000);
                            try {
                                const keyRes = await federationFetch(
                                    `${primaryUrl}/api/accounts/${accountId}/public-key`,
                                    { signal: controller.signal as any }
                                );
                                if (keyRes.ok) {
                                    const keyData = await keyRes.json() as any;
                                    if (keyData.public_key) {
                                        senderPublicKey = keyData.public_key;
                                        // Cache the key locally so future messages don't need the remote fetch
                                        db.runNodeQuery('UPDATE accounts SET public_key = ? WHERE id = ? AND (public_key IS NULL OR public_key = ?)', [keyData.public_key, accountId, '']).catch(() => {});
                                    }
                                }
                            } finally {
                                clearTimeout(timeoutId);
                            }
                        }
                    }
                } catch (e) {
                    console.error('[MSG] Failed to fetch remote public key for signature verification:', e);
                }
            }

            // Enforce signature for all accounts
            if (!is_encrypted) {
                // For non-encrypted messages, verify the signature against plaintext
                if (!signature) {
                    return res.status(403).json({ error: "Signature required: All messages must be cryptographically signed" });
                }

                if (!senderPublicKey) {
                    return res.status(403).json({ error: "Signature verification failed: Account has no public key" });
                }

                const isValid = await verifyMessageSignature(content, signature, senderPublicKey);
                if (!isValid) {
                    return res.status(403).json({ error: "Signature verification failed: Message integrity check failed" });
                }
            }
            // Encrypted messages skip plaintext signature verification (Phase 1 known gap)
            // --- End Signature Verification ---

            await db.runGuildQuery(guildId,
                `INSERT INTO messages (id, channel_id, author_id, content, timestamp, is_pinned, signature, attachments, reply_to, is_encrypted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, channelId, authorId, content, timestamp, 0, signature || '', attachments || '[]', reply_to || null, is_encrypted ? 1 : 0]
            );
            const author: any = await db.getGuildQuery(guildId, 'SELECT nickname as username, avatar, account_id FROM profiles WHERE id = ? AND server_id = ?', [authorId, guildId]);
            
            let public_key = '';
            if (author?.account_id) {
                const acc: any = await db.getNodeQuery('SELECT public_key FROM accounts WHERE id = ?', [author.account_id]);
                public_key = acc?.public_key || '';
            }

            let repliedAuthor = null;
            let repliedContent = null;
            if (reply_to) {
                const rm: any = await db.getGuildQuery(guildId, 
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
                replied_content: repliedContent,
                is_encrypted: is_encrypted ? 1 : 0
            };
            broadcastMessage({ type: 'NEW_MESSAGE', data: newMessage, guildId });
            if (author?.account_id) {
                broadcastMessage({ type: 'TYPING_STOP', data: { channelId, accountId: author.account_id }, guildId });
            }
            res.json(newMessage);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
