import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireNodeOperator, requireGuildAccess, requireGuildOwner, requireNodeOperatorOrGuildOwner } from '../middleware/rbac';
import { GUILDS_DIR } from '../database';
import { generateGuildIdentity } from '../crypto/guild_identity';
import { exportGuild, getExportStats, getExportProgress } from '../guild_export';
import { validateExportBundle, importGuild, relinkMemberProfile } from '../guild_import';
import os from 'os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_ICON_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_ICON_SIZE = 8 * 1024 * 1024; // 8MB

/** Whitelist of node settings that can be updated via the API. */
const ALLOWED_NODE_SETTINGS = new Set([
    'allow_open_guild_creation',
    'default_max_members',
    'max_guilds',
    'guild_isolation',
]);

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Validates and authorizes a guild creation request.
 * Returns { authorized: true, provisionCodeEntry? } or { authorized: false, error, status }.
 */
async function authorizeGuildCreation(
    db: any,
    accountId: string,
    provisionCode?: string
): Promise<{ authorized: boolean; provisionCodeEntry?: any; error?: string; status?: number }> {
    // 1. Node operator (is_creator=1) — always allowed
    const account: any = await db.getNodeQuery('SELECT is_creator FROM accounts WHERE id = ?', [accountId]);
    if (account?.is_creator) {
        return { authorized: true };
    }

    // 2. Provision code
    if (provisionCode) {
        const validation = await db.validateProvisionCode(provisionCode);
        if (!validation.valid) {
            return { authorized: false, error: `Invalid provision code: ${validation.error}`, status: 403 };
        }
        return { authorized: true, provisionCodeEntry: validation.code };
    }

    // 3. Open guild creation setting
    const openCreation = await db.getNodeSetting('allow_open_guild_creation');
    if (openCreation === 'true') {
        return { authorized: true };
    }

    return { authorized: false, error: 'Forbidden: You need a provision code or node operator access to create guilds', status: 403 };
}

/**
 * Seeds default channels in a newly created guild.
 * If custom channels are provided, creates those. Otherwise creates a default "general" text channel.
 */
async function seedGuildChannels(
    db: any,
    guildId: string,
    channels?: { text?: string[]; voice?: string[] }
): Promise<void> {
    if (channels && (channels.text?.length || channels.voice?.length)) {
        // Custom channels
        if (channels.text?.length) {
            const categoryId = crypto.randomUUID();
            await db.runGuildQuery(guildId,
                'INSERT INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)',
                [categoryId, guildId, 'Text Channels', 0]
            );
            for (let i = 0; i < channels.text.length; i++) {
                const channelId = crypto.randomUUID();
                await db.runGuildQuery(guildId,
                    'INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, ?)',
                    [channelId, guildId, categoryId, channels.text[i], 'text', i]
                );
                if (db.channelToGuildId) {
                    db.channelToGuildId.set(channelId, guildId);
                }
            }
        }
        if (channels.voice?.length) {
            const categoryId = crypto.randomUUID();
            await db.runGuildQuery(guildId,
                'INSERT INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)',
                [categoryId, guildId, 'Voice Channels', 1]
            );
            for (let i = 0; i < channels.voice.length; i++) {
                const channelId = crypto.randomUUID();
                await db.runGuildQuery(guildId,
                    'INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, ?)',
                    [channelId, guildId, categoryId, channels.voice[i], 'voice', i]
                );
                if (db.channelToGuildId) {
                    db.channelToGuildId.set(channelId, guildId);
                }
            }
        }
    } else {
        // Default: one text category with a "general" channel
        const categoryId = crypto.randomUUID();
        await db.runGuildQuery(guildId,
            'INSERT INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)',
            [categoryId, guildId, 'Text Channels', 0]
        );
        const channelId = crypto.randomUUID();
        await db.runGuildQuery(guildId,
            'INSERT INTO channels (id, server_id, category_id, name, type, position) VALUES (?, ?, ?, ?, ?, ?)',
            [channelId, guildId, categoryId, 'general', 'text', 0]
        );
        if (db.channelToGuildId) {
            db.channelToGuildId.set(channelId, guildId);
        }
    }
}

/**
 * Creates the guild owner's profile within the guild database.
 * Uses the owner's global profile (display_name, avatar) if available,
 * falling back to the email prefix.
 */
async function createOwnerProfile(
    db: any,
    guildId: string,
    ownerAccountId: string,
    broadcastMessage: (v: any) => void
): Promise<void> {
    const profileId = crypto.randomUUID();
    const account: any = await db.getNodeQuery('SELECT email FROM accounts WHERE id = ?', [ownerAccountId]);
    const globalProfile: any = await db.getNodeQuery('SELECT display_name, avatar_url FROM global_profiles WHERE account_id = ?', [ownerAccountId]);
    const nickname = globalProfile?.display_name || account?.email?.split('@')[0] || 'Owner';
    const avatarUrl = globalProfile?.avatar_url || '';

    await db.runGuildQuery(guildId,
        'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role, membership_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [profileId, guildId, ownerAccountId, nickname, nickname, avatarUrl, 'OWNER', 'active']
    );

    const profile = await db.getGuildQuery(guildId,
        'SELECT * FROM profiles WHERE id = ? AND server_id = ?',
        [profileId, guildId]
    );
    broadcastMessage({ type: 'PROFILE_UPDATE', data: profile, guildId });
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export const createGuildRoutes = (db: any, broadcastMessage: (v: any) => void) => {
    const router = Router();

    // -----------------------------------------------------------------------
    // Guild Import Routes
    // IMPORTANT: These must be registered BEFORE parameterized :guildId routes
    // to avoid "import" being matched as a guild ID.
    // -----------------------------------------------------------------------

    // Multer config for import uploads — accept up to 10GB
    const importUpload = multer({
        dest: os.tmpdir(),
        limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB
    });

    // POST /api/guilds/import/validate — Validate without importing
    router.post('/api/guilds/import/validate', requireAuth, importUpload.single('bundle'), async (req: any, res: any) => {
        const file = req.file;
        try {
            if (!file) {
                return res.status(400).json({ error: 'No ZIP file provided. Use multipart form field "bundle".' });
            }

            const validation = await validateExportBundle(file.path);
            res.json(validation);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        } finally {
            // Clean up uploaded temp file
            if (file?.path) {
                try { fs.unlinkSync(file.path); } catch { /* ignore */ }
            }
        }
    });

    // POST /api/guilds/import — Import a guild from export bundle
    router.post('/api/guilds/import', requireAuth, importUpload.single('bundle'), async (req: any, res: any) => {
        const file = req.file;
        try {
            if (!file) {
                return res.status(400).json({ error: 'No ZIP file provided. Use multipart form field "bundle".' });
            }

            const accountId = req.accountId;
            const provisionCode = req.body?.provisionCode;

            // Authorize: node operator OR valid provision code
            const authResult = await authorizeGuildCreation(db, accountId, provisionCode);
            if (!authResult.authorized) {
                return res.status(authResult.status || 403).json({ error: authResult.error });
            }

            // Validate first
            const validation = await validateExportBundle(file.path);
            if (!validation.valid) {
                return res.status(400).json({
                    error: 'Invalid export bundle',
                    details: validation.errors,
                });
            }

            // Get owner's public key
            const ownerRecord: any = await db.getNodeQuery('SELECT public_key FROM accounts WHERE id = ?', [accountId]);
            const ownerPublicKey = ownerRecord?.public_key || '';

            // Import
            const result = await importGuild(file.path, accountId, ownerPublicKey);

            // Consume provision code if used
            if (provisionCode && authResult.provisionCodeEntry) {
                await db.consumeProvisionCode(provisionCode, accountId, result.guildId);
            }

            res.json({
                success: true,
                guildId: result.guildId,
                name: result.name,
                fingerprint: result.fingerprint,
                manifest: validation.manifest,
            });
        } catch (err: any) {
            console.error('[GuildImport] API import error:', err);
            res.status(500).json({ error: err.message });
        } finally {
            // Clean up uploaded temp file
            if (file?.path) {
                try { fs.unlinkSync(file.path); } catch { /* ignore */ }
            }
        }
    });

    // -----------------------------------------------------------------------
    // POST /api/guilds — Create a new guild
    // -----------------------------------------------------------------------
    router.post('/api/guilds', requireAuth, async (req: any, res: any) => {
        try {
            const { name, description, provisionCode, ownerEmail, channels } = req.body;
            const accountId = req.accountId;

            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({ error: 'Guild name is required' });
            }

            // Authorize
            const authResult = await authorizeGuildCreation(db, accountId, provisionCode);
            if (!authResult.authorized) {
                return res.status(authResult.status || 403).json({ error: authResult.error });
            }

            // Determine owner
            let ownerAccountId = accountId;
            if (ownerEmail) {
                // Only node operators can assign ownership to another account
                const requester: any = await db.getNodeQuery('SELECT is_creator FROM accounts WHERE id = ?', [accountId]);
                if (!requester?.is_creator) {
                    return res.status(403).json({ error: 'Only node operators can assign guild ownership to another account' });
                }
                const ownerAccount: any = await db.getNodeQuery('SELECT id FROM accounts WHERE email = ?', [ownerEmail]);
                if (!ownerAccount) {
                    return res.status(404).json({ error: `Account not found for email: ${ownerEmail}` });
                }
                ownerAccountId = ownerAccount.id;
            }

            // Get owner's public key for guild identity encryption
            const ownerRecord: any = await db.getNodeQuery('SELECT public_key FROM accounts WHERE id = ?', [ownerAccountId]);
            const ownerPublicKey = ownerRecord?.public_key || '';

            // Generate guild ID
            const guildId = 'guild-' + crypto.randomUUID();

            // Create guild directory, DB, and registry entry
            await db.initializeGuildBundle(guildId, name.trim(), '', ownerAccountId, description || '', ownerPublicKey);

            // Wait for DB init to settle
            await new Promise(resolve => setTimeout(resolve, 100));

            // Seed channels
            await seedGuildChannels(db, guildId, channels);

            // Create owner profile
            await createOwnerProfile(db, guildId, ownerAccountId, broadcastMessage);

            // Consume provision code if one was used
            if (provisionCode && authResult.provisionCodeEntry) {
                await db.consumeProvisionCode(provisionCode, accountId, guildId);
            }

            // Get the guild registry entry for the response
            const registryEntry = await db.getGuildRegistryEntry(guildId);

            res.json({
                id: guildId,
                name: name.trim(),
                description: description || '',
                fingerprint: registryEntry?.fingerprint || '',
                status: 'active',
                owner_account_id: ownerAccountId,
            });
        } catch (err: any) {
            console.error('[GuildRoutes] Error creating guild:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // PUT /api/guilds/:guildId/icon — Upload guild icon
    // -----------------------------------------------------------------------
    router.put('/api/guilds/:guildId/icon',
        ...requireGuildOwner,
        multer({ limits: { fileSize: MAX_ICON_SIZE, files: 1 } }).single('icon'),
        async (req: any, res: any) => {
            try {
                const { guildId } = req.params;
                const file = req.file;
                if (!file) return res.status(400).json({ error: 'No icon file provided' });

                // Magic-byte validation
                const fileTypeMod = await import('file-type');
                const fileType = fileTypeMod.default || fileTypeMod;
                const fromBuffer = fileType.fromBuffer || (fileType as any).fileTypeFromBuffer || (fileTypeMod as any).fileTypeFromBuffer;
                const detected = await fromBuffer(file.buffer);
                if (!detected || !ALLOWED_ICON_MIMES.has(detected.mime)) {
                    return res.status(400).json({
                        error: `Invalid image type: ${detected?.mime ?? 'unknown'}. Allowed: PNG, JPEG, GIF, WebP.`
                    });
                }

                const ext = detected.ext || 'png';
                const guildDir = path.join(GUILDS_DIR, guildId);
                if (!fs.existsSync(guildDir)) fs.mkdirSync(guildDir, { recursive: true });

                const filename = `guild_icon.${ext}`;
                const filePath = path.join(guildDir, filename);
                fs.writeFileSync(filePath, file.buffer);

                const iconUrl = `/guilds/${guildId}/${filename}`;

                // Update guild registry (node.db)
                await db.runNodeQuery('UPDATE guilds SET icon = ? WHERE id = ?', [iconUrl, guildId]);

                // Update guild DB (guild_info table)
                try {
                    await db.runGuildQuery(guildId, 'UPDATE guild_info SET icon = ? WHERE id = ?', [iconUrl, guildId]);
                } catch { /* guild_info may not have this guild loaded yet */ }

                res.json({ icon: iconUrl });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        }
    );

    // -----------------------------------------------------------------------
    // POST /api/guilds/:guildId/join — Join a guild (first-user-auto-join, invite, or open_join)
    // -----------------------------------------------------------------------
    router.post('/api/guilds/:guildId/join', requireAuth, async (req: any, res: any) => {
        try {
            const { guildId } = req.params;
            const { inviteToken } = req.body;
            const accountId = req.accountId;
            if (!accountId) return res.status(401).json({ error: 'Unauthorized' });

            // Verify guild exists and is active
            const guildEntry: any = await db.getNodeQuery(
                'SELECT id, name, status FROM guilds WHERE id = ?', [guildId]
            );
            if (!guildEntry) {
                return res.status(404).json({ error: 'Guild not found' });
            }
            if (guildEntry.status !== 'active') {
                return res.status(403).json({ error: `Cannot join a ${guildEntry.status} guild` });
            }

            // Check if user already has an active profile in this guild
            const existingProfile: any = await db.getGuildQuery(guildId,
                'SELECT id FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?',
                [accountId, guildId, 'active']
            );
            if (existingProfile) {
                return res.status(409).json({ error: 'Already a member of this guild' });
            }

            // Check for a "left" profile to reactivate
            const leftProfile: any = await db.getGuildQuery(guildId,
                'SELECT * FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?',
                [accountId, guildId, 'left']
            );
            if (leftProfile) {
                // Reactivate the existing profile
                await db.runGuildQuery(guildId,
                    'UPDATE profiles SET membership_status = ?, left_at = NULL WHERE id = ? AND server_id = ?',
                    ['active', leftProfile.id, guildId]
                );
                await db.runNodeQuery('UPDATE accounts SET is_deactivated = 0 WHERE id = ?', [accountId]);
                const reactivated = await db.getGuildQuery(guildId,
                    'SELECT * FROM profiles WHERE id = ? AND server_id = ?',
                    [leftProfile.id, guildId]
                );
                broadcastMessage({ type: 'MEMBER_JOIN', data: reactivated, guildId });
                return res.json(reactivated);
            }

            // Count REAL Harmony members — imported Discord profiles have
            // account_ids that are Discord snowflakes, not real Harmony accounts.
            // We must cross-reference against node.db's accounts table.
            const allActiveProfiles: any[] = await db.allGuildQuery(guildId,
                'SELECT account_id FROM profiles WHERE server_id = ? AND membership_status = ? AND account_id IS NOT NULL',
                [guildId, 'active']
            );
            let activeMemberCount = 0;
            for (const p of allActiveProfiles) {
                const acct: any = await db.getNodeQuery('SELECT id FROM accounts WHERE id = ?', [p.account_id]);
                if (acct) activeMemberCount++;
            }

            let assignedRole = 'USER';

            if (activeMemberCount === 0) {
                // First-user-auto-join: no members at all, first joiner becomes OWNER
                assignedRole = 'OWNER';
                console.log(`[GUILD JOIN] First user ${accountId} claiming ownership of memberless guild ${guildId}`);
            } else if (inviteToken) {
                // Validate the invite token
                const now = Date.now();
                const invite: any = await db.getNodeQuery(
                    'SELECT * FROM invites WHERE token = ? AND guild_id = ? AND current_uses < max_uses AND expires_at > ?',
                    [inviteToken, guildId, now]
                );
                if (!invite) {
                    return res.status(403).json({ error: 'Invalid, expired, or fully used invite token' });
                }
                // Consume the invite
                await db.runNodeQuery(
                    'UPDATE invites SET current_uses = current_uses + 1 WHERE token = ?',
                    [inviteToken]
                );
                assignedRole = 'USER';
            } else {
                // Check open_join setting
                let openJoin = false;
                try {
                    const setting: any = await db.getGuildQuery(guildId,
                        'SELECT value FROM server_settings WHERE key = ?', ['open_join']
                    );
                    openJoin = setting?.value === 'true';
                } catch { /* guild DB might not have settings table yet */ }

                if (!openJoin) {
                    return res.status(403).json({
                        error: 'This guild requires an invite to join',
                        invite_required: true
                    });
                }
                assignedRole = 'USER';
            }

            // Ensure a local account record exists for federated users
            const localAccount: any = await db.getNodeQuery('SELECT id FROM accounts WHERE id = ?', [accountId]);
            if (!localAccount) {
                return res.status(400).json({ error: 'Account not synced to this node. Trust the node first.' });
            }

            // Reactivate deactivated accounts
            await db.runNodeQuery('UPDATE accounts SET is_deactivated = 0 WHERE id = ? AND is_deactivated = 1', [accountId]);

            // If first user became OWNER, register them as guild owner in the registry.
            // The current owner_account_id may be a Discord snowflake, 'ORPHANED', or empty —
            // we need to check if the current owner is a real Harmony account.
            if (assignedRole === 'OWNER') {
                try {
                    const registryEntry: any = await db.getNodeQuery(
                        'SELECT owner_account_id FROM guilds WHERE id = ?', [guildId]
                    );
                    let shouldClaim = false;
                    if (!registryEntry?.owner_account_id) {
                        shouldClaim = true;
                    } else {
                        // Check if current owner is a real Harmony account
                        const ownerAcct: any = await db.getNodeQuery(
                            'SELECT id FROM accounts WHERE id = ?', [registryEntry.owner_account_id]
                        );
                        if (!ownerAcct) shouldClaim = true; // Ghost owner (Discord snowflake, ORPHANED, etc.)
                    }
                    if (shouldClaim) {
                        await db.runNodeQuery(
                            'UPDATE guilds SET owner_account_id = ? WHERE id = ?',
                            [accountId, guildId]
                        );
                        console.log(`[GUILD JOIN] Claimed guild ${guildId} ownership for account ${accountId}`);
                    }
                } catch { /* non-fatal */ }
            }

            // Check if this guild has unclaimed imported profiles (Discord ghost profiles).
            // If so, defer profile creation to the ClaimProfile flow so the user can
            // choose to claim an existing identity or start fresh.
            // NOTE: profiles and accounts are in separate DBs, so we cross-check in JS.
            const allGuildProfiles: any[] = await db.allGuildQuery(guildId,
                'SELECT id, account_id FROM profiles WHERE server_id = ?',
                [guildId]
            );
            let unclaimedCount = 0;
            for (const p of allGuildProfiles) {
                if (!p.account_id) {
                    unclaimedCount++; // NULL account_id = imported with no link
                } else {
                    const acct: any = await db.getNodeQuery('SELECT id FROM accounts WHERE id = ?', [p.account_id]);
                    if (!acct) unclaimedCount++; // account_id doesn't match any Harmony account
                }
            }
            const hasUnclaimedImports = unclaimedCount > 0;

            if (hasUnclaimedImports) {
                // Don't auto-create a profile — let ClaimProfile handle it.
                // The user's account is already authorized (local record exists),
                // and the guild map/sidebar will show this guild.
                console.log(`[GUILD JOIN] Guild ${guildId} has ${unclaimedCount} unclaimed profiles — deferring to ClaimProfile flow`);
                return res.json({
                    needs_profile_setup: true,
                    guild_id: guildId,
                    guild_name: guildEntry.name,
                    guild_icon: guildEntry.icon || '',
                    role: assignedRole,
                });
            }

            // No unclaimed imports — this is a fresh guild, auto-create a profile.
            // Get display_name and avatar from global profile cache
            let avatarUrl = '';
            let displayName = '';
            const globalProfile: any = await db.getNodeQuery('SELECT display_name, avatar_url FROM global_profiles WHERE account_id = ?', [accountId]);
            if (globalProfile?.avatar_url) avatarUrl = globalProfile.avatar_url;
            if (globalProfile?.display_name) displayName = globalProfile.display_name;

            // Create the profile
            const profileId = crypto.randomUUID();
            const account: any = await db.getNodeQuery('SELECT email FROM accounts WHERE id = ?', [accountId]);
            const nickname = displayName || account?.email?.split('@')[0] || 'User';

            await db.runGuildQuery(guildId,
                'INSERT INTO profiles (id, server_id, account_id, original_username, nickname, avatar, role, membership_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [profileId, guildId, accountId, nickname, nickname, avatarUrl, assignedRole, 'active']
            );

            const newProfile = await db.getGuildQuery(guildId,
                'SELECT * FROM profiles WHERE id = ? AND server_id = ?',
                [profileId, guildId]
            );
            broadcastMessage({ type: 'MEMBER_JOIN', data: newProfile, guildId });

            // Attempt to relink if there are ghost profiles for this account
            try {
                const relinkResult = await relinkMemberProfile(guildId, accountId, profileId);
                if (relinkResult.relinked) {
                    console.log(`[GUILD JOIN] Relinked member ${accountId} to old profile ${relinkResult.oldProfileId}`);
                    const relinkedProfile = await db.getGuildQuery(guildId,
                        'SELECT * FROM profiles WHERE id = ? AND server_id = ?',
                        [profileId, guildId]
                    );
                    broadcastMessage({ type: 'PROFILE_UPDATE', data: relinkedProfile, guildId });
                    return res.json(relinkedProfile);
                }
            } catch (relinkErr) {
                console.warn('[GUILD JOIN] Relink attempt failed (non-fatal):', relinkErr);
            }

            res.json(newProfile);
        } catch (err: any) {
            console.error('[GUILD JOIN] Error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // GET /api/guilds/discoverable — Guilds available to join (memberless + open_join)
    // IMPORTANT: Must be registered BEFORE parameterized :guildId routes
    // -----------------------------------------------------------------------
    router.get('/api/guilds/discoverable', requireAuth, async (req: any, res: any) => {
        try {
            const accountId = req.accountId;
            const allGuilds = await db.getAllRegisteredGuilds();
            const discoverable = [];

            for (const guild of allGuilds) {
                if (guild.status !== 'active') continue;

                try {
                    // Check if user is already a member
                    const existingProfile: any = await db.getGuildQuery(guild.id,
                        'SELECT id FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?',
                        [accountId, guild.id, 'active']
                    );
                    if (existingProfile) continue; // Already a member, skip

                    // Count REAL Harmony members — imported Discord profiles have
                    // account_ids that are Discord snowflakes, not real Harmony accounts.
                    // We must cross-reference against node.db's accounts table.
                    const allProfiles: any[] = await db.allGuildQuery(guild.id,
                        'SELECT account_id FROM profiles WHERE server_id = ? AND membership_status = ? AND account_id IS NOT NULL',
                        [guild.id, 'active']
                    );
                    let realMemberCount = 0;
                    for (const p of allProfiles) {
                        const acct: any = await db.getNodeQuery('SELECT id FROM accounts WHERE id = ?', [p.account_id]);
                        if (acct) realMemberCount++;
                    }
                    const count = realMemberCount;

                    // Check open_join setting
                    let openJoin = false;
                    try {
                        const setting: any = await db.getGuildQuery(guild.id,
                            'SELECT value FROM server_settings WHERE key = ?', ['open_join']
                        );
                        openJoin = setting?.value === 'true';
                    } catch { /* ignore */ }

                    // Discoverable if: zero members (orphaned) OR open_join enabled
                    if (count === 0 || openJoin) {
                        discoverable.push({
                            id: guild.id,
                            name: guild.name,
                            icon: guild.icon || '',
                            description: guild.description || '',
                            member_count: count,
                            open_join: openJoin,
                            is_claimable: count === 0,
                        });
                    }
                } catch {
                    // Guild DB may not be loaded — skip silently
                }
            }

            res.json(discoverable);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // GET /api/guilds — List guilds for current user
    // -----------------------------------------------------------------------
    router.get('/api/guilds', requireAuth, async (req: any, res: any) => {
        try {
            const accountId = req.accountId;

            // Check if user is node operator
            const account: any = await db.getNodeQuery('SELECT is_creator FROM accounts WHERE id = ?', [accountId]);

            if (account?.is_creator) {
                // Node operator: return ALL guilds from registry
                const guilds = await db.getAllRegisteredGuilds();
                console.log('[GET /api/guilds] Node operator, returning all', guilds.length, 'guilds');
                return res.json(guilds.map((g: any) => ({
                    id: g.id,
                    name: g.name,
                    icon: g.icon,
                    description: g.description,
                    status: g.status,
                    owner_account_id: g.owner_account_id,
                    fingerprint: g.fingerprint,
                    max_members: g.max_members,
                    created_at: g.created_at,
                })));
            }

            // Regular user: return only guilds where user has an active profile
            // OR where the user is the registered owner (handles needs_profile_setup flow)
            const allGuilds = await db.getAllRegisteredGuilds();
            const memberGuilds = [];

            for (const guild of allGuilds) {
                try {
                    // Check active profile membership
                    const profile: any = await db.getGuildQuery(guild.id,
                        'SELECT id FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?',
                        [accountId, guild.id, 'active']
                    );
                    // Also check if user is registered owner (from claim-before-profile-setup)
                    const isRegistryOwner = guild.owner_account_id === accountId;
                    console.log('[GET /api/guilds] Guild', guild.id, '| profile:', !!profile, '| registryOwner:', isRegistryOwner, '(owner:', guild.owner_account_id, 'vs', accountId, ')');

                    if (profile || isRegistryOwner) {
                        memberGuilds.push({
                            id: guild.id,
                            name: guild.name,
                            icon: guild.icon,
                            description: guild.description,
                            status: guild.status,
                            owner_account_id: guild.owner_account_id,
                            fingerprint: guild.fingerprint,
                            max_members: guild.max_members,
                            created_at: guild.created_at,
                        });
                    }
                } catch {
                    // Guild DB may not be loaded — skip silently
                }
            }

            console.log('[GET /api/guilds] Returning', memberGuilds.length, 'guilds for account', accountId);
            res.json(memberGuilds);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // GET /api/guilds/:guildId/info — Get guild metadata
    // -----------------------------------------------------------------------
    router.get('/api/guilds/:guildId/info', ...requireGuildAccess, async (req: any, res: any) => {
        try {
            const { guildId } = req.params;

            const guildInfo: any = await db.getGuildQuery(guildId,
                'SELECT * FROM guild_info WHERE id = ?', [guildId]
            );

            const memberCount: any = await db.getGuildQuery(guildId,
                'SELECT COUNT(*) as count FROM profiles WHERE server_id = ? AND membership_status = ?',
                [guildId, 'active']
            );

            const channelCount: any = await db.getGuildQuery(guildId,
                'SELECT COUNT(*) as count FROM channels WHERE server_id = ?',
                [guildId]
            );

            const registryEntry = await db.getGuildRegistryEntry(guildId);

            res.json({
                id: guildId,
                name: guildInfo?.name || registryEntry?.name || '',
                icon: guildInfo?.icon || registryEntry?.icon || '',
                description: guildInfo?.description || registryEntry?.description || '',
                member_count: memberCount?.count || 0,
                channel_count: channelCount?.count || 0,
                created_at: registryEntry?.created_at || 0,
                fingerprint: registryEntry?.fingerprint || '',
                status: registryEntry?.status || 'active',
            });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // PUT /api/guilds/:guildId — Update guild metadata
    // -----------------------------------------------------------------------
    router.put('/api/guilds/:guildId', ...requireGuildOwner, async (req: any, res: any) => {
        try {
            const { guildId } = req.params;
            const { name, description, icon } = req.body;

            // Update guild registry (node.db)
            const sets: string[] = [];
            const params: any[] = [];

            if (name !== undefined) { sets.push('name = ?'); params.push(name); }
            if (description !== undefined) { sets.push('description = ?'); params.push(description); }
            if (icon !== undefined) { sets.push('icon = ?'); params.push(icon); }

            if (sets.length > 0) {
                params.push(guildId);
                await db.runNodeQuery(`UPDATE guilds SET ${sets.join(', ')} WHERE id = ?`, params);
            }

            // Update guild DB (guild_info table)
            const guildSets: string[] = [];
            const guildParams: any[] = [];

            if (name !== undefined) { guildSets.push('name = ?'); guildParams.push(name); }
            if (description !== undefined) { guildSets.push('description = ?'); guildParams.push(description); }
            if (icon !== undefined) { guildSets.push('icon = ?'); guildParams.push(icon); }

            if (guildSets.length > 0) {
                guildParams.push(guildId);
                await db.runGuildQuery(guildId, `UPDATE guild_info SET ${guildSets.join(', ')} WHERE id = ?`, guildParams);
            }

            const updated = await db.getGuildRegistryEntry(guildId);
            res.json(updated);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // POST /api/guilds/:guildId/suspend — Suspend a guild (operator only)
    // -----------------------------------------------------------------------
    router.post('/api/guilds/:guildId/suspend', ...requireNodeOperator, async (req: any, res: any) => {
        try {
            const { guildId } = req.params;

            const guild = await db.getGuildRegistryEntry(guildId);
            if (!guild) return res.status(404).json({ error: 'Guild not found' });

            await db.updateGuildStatus(guildId, 'suspended');

            // Unload the guild instance (stop the worker)
            try { db.unloadGuildInstance(guildId); } catch { /* may not be loaded */ }

            broadcastMessage({ type: 'GUILD_STATUS_CHANGE', data: { guildId, status: 'suspended' }, guildId });

            res.json({ success: true, guildId, status: 'suspended' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // POST /api/guilds/:guildId/resume — Resume a suspended guild (operator only)
    // -----------------------------------------------------------------------
    router.post('/api/guilds/:guildId/resume', ...requireNodeOperator, async (req: any, res: any) => {
        try {
            const { guildId } = req.params;

            const guild = await db.getGuildRegistryEntry(guildId);
            if (!guild) return res.status(404).json({ error: 'Guild not found' });

            await db.updateGuildStatus(guildId, 'active');

            // Reload the guild instance
            const guildDbPath = path.join(GUILDS_DIR, guildId, 'guild.db');
            if (fs.existsSync(guildDbPath)) {
                db.loadGuildInstance(guildId, guildDbPath);
            }

            broadcastMessage({ type: 'GUILD_STATUS_CHANGE', data: { guildId, status: 'active' }, guildId });

            res.json({ success: true, guildId, status: 'active' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // POST /api/guilds/:guildId/stop — Stop a guild, preserving data (operator only)
    // -----------------------------------------------------------------------
    router.post('/api/guilds/:guildId/stop', ...requireNodeOperator, async (req: any, res: any) => {
        try {
            const { guildId } = req.params;

            const guild = await db.getGuildRegistryEntry(guildId);
            if (!guild) return res.status(404).json({ error: 'Guild not found' });

            await db.updateGuildStatus(guildId, 'stopped');

            // Unload the guild instance
            try { db.unloadGuildInstance(guildId); } catch { /* may not be loaded */ }

            broadcastMessage({ type: 'GUILD_STATUS_CHANGE', data: { guildId, status: 'stopped' }, guildId });

            res.json({ success: true, guildId, status: 'stopped' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // DELETE /api/guilds/:guildId — Delete a guild
    // -----------------------------------------------------------------------
    router.delete('/api/guilds/:guildId', ...requireNodeOperatorOrGuildOwner, async (req: any, res: any) => {
        try {
            const { guildId } = req.params;
            const { confirm, preserveData } = req.body;

            if (!confirm) {
                return res.status(400).json({ error: 'Deletion requires confirm: true in the request body' });
            }

            const guild = await db.getGuildRegistryEntry(guildId);
            if (!guild) return res.status(404).json({ error: 'Guild not found' });

            // Unload the guild instance
            try { db.unloadGuildInstance(guildId); } catch { /* may not be loaded */ }
            // Wait for file handles to release
            await new Promise(resolve => setTimeout(resolve, 100));

            // Remove registry entry
            await db.deleteGuildRegistryEntry(guildId);

            // Delete guild directory unless preserveData is requested
            if (!preserveData) {
                const guildDir = path.join(GUILDS_DIR, guildId);
                if (fs.existsSync(guildDir)) {
                    try {
                        fs.rmSync(guildDir, { recursive: true, force: true });
                    } catch (e: any) {
                        console.warn(`[GuildRoutes] Failed to delete guild directory ${guildDir}: ${e.message}`);
                    }
                }
            }

            broadcastMessage({ type: 'GUILD_DELETED', data: { guildId }, guildId });

            res.json({ success: true, guildId, preserved: !!preserveData });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // POST /api/guilds/:guildId/transfer-ownership — Transfer guild ownership
    // -----------------------------------------------------------------------
    router.post('/api/guilds/:guildId/transfer-ownership', ...requireGuildOwner, async (req: any, res: any) => {
        try {
            const { guildId } = req.params;
            const { newOwnerAccountId } = req.body;
            const currentOwnerId = req.accountId;

            if (!newOwnerAccountId) {
                return res.status(400).json({ error: 'newOwnerAccountId is required' });
            }

            if (newOwnerAccountId === currentOwnerId) {
                return res.status(400).json({ error: 'Cannot transfer ownership to yourself' });
            }

            // Verify new owner has an active profile in the guild
            const newOwnerProfile: any = await db.getGuildQuery(guildId,
                'SELECT id, role FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?',
                [newOwnerAccountId, guildId, 'active']
            );
            if (!newOwnerProfile) {
                return res.status(400).json({ error: 'New owner must be an active member of the guild' });
            }

            // Update registry — owner_account_id
            await db.runNodeQuery('UPDATE guilds SET owner_account_id = ? WHERE id = ?', [newOwnerAccountId, guildId]);

            // Update old owner's profile: OWNER → ADMIN
            await db.runGuildQuery(guildId,
                "UPDATE profiles SET role = 'ADMIN' WHERE account_id = ? AND server_id = ? AND role = 'OWNER'",
                [currentOwnerId, guildId]
            );

            // Update new owner's profile: → OWNER
            await db.runGuildQuery(guildId,
                "UPDATE profiles SET role = 'OWNER' WHERE account_id = ? AND server_id = ?",
                [newOwnerAccountId, guildId]
            );

            // Re-encrypt guild identity key with new owner's public key
            try {
                const newOwnerRecord: any = await db.getNodeQuery('SELECT public_key FROM accounts WHERE id = ?', [newOwnerAccountId]);
                if (newOwnerRecord?.public_key) {
                    const guildDir = path.join(GUILDS_DIR, guildId);
                    const identity = generateGuildIdentity(guildDir, newOwnerRecord.public_key);
                    // Update fingerprint in registry
                    await db.runNodeQuery('UPDATE guilds SET fingerprint = ? WHERE id = ?', [identity.fingerprint, guildId]);
                }
            } catch (err: any) {
                console.warn(`[GuildRoutes] Failed to re-encrypt guild identity during ownership transfer: ${err.message}`);
                // Non-fatal — the guild still works, just the identity key may not be decryptable by the new owner
            }

            broadcastMessage({
                type: 'GUILD_OWNER_CHANGED',
                data: { guildId, oldOwnerId: currentOwnerId, newOwnerId: newOwnerAccountId },
                guildId
            });

            res.json({
                success: true,
                guildId,
                oldOwner: currentOwnerId,
                newOwner: newOwnerAccountId,
            });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // GET /api/node/settings — Get all node settings (operator only)
    // -----------------------------------------------------------------------
    router.get('/api/node/settings', ...requireNodeOperator, async (req: any, res: any) => {
        try {
            const settings = await db.getAllNodeSettings();
            res.json(settings);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // PUT /api/node/settings — Update node settings (operator only)
    // -----------------------------------------------------------------------
    router.put('/api/node/settings', ...requireNodeOperator, async (req: any, res: any) => {
        try {
            const { settings } = req.body;

            if (!settings || typeof settings !== 'object') {
                return res.status(400).json({ error: 'settings object is required' });
            }

            // Validate keys against whitelist
            const invalidKeys = Object.keys(settings).filter(k => !ALLOWED_NODE_SETTINGS.has(k));
            if (invalidKeys.length > 0) {
                return res.status(400).json({ error: `Unknown setting keys: ${invalidKeys.join(', ')}` });
            }

            // Apply updates
            for (const [key, value] of Object.entries(settings)) {
                if (typeof value === 'string') {
                    await db.setNodeSetting(key, value);
                }
            }

            const updated = await db.getAllNodeSettings();
            res.json({ success: true, settings: updated });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // -------------------------------------------------------------------
    // Guild Export Routes
    // -------------------------------------------------------------------

    // In-memory storage for completed exports awaiting download
    const pendingExports = new Map<string, { filename: string; zipPath: string; createdAt: number }>();

    // Auto-expire pending exports after 1 hour
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of pendingExports.entries()) {
            if (now - entry.createdAt > 60 * 60 * 1000) {
                // Clean up expired ZIP file
                try { if (fs.existsSync(entry.zipPath)) fs.unlinkSync(entry.zipPath); } catch { /* ignore */ }
                pendingExports.delete(key);
            }
        }
    }, 5 * 60 * 1000).unref(); // Don't prevent process exit

    // GET /api/guilds/:guildId/export/stats — Pre-export size estimate
    router.get('/api/guilds/:guildId/export/stats', ...requireGuildOwner, async (req: any, res: any) => {
        try {
            const { guildId } = req.params;
            const stats = await getExportStats(guildId);
            res.json(stats);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/guilds/:guildId/export/progress — Poll export progress
    router.get('/api/guilds/:guildId/export/progress', ...requireGuildOwner, async (req: any, res: any) => {
        try {
            const { guildId } = req.params;
            const progress = getExportProgress(guildId);
            if (!progress) {
                return res.status(404).json({ error: 'No export in progress' });
            }
            res.json(progress);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/guilds/:guildId/export — Start guild export
    router.post('/api/guilds/:guildId/export', ...requireGuildOwner, async (req: any, res: any) => {
        try {
            const { guildId } = req.params;
            const sourceServerUrl = `${req.protocol}://${req.get('host')}`;

            // Generate ZIP filename
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `guild_export_${guildId}_${timestamp}.zip`;
            const zipPath = path.join(os.tmpdir(), filename);

            const result = await exportGuild(guildId, zipPath, sourceServerUrl);

            // Store the pending export for download
            pendingExports.set(guildId, {
                filename,
                zipPath: result.zipPath,
                createdAt: Date.now(),
            });

            const downloadUrl = `/api/guilds/${guildId}/export/${filename}`;
            res.json({
                filename,
                downloadUrl,
                manifest: result.manifest,
            });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/guilds/:guildId/export/:filename — Download export bundle
    router.get('/api/guilds/:guildId/export/:filename', ...requireGuildOwner, async (req: any, res: any) => {
        try {
            const { guildId, filename } = req.params;

            const pending = pendingExports.get(guildId);
            if (!pending || pending.filename !== filename) {
                return res.status(404).json({ error: 'Export not found or expired' });
            }

            if (!fs.existsSync(pending.zipPath)) {
                pendingExports.delete(guildId);
                return res.status(404).json({ error: 'Export file not found on disk' });
            }

            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', 'application/zip');

            const fileStream = fs.createReadStream(pending.zipPath);
            fileStream.pipe(res);

            fileStream.on('end', () => {
                // Clean up after successful download
                try { if (fs.existsSync(pending.zipPath)) fs.unlinkSync(pending.zipPath); } catch { /* ignore */ }
                pendingExports.delete(guildId);
            });

            fileStream.on('error', (err) => {
                console.error(`[GuildExport] Error streaming export file:`, err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error streaming export file' });
                }
            });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
