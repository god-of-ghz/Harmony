import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { requireRole, isCreator } from './middleware/rbac';

export const createApp = (db: any, broadcastMessage: (v: any) => void) => {
    const app = express();
    app.use(cors());
    app.use(express.json());

    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', time: new Date().toISOString() });
    });

    app.get('/api/servers', async (req, res) => {
        try {
            const servers = await db.allQuery('SELECT * FROM servers');
            res.json(servers);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/servers/:serverId/channels', async (req, res) => {
        try {
            const { serverId } = req.params;
            const channels = await db.allQuery('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC', [serverId]);
            res.json(channels);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/servers/:serverId', requireRole(['OWNER']), async (req, res) => {
        try {
            const { serverId } = req.params;
            await db.runQuery('DELETE FROM servers WHERE id = ?', [serverId]);
            res.json({ success: true, message: 'Server deleted successfully' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/servers/:serverId/rename', requireRole(['OWNER']), async (req, res) => {
        try {
            const { serverId } = req.params;
            const { name } = req.body;
            await db.runQuery('UPDATE servers SET name = ? WHERE id = ?', [name, serverId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/servers/:serverId/channels', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { serverId } = req.params;
            const { name, categoryId } = req.body;
            const id = crypto.randomUUID();
            await db.runQuery('INSERT INTO channels (id, server_id, category_id, name) VALUES (?, ?, ?, ?)', [id, serverId, categoryId || null, name]);
            const newChannel = await db.getQuery('SELECT * FROM channels WHERE id = ?', [id]);
            res.json(newChannel);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/servers/:serverId/categories', async (req, res) => {
        try {
            const { serverId } = req.params;
            const categories = await db.allQuery('SELECT * FROM channel_categories WHERE server_id = ? ORDER BY position ASC', [serverId]);
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
            await db.runQuery('INSERT INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)', [id, serverId, name, position || 0]);
            const newCategory = await db.getQuery('SELECT * FROM channel_categories WHERE id = ?', [id]);
            res.json(newCategory);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/channels/:channelId/category', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { channelId } = req.params;
            const { categoryId } = req.body; // Can be null to remove from category
            await db.runQuery('UPDATE channels SET category_id = ? WHERE id = ?', [categoryId || null, channelId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/categories/:categoryId', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { categoryId } = req.params;
            const { name } = req.body;
            await db.runQuery('UPDATE channel_categories SET name = ? WHERE id = ?', [name, categoryId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/categories/:categoryId', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { categoryId } = req.params;
            // The constraint ON DELETE SET NULL should handle the channels gracefully
            await db.runQuery('DELETE FROM channel_categories WHERE id = ?', [categoryId]);
            res.json({ success: true, message: 'Category deleted' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/servers/:serverId/reorder', requireRole(['OWNER', 'ADMIN']), async (req, res) => {
        try {
            const { categories, channels } = req.body;
            // Expected arrays of { id, position } and { id, position, categoryId }

            // For safety and performance, we should ideally use a transaction.
            // Since we're using raw lightweight db execution, we'll sequentially run them.
            if (categories && categories.length > 0) {
                for (const cat of categories) {
                    await db.runQuery('UPDATE channel_categories SET position = ? WHERE id = ?', [cat.position, cat.id]);
                }
            }

            if (channels && channels.length > 0) {
                for (const ch of channels) {
                    await db.runQuery('UPDATE channels SET position = ?, category_id = ? WHERE id = ?', [ch.position, ch.categoryId || null, ch.id]);
                }
            }

            res.json({ success: true, message: 'Reordered' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/channels/:channelId/messages', async (req, res) => {
        try {
            const { channelId } = req.params;
            const limit = parseInt(req.query.limit as string) || 100;
            const cursor = req.query.cursor as string; // timestamp

            let sql = `SELECT m.*, COALESCE(p.nickname, 'UnknownProfileOrRole') as username, COALESCE(p.avatar, '') as avatar 
                       FROM messages m 
                       JOIN channels c ON m.channel_id = c.id
                       LEFT JOIN profiles p ON m.author_id = p.id AND c.server_id = p.server_id
                       WHERE m.channel_id = ?`;
            const params: any[] = [channelId];

            if (cursor) {
                sql += ` AND m.timestamp < ?`;
                params.push(cursor);
            }

            sql += ` ORDER BY m.timestamp DESC LIMIT ?`;
            params.push(limit);

            const messages = await db.allQuery(sql, params);
            res.json(messages.reverse()); // Reverse to return chronologically ASC
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/servers/:serverId/profiles', async (req, res) => {
        try {
            const { serverId } = req.params;
            const profiles = await db.allQuery('SELECT * FROM profiles WHERE server_id = ?', [serverId]);
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
            await db.runQuery(
                `INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, serverId, isGuest ? null : accountId, nickname, nickname, '', 'USER']
            );
            const newProfile = await db.getQuery('SELECT * FROM profiles WHERE id = ? AND server_id = ?', [id, serverId]);
            res.json(newProfile);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/channels/:channelId/messages', async (req, res) => {
        const { channelId } = req.params;
        const { content, authorId } = req.body;
        const id = Date.now().toString();
        const timestamp = new Date().toISOString();

        try {
            await db.runQuery(
                `INSERT INTO messages (id, channel_id, author_id, content, timestamp, is_pinned) VALUES (?, ?, ?, ?, ?, ?)`,
                [id, channelId, authorId, content, timestamp, 0]
            );
            const channel: any = await db.getQuery('SELECT server_id FROM channels WHERE id = ?', [channelId]);
            const author: any = await db.getQuery('SELECT nickname as username, avatar FROM profiles WHERE id = ? AND server_id = ?', [authorId, channel.server_id]);
            const newMessage = {
                id, channel_id: channelId, author_id: authorId, content, timestamp, is_pinned: 0,
                username: author?.username || 'UnknownProfileOrRole', avatar: author?.avatar || ''
            };
            // Send to websockets
            broadcastMessage({ type: 'NEW_MESSAGE', data: newMessage });
            res.json(newMessage);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/signup', async (req, res) => {
        const { email, password } = req.body;
        const id = crypto.randomUUID();
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        try {
            await db.runQuery(`INSERT INTO accounts (id, email, password_hash) VALUES (?, ?, ?)`, [id, email, hash]);
            const account = await db.getQuery('SELECT id, email, is_creator FROM accounts WHERE id = ?', [id]);
            res.json(account);
        } catch (err: any) {
            res.status(500).json({ error: "Email already exists or error occurred" });
        }
    });

    app.post('/api/accounts/login', async (req, res) => {
        const { email, password, initialServerUrl } = req.body;
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        try {
            let account: any = await db.getQuery('SELECT * FROM accounts WHERE email = ?', [email]);

            if (account && account.password_hash === hash) {
                const servers = await db.allQuery('SELECT server_url FROM trusted_servers WHERE account_id = ?', [account.id]);
                return res.json({ id: account.id, email: account.email, is_creator: account.is_creator, trusted_servers: servers.map((s: any) => s.server_url) });
            }

            let serversToTry: string[] = [];
            if (account) {
                const ts = await db.allQuery('SELECT server_url FROM trusted_servers WHERE account_id = ?', [account.id]);
                serversToTry = ts.map((s: any) => s.server_url);
            }
            if (initialServerUrl && !serversToTry.includes(initialServerUrl)) {
                serversToTry.push(initialServerUrl);
            }

            for (const url of serversToTry) {
                try {
                    const fedRes = await fetch(`${url}/api/accounts/federate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    });
                    if (fedRes.ok) {
                        const data: any = await fedRes.json();
                        // Save to local DB
                        if (account) {
                            await db.runQuery('UPDATE accounts SET password_hash = ?, is_creator = ?, updated_at = ? WHERE id = ?', [data.account.password_hash, data.account.is_creator, data.account.updated_at, data.account.id]);
                        } else {
                            await db.runQuery('INSERT INTO accounts (id, email, password_hash, is_creator, updated_at) VALUES (?, ?, ?, ?, ?)', [data.account.id, data.account.email, data.account.password_hash, data.account.is_creator, data.account.updated_at]);
                        }

                        await db.runQuery('DELETE FROM trusted_servers WHERE account_id = ?', [data.account.id]);
                        for (const sUrl of data.trusted_servers) {
                            await db.runQuery('INSERT INTO trusted_servers (account_id, server_url) VALUES (?, ?)', [data.account.id, sUrl]);
                        }
                        account = data.account;
                        return res.json({ id: account.id, email: account.email, is_creator: account.is_creator, trusted_servers: data.trusted_servers });
                    }
                } catch (e: any) {
                    console.error(`Failed to federate with ${url}:`, e.message);
                }
            }

            res.status(401).json({ error: "Invalid credentials" });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/federate', async (req, res) => {
        const { email, password } = req.body;
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        try {
            const account: any = await db.getQuery('SELECT * FROM accounts WHERE email = ? AND password_hash = ?', [email, hash]);
            if (account) {
                const servers = await db.allQuery('SELECT server_url FROM trusted_servers WHERE account_id = ?', [account.id]);
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
            const existing: any = await db.getQuery('SELECT updated_at FROM accounts WHERE id = ?', [account.id]);
            if (existing) {
                if (account.updated_at > existing.updated_at) {
                    await db.runQuery('UPDATE accounts SET email = ?, password_hash = ?, is_creator = ?, updated_at = ? WHERE id = ?', [account.email, account.password_hash, account.is_creator, account.updated_at, account.id]);
                } else {
                    return res.json({ success: true, message: 'Local is newer or same' });
                }
            } else {
                await db.runQuery('INSERT INTO accounts (id, email, password_hash, is_creator, updated_at) VALUES (?, ?, ?, ?, ?)', [account.id, account.email, account.password_hash, account.is_creator, account.updated_at]);
            }

            await db.runQuery('DELETE FROM trusted_servers WHERE account_id = ?', [account.id]);
            for (const url of (trusted_servers || [])) {
                await db.runQuery('INSERT INTO trusted_servers (account_id, server_url) VALUES (?, ?)', [account.id, url]);
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
            await db.runQuery('INSERT OR IGNORE INTO trusted_servers (account_id, server_url) VALUES (?, ?)', [accountId, serverUrl]);
            await db.runQuery("UPDATE accounts SET updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?", [accountId]);

            // Push the full updated account struct to the new peer
            const fullAccount: any = await db.getQuery('SELECT * FROM accounts WHERE id = ?', [accountId]);
            const trustedList = await db.allQuery('SELECT server_url FROM trusted_servers WHERE account_id = ?', [accountId]);

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
            await db.runQuery(`UPDATE profiles SET account_id = ? WHERE id = ? AND server_id = ?`, [accountId, profileId, serverId]);
            res.json({ success: true, profileId });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/profiles/claim', async (req, res) => {
        const { profileId, serverId, accountId } = req.body;
        try {
            await db.runQuery(`UPDATE profiles SET account_id = ? WHERE id = ? AND server_id = ?`, [accountId, profileId, serverId]);
            res.json({ success: true, profileId });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/accounts/:accountId/profiles', async (req, res) => {
        try {
            const { accountId } = req.params;
            const profiles = await db.allQuery('SELECT * FROM profiles WHERE account_id = ?', [accountId]);
            res.json(profiles);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/import', isCreator, async (req, res) => {
        const { path: filePath } = req.body;
        try {
            const { importDirectory, importDiscordJson } = await import('./importer');
            const fs = require('fs');
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                const pathNode = require('path');
                const serverName = pathNode.basename(filePath);
                await importDirectory(filePath, serverName);
            } else {
                const serverId = 'server-' + Date.now().toString();
                await db.runQuery(`INSERT OR IGNORE INTO servers (id, name, icon) VALUES (?, ?, ?)`, [serverId, "Imported Server", '']);
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
            await db.runQuery('UPDATE profiles SET account_id = NULL WHERE id = ?', [profileId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/profiles/:profileId/aliases', isCreator, async (req, res) => {
        try {
            const { profileId } = req.params;
            const { aliases } = req.body;
            await db.runQuery('UPDATE profiles SET aliases = ? WHERE id = ?', [aliases || '', profileId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/accounts/password', async (req, res) => {
        const { email, newPassword } = req.body;
        const hash = crypto.createHash('sha256').update(newPassword).digest('hex');
        try {
            await db.runQuery('UPDATE accounts SET password_hash = ? WHERE email = ?', [hash, email]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return app;
};
