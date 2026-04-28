import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth, requireGuildRole, requireGuildAccess } from '../middleware/rbac';
import { verifyDelegationSignature } from '../crypto/pki';
import { federationFetch } from '../utils/federationFetch';
import { relinkMemberProfile } from '../guild_import';

export const createGuildContentRoutes = (db: any, broadcastMessage: (v: any) => void) => {
    const router = Router();

    router.get('/api/servers', requireAuth, async (req: any, res: any) => {
        try {
            const servers = await db.getAllLoadedServers();
            res.json(servers);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /api/guild/connect
     * Standard Server connection handshake that verifies global profile versions
     */
    router.post('/api/guild/connect', requireAuth, async (req: any, res: any) => {
        try {
            const { current_profile_version } = req.body;
            const accountId = req.accountId;

            if (current_profile_version !== undefined) {
                // Check local global_profiles cache
                const localProfile: any = await db.getNodeQuery('SELECT version FROM global_profiles WHERE account_id = ?', [accountId]);
                const localVersion = localProfile ? (localProfile.version || 0) : 0;

                if (current_profile_version > localVersion) {
                    // We are out of date, fetch from primary server
                    const account: any = await db.getNodeQuery('SELECT primary_server_url FROM accounts WHERE id = ?', [accountId]);
                    
                    if (account && account.primary_server_url) {
                        try {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
                            
                            // 1. Fetch Primary Server Key
                            const keyRes = await federationFetch(`${account.primary_server_url}/api/federation/key`, { signal: controller.signal as any });
                            if (!keyRes.ok) throw new Error('Failed to fetch public key');
                            const keyData: any = await keyRes.json();
                            const primaryPubKey = keyData.public_key;

                            // 2. Fetch Profile Payload
                            const profileRes = await federationFetch(`${account.primary_server_url}/api/federation/profile/${accountId}`, { signal: controller.signal as any });
                            if (!profileRes.ok) throw new Error('Failed to fetch profile payload');
                            const profileData: any = await profileRes.json();
                            clearTimeout(timeoutId);

                            // 3. Rebuild Payload and Verify Signature
                            const signature = profileData.signature;
                            const payloadToVerify = {
                                account_id: profileData.account_id,
                                bio: profileData.bio,
                                avatar_url: profileData.avatar_url,
                                status_message: profileData.status_message,
                                version: profileData.version
                            };
                            
                            const isValid = verifyDelegationSignature(payloadToVerify, signature, primaryPubKey);
                            
                            if (isValid) {
                                // Overwrite Cache
                                await db.runNodeQuery(`
                                    INSERT INTO global_profiles (account_id, bio, avatar_url, status_message, version, signature)
                                    VALUES (?, ?, ?, ?, ?, ?)
                                    ON CONFLICT(account_id) DO UPDATE SET
                                        bio = excluded.bio,
                                        avatar_url = excluded.avatar_url,
                                        status_message = excluded.status_message,
                                        version = excluded.version,
                                        signature = excluded.signature
                                `, [
                                    profileData.account_id, profileData.bio, profileData.avatar_url, 
                                    profileData.status_message, profileData.version, profileData.signature
                                ]);

                                // Propagate the synced avatar to local per-server profiles
                                if (profileData.avatar_url !== undefined) {
                                    const servers = await db.getAllLoadedServers();
                                    for (const server of servers) {
                                        await db.runGuildQuery(server.id, 'UPDATE profiles SET avatar = ? WHERE account_id = ?', [profileData.avatar_url, profileData.account_id]);
                                        // Broadcast the update so UI updates immediately
                                        const updatedServerProfile = await db.getGuildQuery(server.id, 'SELECT * FROM profiles WHERE account_id = ?', [profileData.account_id]);
                                        if (updatedServerProfile) {
                                            broadcastMessage({ type: 'PROFILE_UPDATE', data: updatedServerProfile, guildId: server.id });
                                        }
                                    }
                                }
                            } else {
                                return res.status(401).json({ error: 'Cryptographic validation failed: Spoofed primary server payload' });
                            }
                        } catch (err) {
                            console.error('[JIT Fetch Error]:', err);
                            // Fallback gracefully: don't block the handshake, we just use stale cache
                        }
                    }
                }
            }

            res.json({ success: true, message: 'Connected and verified' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /api/servers/:guildId/emojis
     * Fetches all custom emojis for a specific server.
     */
    dualMount(router, 'get', '/api/guilds/:guildId/emojis', requireAuth, requireGuildAccess, async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const emojis = await db.allGuildQuery(guildId, 'SELECT id, name, url, animated FROM server_emojis WHERE server_id = ?', [guildId]);
            res.json(emojis || []);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'delete', '/api/guilds/:guildId', requireAuth, requireGuildRole(['OWNER']), async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            db.unloadServerInstance(guildId);
            res.json({ success: true, message: 'Server deleted successfully' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'get', '/api/guilds/:guildId/settings', requireAuth, requireGuildAccess, async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const settings = await db.allGuildQuery(guildId, 'SELECT key, value FROM server_settings');
            const settingsObj: any = {};
            for (const s of settings) {
                settingsObj[s.key] = s.value;
            }
            res.json(settingsObj);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'put', '/api/guilds/:guildId/settings', requireAuth, requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const settings = req.body;
            for (const [key, value] of Object.entries(settings)) {
                if (typeof value === 'string' || typeof value === 'number') {
                    await db.runGuildQuery(guildId, 'INSERT OR REPLACE INTO server_settings (key, value) VALUES (?, ?)', [key, value.toString()]);
                }
            }
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'put', '/api/guilds/:guildId/rename', requireAuth, requireGuildRole(['OWNER']), async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const { name } = req.body;
            // P18 FIX: was 'UPDATE servers' — node.db registry table is 'guilds'
            await db.runNodeQuery('UPDATE guilds SET name = ? WHERE id = ?', [name, guildId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/api/servers', requireAuth, async (req: any, res: any) => {
        try {
            const { name } = req.body;
            const id = 'server-' + crypto.randomUUID();
            await db.initializeServerBundle(id, name || 'Unnamed Server', '');
            
            // Seed default category and channel
            const categoryId = crypto.randomUUID();
            await db.runGuildQuery(id, 'INSERT INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)', [categoryId, id, 'Text Channels', 0]);
            const channelId = crypto.randomUUID();
            await db.runGuildQuery(id, 'INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, ?)', [channelId, id, categoryId, 'general', 'text', 0]);

            // Cache Update
            if (db.channelToServerId) {
                db.channelToServerId.set(channelId, id);
            }

            const accountId = req.accountId;
            if (accountId) {
                const id_profile = crypto.randomUUID();
                const account: any = await db.getNodeQuery('SELECT email FROM accounts WHERE id = ?', [accountId]);
                const nickname = account?.email?.split('@')[0] || 'Creator';
                await db.runGuildQuery(id, 'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role) VALUES (?, ?, ?, ?, ?, ?, ?)', [id_profile, id, accountId, nickname, nickname, '', 'OWNER']);
                
                const creatorProfile = await db.getGuildQuery(id, `
                    SELECT p.*, (SELECT r.color FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = p.id AND pr.server_id = p.server_id ORDER BY r.position DESC LIMIT 1) as primary_role_color 
                    FROM profiles p WHERE p.id = ? AND p.server_id = ?
                `, [id_profile, id]);
                broadcastMessage({ type: 'PROFILE_UPDATE', data: creatorProfile, guildId: id });

                // Backward compatibility: also register in the guild registry (node.db)
                // so that guilds created via the legacy route appear in the guild management API.
                try {
                    await db.registerGuild(id, name || 'Unnamed Server', accountId, '');
                } catch (regErr: any) {
                    console.warn(`[ServerRoutes] Failed to register legacy guild in registry: ${regErr.message}`);
                }
            }

            // P18 FIX: was 'FROM servers' — guild DB table is 'guild_info'
            const newServer = await db.getGuildQuery(id, 'SELECT * FROM guild_info WHERE id = ?', [id]);
            res.json(newServer);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'put', '/api/guilds/:guildId/reorder', requireAuth, requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const { categories, channels } = req.body;
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            if (categories && categories.length > 0) {
                for (const cat of categories) {
                    await db.runGuildQuery(guildId, 'UPDATE channel_categories SET position = ? WHERE id = ?', [cat.position, cat.id]);
                }
            }
            if (channels && channels.length > 0) {
                for (const ch of channels) {
                    await db.runGuildQuery(guildId, 'UPDATE channels SET position = ?, category_id = ? WHERE id = ?', [ch.position, ch.categoryId || null, ch.id]);
                }
            }
            res.json({ success: true, message: 'Reordered' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'get', '/api/guilds/:guildId/profiles', requireAuth, async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const sql = `
                SELECT p.*,
                       (SELECT r.color 
                        FROM roles r 
                        JOIN profile_roles pr ON r.id = pr.role_id 
                        WHERE pr.profile_id = p.id AND pr.server_id = p.server_id 
                        ORDER BY r.position DESC LIMIT 1) as primary_role_color
                FROM profiles p WHERE p.server_id = ?
            `;
            const profiles = await db.allGuildQuery(guildId, sql, [guildId]);
            res.json(profiles);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'get', '/api/guilds/:guildId/search', requireAuth, async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const { query } = req.query;
            if (!query) return res.json([]);

            const sql = `
                SELECT m.*, 
                       c.name as channel_name,
                       COALESCE(p.nickname, 'UnknownProfile') as username, 
                       COALESCE(p.avatar, '') as avatar,
                       p.account_id
                FROM messages m
                JOIN channels c ON m.channel_id = c.id
                LEFT JOIN profiles p ON m.author_id = p.id AND c.server_id = p.server_id
                WHERE c.server_id = ? AND m.content LIKE ?
                ORDER BY m.timestamp DESC
                LIMIT 50
            `;
            const messages = await db.allGuildQuery(guildId, sql, [guildId, `%${query}%`]);
            
            // Fetch reactions
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

            // Stitch in public_keys
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

    dualMount(router, 'post', '/api/guilds/:guildId/profiles', requireAuth, async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const { nickname, isGuest } = req.body;
            const accountId = req.accountId;
            if (!accountId) return res.status(401).json({ error: "Unauthorized" });

            // Ensure a local account record exists for federated users.
            // Without this, re-login will fail to find the profile because
            // the account doesn't exist on this server's DB.
            if (!isGuest) {
                const localAccount: any = await db.getNodeQuery('SELECT id, public_key FROM accounts WHERE id = ?', [accountId]);
                if (!localAccount) {
                    // Create a minimal placeholder so future auth & profile lookups work.
                    // Federated placeholder: is_admin=0. These accounts interact via
                    // DEFAULT_USER_PERMS in the RBAC middleware, which grants baseline
                    // permissions (SEND_MESSAGES, ATTACH_FILES, VIEW_CHANNEL, etc.)
                    // when no @everyone role exists on the server.

                    // Best-effort: fetch the user's public key from their primary server
                    // so message signature verification works without needing the primary online.
                    let fetchedPublicKey = '';
                    try {
                        const token = req.headers.authorization?.split(' ')[1];
                        if (token) {
                            const parts = token.split('.');
                            if (parts.length === 3) {
                                let pBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                                while (pBase64.length % 4) pBase64 += '=';
                                const payload = JSON.parse(Buffer.from(pBase64, 'base64').toString('utf8'));
                                const primaryUrl = payload.primaryUrl;
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
                                                fetchedPublicKey = keyData.public_key;
                                            }
                                        }
                                    } finally {
                                        clearTimeout(timeoutId);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.error('[PROFILE] Failed to fetch remote public key during placeholder creation:', e);
                    }

                    await db.runNodeQuery(
                        `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, auth_salt, authority_role, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [accountId, `federated-${accountId.substring(0, 8)}`, '', fetchedPublicKey, '', '', '', '', 'replica', 0]
                    );
                } else if (localAccount && !localAccount.public_key) {
                    // Account exists but has no public key — try to backfill it
                    try {
                        const token = req.headers.authorization?.split(' ')[1];
                        if (token) {
                            const parts = token.split('.');
                            if (parts.length === 3) {
                                let pBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                                while (pBase64.length % 4) pBase64 += '=';
                                const payload = JSON.parse(Buffer.from(pBase64, 'base64').toString('utf8'));
                                const primaryUrl = payload.primaryUrl;
                                if (primaryUrl) {
                                    const controller = new AbortController();
                                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                                    try {
                                        const keyRes = await federationFetch(
                                            `${primaryUrl}/api/accounts/${accountId}/public-key`,
                                            { signal: controller.signal as any }
                                        );
                                        if (keyRes.ok) {
                                            const keyData = await keyRes.json() as any;
                                            if (keyData.public_key) {
                                                await db.runNodeQuery('UPDATE accounts SET public_key = ? WHERE id = ?', [keyData.public_key, accountId]);
                                            }
                                        }
                                    } finally {
                                        clearTimeout(timeoutId);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        // Non-fatal — the message route has its own fallback fetch
                    }
                }
            }

            // If the account was previously deactivated (e.g., user left the federation
            // and the primary sent a /api/federation/deactivate), reactivate it now that
            // they are explicitly joining a server again. Without this, the RBAC middleware
            // would permanently reject all requests from this account.
            if (!isGuest) {
                const accountStatus: any = await db.getNodeQuery('SELECT is_deactivated FROM accounts WHERE id = ?', [accountId]);
                if (accountStatus && accountStatus.is_deactivated) {
                    await db.runNodeQuery('UPDATE accounts SET is_deactivated = 0 WHERE id = ?', [accountId]);
                }
            }

            let avatarUrl = '';
            if (!isGuest && accountId) {
                const globalProfile: any = await db.getNodeQuery('SELECT avatar_url FROM global_profiles WHERE account_id = ?', [accountId]);
                if (globalProfile && globalProfile.avatar_url) {
                    avatarUrl = globalProfile.avatar_url;
                }
            }

            const id = crypto.randomUUID();
            await db.runGuildQuery(guildId,
                `INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, guildId, isGuest ? null : accountId, nickname, nickname, avatarUrl, 'USER']
            );
            const newProfile = await db.getGuildQuery(guildId, `
                SELECT p.*, (SELECT r.color FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = p.id AND pr.server_id = p.server_id ORDER BY r.position DESC LIMIT 1) as primary_role_color 
                FROM profiles p WHERE p.id = ? AND p.server_id = ?
            `, [id, guildId]);
            broadcastMessage({ type: 'PROFILE_UPDATE', data: newProfile, guildId });

            // Attempt to relink if this is an imported guild with a ghost profile
            if (!isGuest && accountId) {
                const relinkResult = await relinkMemberProfile(guildId, accountId, id);
                if (relinkResult.relinked) {
                    console.log(`[IMPORT] Relinked member ${accountId} to old profile ${relinkResult.oldProfileId}`);
                    // Re-fetch profile to get updated role/nickname from relinking
                    const relinkedProfile = await db.getGuildQuery(guildId, `
                        SELECT p.*, (SELECT r.color FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = p.id AND pr.server_id = p.server_id ORDER BY r.position DESC LIMIT 1) as primary_role_color 
                        FROM profiles p WHERE p.id = ? AND p.server_id = ?
                    `, [id, guildId]);
                    broadcastMessage({ type: 'PROFILE_UPDATE', data: relinkedProfile, guildId });
                    return res.json(relinkedProfile);
                }
            }

            res.json(newProfile);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'post', '/api/guilds/:guildId/force-link', requireAuth, requireGuildRole(['OWNER']), async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const { profileId, accountId } = req.body;
            
            await db.runGuildQuery(guildId, 'UPDATE profiles SET account_id = ? WHERE id = ?', [accountId, profileId]);
            const updated = await db.getGuildQuery(guildId, `
                SELECT p.*, (SELECT r.color FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = p.id AND pr.server_id = p.server_id ORDER BY r.position DESC LIMIT 1) as primary_role_color 
                FROM profiles p WHERE p.id = ? AND p.server_id = ?
            `, [profileId, guildId]);
            broadcastMessage({ type: 'PROFILE_UPDATE', data: updated, guildId });
            res.json({ success: true, profile: updated });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'patch', '/api/guilds/:guildId/profiles/:profileId', requireAuth, async (req: any, res: any) => {
        try {
            const { guildId, profileId } = req.params;
            const { nickname, avatar } = req.body;
            const accountId = req.accountId;

            const profile: any = await db.getGuildQuery(guildId, 'SELECT account_id FROM profiles WHERE id = ? AND server_id = ?', [profileId, guildId]);
            if (!profile || profile.account_id !== accountId) {
                return res.status(403).json({ error: "Forbidden: You do not own this profile" });
            }

            const sets = [];
            const params = [];
            if (nickname !== undefined) { sets.push('nickname = ?'); params.push(nickname); }
            if (avatar !== undefined) { sets.push('avatar = ?'); params.push(avatar); }
            
            if (sets.length > 0) {
                params.push(profileId);
                await db.runGuildQuery(guildId, `UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`, params);
            }

            const updated = await db.getGuildQuery(guildId, `
                SELECT p.*, (SELECT r.color FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = p.id AND pr.server_id = p.server_id ORDER BY r.position DESC LIMIT 1) as primary_role_color 
                FROM profiles p WHERE p.id = ? AND p.server_id = ?
            `, [profileId, guildId]);
            broadcastMessage({ type: 'PROFILE_UPDATE', data: updated, guildId });
            res.json(updated);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'get', '/api/guilds/:guildId/roles', async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const roles = await db.allGuildQuery(guildId, 'SELECT * FROM roles WHERE server_id = ? ORDER BY position ASC', [guildId]);
            res.json(roles);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'post', '/api/guilds/:guildId/roles', requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const { name, color, permissions, position } = req.body;
            const id = crypto.randomUUID();
            await db.runGuildQuery(guildId, 'INSERT INTO roles (id, server_id, name, color, permissions, position) VALUES (?, ?, ?, ?, ?, ?)', [id, guildId, name, color || '#FFFFFF', permissions || 0, position || 0]);
            const newRole = await db.getGuildQuery(guildId, 'SELECT * FROM roles WHERE id = ?', [id]);
            res.json(newRole);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'put', '/api/guilds/:guildId/roles/:roleId', requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || req.params.serverId;
            const { roleId } = req.params;
            const { name, color, permissions, position } = req.body;
            
            const sets: string[] = [];
            const params: any[] = [];
            if (name !== undefined) { sets.push('name = ?'); params.push(name); }
            if (color !== undefined) { sets.push('color = ?'); params.push(color); }
            if (permissions !== undefined) { sets.push('permissions = ?'); params.push(permissions); }
            if (position !== undefined) { sets.push('position = ?'); params.push(position); }
            
            if (sets.length > 0) {
                params.push(roleId);
                await db.runGuildQuery(guildId, `UPDATE roles SET ${sets.join(', ')} WHERE id = ?`, params);
            }
            
            const updatedRole = await db.getGuildQuery(guildId, 'SELECT * FROM roles WHERE id = ?', [roleId]);
            res.json(updatedRole);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'delete', '/api/guilds/:guildId/roles/:roleId', requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || req.params.serverId;
            const { roleId } = req.params;
            // Remove all profile_roles entries for this role first
            await db.runGuildQuery(guildId, 'DELETE FROM profile_roles WHERE role_id = ? AND server_id = ?', [roleId, guildId]);
            await db.runGuildQuery(guildId, 'DELETE FROM roles WHERE id = ? AND server_id = ?', [roleId, guildId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'post', '/api/guilds/:guildId/profiles/:profileId/roles', requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const { guildId, profileId } = req.params;
            const { roleId } = req.body;
            await db.runGuildQuery(guildId, 'INSERT INTO profile_roles (profile_id, server_id, role_id) VALUES (?, ?, ?)', [profileId, guildId, roleId]);
            
            // Re-fetch profile with updated primary_role_color and broadcast
            const updated = await db.getGuildQuery(guildId, `
                SELECT p.*, (SELECT r.color FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = p.id AND pr.server_id = p.server_id ORDER BY r.position DESC LIMIT 1) as primary_role_color 
                FROM profiles p WHERE p.id = ? AND p.server_id = ?
            `, [profileId, guildId]);
            if (updated) broadcastMessage({ type: 'PROFILE_UPDATE', data: updated, guildId });
            
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'delete', '/api/guilds/:guildId/profiles/:profileId/roles/:roleId', requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const { guildId, profileId, roleId } = req.params;
            await db.runGuildQuery(guildId, 'DELETE FROM profile_roles WHERE profile_id = ? AND server_id = ? AND role_id = ?', [profileId, guildId, roleId]);
            
            // Re-fetch profile with updated primary_role_color and broadcast
            const updated = await db.getGuildQuery(guildId, `
                SELECT p.*, (SELECT r.color FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = p.id AND pr.server_id = p.server_id ORDER BY r.position DESC LIMIT 1) as primary_role_color 
                FROM profiles p WHERE p.id = ? AND p.server_id = ?
            `, [profileId, guildId]);
            if (updated) broadcastMessage({ type: 'PROFILE_UPDATE', data: updated, guildId });
            
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'get', '/api/guilds/:guildId/profiles/:profileId/roles', requireAuth, async (req: any, res: any) => {
        try {
            const { guildId, profileId } = req.params;
            const roles = await db.allGuildQuery(guildId, 
                `SELECT r.* FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = ? AND pr.server_id = ?`,
                [profileId, guildId]
            );
            
            const everyoneRole = await db.getGuildQuery(guildId, 'SELECT * FROM roles WHERE name = ?', ['@everyone']);
            if (everyoneRole) {
                // Ensure @everyone is included so the client calculates baseline permissions
                roles.push(everyoneRole);
            }
            
            res.json(roles || []);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /api/servers/:guildId/leave
     * Allows an authenticated user to leave a server by setting their profile's
     * membership_status to 'left'. Does NOT delete any data.
     */
    dualMount(router, 'post', '/api/guilds/:guildId/leave', requireAuth, async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const accountId = req.accountId;
            if (!accountId) return res.status(401).json({ error: 'Unauthorized' });

            // Find the user's active profile on this server
            const profile: any = await db.getGuildQuery(
                guildId,
                'SELECT id FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?',
                [accountId, guildId, 'active']
            );
            if (!profile) {
                return res.status(404).json({ error: 'No active membership found on this server' });
            }

            const now = Math.floor(Date.now() / 1000);
            await db.runGuildQuery(
                guildId,
                'UPDATE profiles SET membership_status = ?, left_at = ? WHERE id = ? AND server_id = ?',
                ['left', now, profile.id, guildId]
            );

            broadcastMessage({
                type: 'MEMBER_LEAVE',
                data: { profileId: profile.id, guildId, accountId },
                guildId
            });

            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /api/servers/:guildId/rejoin
     * Allows an authenticated user to rejoin a server they previously left.
     * Reactivates an existing 'left' profile rather than creating a new one.
     * If no left profile exists, returns needs_profile:true so the client
     * knows to show the ClaimProfile / CreateProfile UI.
     */
    dualMount(router, 'post', '/api/guilds/:guildId/rejoin', requireAuth, async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const accountId = req.accountId;
            if (!accountId) return res.status(401).json({ error: 'Unauthorized' });

            // Check if user already has an active profile (already a member)
            const activeProfile: any = await db.getGuildQuery(
                guildId,
                'SELECT id FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?',
                [accountId, guildId, 'active']
            );
            if (activeProfile) {
                // Even though the profile is active, the account may have been deactivated
                // by a federation deactivate call. Clear it so RBAC works again.
                await db.runNodeQuery('UPDATE accounts SET is_deactivated = 0 WHERE id = ? AND is_deactivated = 1', [accountId]);
                return res.status(409).json({ error: 'Already an active member of this server' });
            }

            // Look for a left profile to reactivate
            const leftProfile: any = await db.getGuildQuery(
                guildId,
                'SELECT * FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?',
                [accountId, guildId, 'left']
            );

            if (!leftProfile) {
                // No previous membership — client needs to create a new profile
                return res.json({ success: false, needs_profile: true });
            }

            // Reactivate the existing profile
            await db.runGuildQuery(
                guildId,
                'UPDATE profiles SET membership_status = ?, left_at = NULL WHERE id = ? AND server_id = ?',
                ['active', leftProfile.id, guildId]
            );

            // Also reactivate the account if it was deactivated by /api/federation/deactivate.
            // Without this, the RBAC middleware would continue rejecting all requests even
            // though the user has an active profile again.
            await db.runNodeQuery('UPDATE accounts SET is_deactivated = 0 WHERE id = ?', [accountId]);

            const reactivated = await db.getGuildQuery(
                guildId,
                `
                SELECT p.*, (SELECT r.color FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = p.id AND pr.server_id = p.server_id ORDER BY r.position DESC LIMIT 1) as primary_role_color 
                FROM profiles p WHERE p.id = ? AND p.server_id = ?
                `,
                [leftProfile.id, guildId]
            );

            broadcastMessage({
                type: 'MEMBER_JOIN',
                data: reactivated,
                guildId
            });

            res.json(reactivated);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};

function dualMount(router: any, method: string, path: string, ...handlers: any[]) {
    const guildPath = path;
    const serverPath = path.replace(':guildId', ':serverId').replace('/guilds/', '/servers/');
    router[method](guildPath, ...handlers);
    router[method](serverPath, ...handlers);
}

export const createServerRoutes = createGuildContentRoutes;
