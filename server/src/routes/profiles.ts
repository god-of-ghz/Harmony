import { Router } from 'express';
import { requireAuth, requireNodeOperator } from '../middleware/rbac';
import { getServerIdentity, signDelegationPayload, verifyDelegationSignature } from '../crypto/pki';
import { federationFetch } from '../utils/federationFetch';

export const createProfileRoutes = (db: any, broadcastMessage: (v: any) => void) => {
    const router = Router();

    router.post('/api/guest/merge', requireAuth, async (req, res) => {
        const { profileId, guildId } = req.body;
        const accountId = (req as any).accountId;
        try {
            await db.runGuildQuery(guildId, `UPDATE profiles SET account_id = ? WHERE id = ? AND server_id = ?`, [accountId, profileId, guildId]);
            const updated = await db.getGuildQuery(guildId, 'SELECT * FROM profiles WHERE id = ? AND server_id = ?', [profileId, guildId]);
            broadcastMessage({ type: 'PROFILE_UPDATE', data: updated, guildId });

            // If guild is orphaned (owned by system_import), first claimant becomes guild owner
            const guild: any = await db.getNodeQuery('SELECT owner_account_id FROM guilds WHERE id = ?', [guildId]);
            if (guild && guild.owner_account_id === 'system_import') {
                await db.runNodeQuery('UPDATE guilds SET owner_account_id = ? WHERE id = ?', [accountId, guildId]);
                console.log(`[Profiles] Guild ${guildId} ownership transferred to ${accountId} (first claim)`);
            }

            res.json({ success: true, profileId });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/api/profiles/claim', requireAuth, async (req, res) => {
        const { profileId, guildId } = req.body;
        const accountId = (req as any).accountId;
        try {
            await db.runGuildQuery(guildId, `UPDATE profiles SET account_id = ? WHERE id = ? AND server_id = ?`, [accountId, profileId, guildId]);
            const updated = await db.getGuildQuery(guildId, 'SELECT * FROM profiles WHERE id = ? AND server_id = ?', [profileId, guildId]);
            broadcastMessage({ type: 'PROFILE_UPDATE', data: updated, guildId });

            // If guild is orphaned (owned by system_import), first claimant becomes guild owner
            const guild: any = await db.getNodeQuery('SELECT owner_account_id FROM guilds WHERE id = ?', [guildId]);
            if (guild && guild.owner_account_id === 'system_import') {
                await db.runNodeQuery('UPDATE guilds SET owner_account_id = ? WHERE id = ?', [accountId, guildId]);
                console.log(`[Profiles] Guild ${guildId} ownership transferred to ${accountId} (first claim)`);
            }

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
    router.get('/api/accounts/:accountId/profiles', requireAuth, async (req, res) => {
        try {
            const { accountId } = req.params;
            const servers = await db.getAllLoadedServers();
            const allProfiles: any[] = [];
            for (const server of servers) {
                const profiles = await db.allGuildQuery(server.id, 'SELECT * FROM profiles WHERE account_id = ?', [accountId]);
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
    router.get('/api/accounts/:accountId/profile', requireAuth, async (req, res) => {
        try {
            const { accountId } = req.params;
            const servers = await db.getAllLoadedServers();
            for (const server of servers) {
                const profile: any = await db.getGuildQuery(server.id, 'SELECT * FROM profiles WHERE account_id = ?', [accountId]);
                if (profile) return res.json(profile);
            }
            res.status(404).json({ error: 'No profile found for account' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/api/admin/profiles/:profileId/reset', requireNodeOperator, async (req: any, res: any) => {
        try {
            const { profileId } = req.params;
            const { guildId } = req.body;
            await db.runGuildQuery(guildId, 'UPDATE profiles SET account_id = NULL WHERE id = ?', [profileId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/api/profiles/:profileId/aliases', requireNodeOperator, async (req: any, res: any) => {
        try {
            const { profileId } = req.params;
            const { aliases, guildId } = req.body;
            await db.runGuildQuery(guildId, 'UPDATE profiles SET aliases = ? WHERE id = ?', [aliases || '', profileId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/api/profiles/global', requireAuth, async (req: any, res: any) => {
        try {
            const accountId = req.accountId;
            const { display_name, bio, avatar_url, status_message } = req.body;
            
            let currentProfile: any = await db.getNodeQuery('SELECT version FROM global_profiles WHERE account_id = ?', [accountId]);
            let newVersion = 1;
            if (currentProfile) {
                newVersion = (currentProfile.version || 0) + 1;
            }

            const cleanDisplayName = display_name !== undefined ? display_name : '';
            const cleanBio = bio !== undefined ? bio : '';
            let cleanAvatar = avatar_url !== undefined ? avatar_url : '';
            const cleanStatus = status_message !== undefined ? status_message : '';

            // Ensure avatar URL is absolute before signing and distributing it globally
            if (cleanAvatar && !cleanAvatar.startsWith('http') && !cleanAvatar.startsWith('data:')) {
                const account: any = await db.getNodeQuery('SELECT primary_server_url FROM accounts WHERE id = ?', [accountId]);
                if (account && account.primary_server_url) {
                    cleanAvatar = `${account.primary_server_url}${cleanAvatar}`;
                }
            }

            const payloadToSign = {
                account_id: accountId,
                display_name: cleanDisplayName,
                bio: cleanBio,
                avatar_url: cleanAvatar,
                status_message: cleanStatus,
                version: newVersion
            };

            const signature = signDelegationPayload(payloadToSign, getServerIdentity().privateKey);

            await db.runNodeQuery(`
                INSERT INTO global_profiles (account_id, display_name, bio, avatar_url, status_message, version, signature)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_id) DO UPDATE SET
                    display_name = excluded.display_name,
                    bio = excluded.bio,
                    avatar_url = excluded.avatar_url,
                    status_message = excluded.status_message,
                    version = excluded.version,
                    signature = excluded.signature
            `, [accountId, cleanDisplayName, cleanBio, cleanAvatar, cleanStatus, newVersion, signature]);

            // Propagate display_name and avatar to all LOCAL per-guild profiles for this account
            const servers = await db.getAllLoadedServers();
            for (const server of servers) {
                const updateParts: string[] = [];
                const updateParams: any[] = [];
                if (cleanAvatar !== undefined) { updateParts.push('avatar = ?'); updateParams.push(cleanAvatar); }
                if (cleanDisplayName) { updateParts.push('original_username = ?, nickname = ?'); updateParams.push(cleanDisplayName, cleanDisplayName); }
                if (updateParts.length > 0) {
                    updateParams.push(accountId);
                    await db.runGuildQuery(server.id, `UPDATE profiles SET ${updateParts.join(', ')} WHERE account_id = ?`, updateParams);
                    const updatedServerProfile = await db.getGuildQuery(server.id, 'SELECT * FROM profiles WHERE account_id = ?', [accountId]);
                    if (updatedServerProfile) {
                        broadcastMessage({ type: 'PROFILE_UPDATE', data: updatedServerProfile, guildId: server.id });
                    }
                }
            }

            const updatedProfile = await db.getNodeQuery('SELECT * FROM global_profiles WHERE account_id = ?', [accountId]);

            // Push the signed profile update to ALL known servers (trusted and untrusted)
            const selfUrl = `${req.protocol}://${req.get('host')}`;
            const primaryPubKey = (getServerIdentity().publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
            const allServers = await db.allNodeQuery('SELECT server_url FROM account_servers WHERE account_id = ?', [accountId]);
            for (const srv of (allServers || []) as any[]) {
                if (srv.server_url === selfUrl) continue;
                // Fire-and-forget: push signed payload to each remote server
                (async () => {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 3000);
                        await federationFetch(`${srv.server_url}/api/federation/profile-update`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                profile: {
                                    account_id: accountId,
                                    display_name: cleanDisplayName,
                                    bio: cleanBio,
                                    avatar_url: cleanAvatar,
                                    status_message: cleanStatus,
                                    version: newVersion,
                                    signature
                                },
                                primaryPublicKey: primaryPubKey
                            }),
                            signal: controller.signal as any
                        });
                        clearTimeout(timeoutId);
                    } catch (err: any) {
                        console.log(`[Federation] Failed to push profile update to ${srv.server_url}: ${err.message}`);
                    }
                })();
            }

            res.json(updatedProfile);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/api/federation/profile/:accountId', async (req: any, res: any) => {
        try {
            const { accountId } = req.params;
            const profile = await db.getNodeQuery('SELECT * FROM global_profiles WHERE account_id = ?', [accountId]);
            if (!profile) return res.status(404).json({ error: 'Global profile not found' });
            res.json(profile);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /api/federation/profile-update
     * Receives a signed global profile payload pushed from the primary server.
     * Verifies the cryptographic signature against the provided primary public key,
     * then updates the local global_profiles cache and per-server profiles.
     * No JWT required — authentication is via the Ed25519 signature.
     */
    router.post('/api/federation/profile-update', async (req: any, res: any) => {
        try {
            const { profile, primaryPublicKey } = req.body;
            if (!profile || !primaryPublicKey || !profile.account_id || !profile.signature) {
                return res.status(400).json({ error: 'Missing required fields: profile, primaryPublicKey' });
            }

            // Rebuild the payload that was signed and verify
            const payloadToVerify = {
                account_id: profile.account_id,
                display_name: profile.display_name,
                bio: profile.bio,
                avatar_url: profile.avatar_url,
                status_message: profile.status_message,
                version: profile.version
            };

            const isValid = verifyDelegationSignature(payloadToVerify, profile.signature, primaryPublicKey);
            if (!isValid) {
                return res.status(401).json({ error: 'Invalid signature: profile update rejected' });
            }

            // Check if this version is newer than what we have
            const localProfile: any = await db.getNodeQuery('SELECT version FROM global_profiles WHERE account_id = ?', [profile.account_id]);
            const localVersion = localProfile ? (localProfile.version || 0) : 0;

            if (profile.version <= localVersion) {
                return res.json({ success: true, message: 'Already up to date' });
            }

            // Update the global_profiles cache
            await db.runNodeQuery(`
                INSERT INTO global_profiles (account_id, display_name, bio, avatar_url, status_message, version, signature)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_id) DO UPDATE SET
                    display_name = excluded.display_name,
                    bio = excluded.bio,
                    avatar_url = excluded.avatar_url,
                    status_message = excluded.status_message,
                    version = excluded.version,
                    signature = excluded.signature
            `, [
                profile.account_id, profile.display_name || '', profile.bio, profile.avatar_url,
                profile.status_message, profile.version, profile.signature
            ]);

            // Propagate to all local per-guild profiles
            const servers = await db.getAllLoadedServers();
            for (const server of servers) {
                const updateParts: string[] = [];
                const updateParams: any[] = [];
                if (profile.avatar_url !== undefined) { updateParts.push('avatar = ?'); updateParams.push(profile.avatar_url); }
                if (profile.display_name) { updateParts.push('original_username = ?, nickname = ?'); updateParams.push(profile.display_name, profile.display_name); }
                if (updateParts.length > 0) {
                    updateParams.push(profile.account_id);
                    await db.runGuildQuery(server.id, `UPDATE profiles SET ${updateParts.join(', ')} WHERE account_id = ?`, updateParams);
                    const updatedServerProfile = await db.getGuildQuery(server.id, 'SELECT * FROM profiles WHERE account_id = ?', [profile.account_id]);
                    if (updatedServerProfile) {
                        broadcastMessage({ type: 'PROFILE_UPDATE', data: updatedServerProfile, guildId: server.id });
                    }
                }
            }

            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
