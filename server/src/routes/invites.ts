import { Router } from 'express';
import { requireAuth } from '../middleware/rbac';
import { dispatchSecurityAlert } from '../utils/webhook';
import crypto from 'crypto';

export const createInviteRoutes = (db: any) => {
    const router = Router();
    const inviteRates = new Map<string, { count: number, start: number }>();

    router.post('/api/invites/consume', requireAuth, async (req: any, res: any) => {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: "Missing token" });

        const now = Date.now();
        try {
            // Optimistic Locking / Atomic Transaction using RETURNING
            const sql = `UPDATE invites SET current_uses = current_uses + 1 WHERE token = ? AND current_uses < max_uses AND expires_at > ? RETURNING *`;
            const row: any = await db.getNodeQuery(sql, [token, now]);

            if (!row) {
                return res.status(400).json({ error: "Invite is dead, full, or expired" });
            }

            // Enrich response with guild metadata so the client knows what they're joining
            let guild_name = 'Unknown Guild';
            let guild_icon = '';
            let guild_fingerprint = '';

            if (row.guild_id) {
                try {
                    const guildInfo: any = await db.getNodeQuery(
                        'SELECT name, icon, fingerprint FROM guilds WHERE id = ?',
                        [row.guild_id]
                    );
                    if (guildInfo) {
                        guild_name = guildInfo.name || guild_name;
                        guild_icon = guildInfo.icon || guild_icon;
                        guild_fingerprint = guildInfo.fingerprint || guild_fingerprint;
                    }
                } catch {
                    // Guild info lookup failure is non-fatal
                }
            }

            // Return success dynamically, and 
            // the client handles syncing and trusting the home server.
            res.json({
                success: true,
                guild_id: row.guild_id,
                host_uri: row.host_uri,
                guild_name,
                guild_icon,
                guild_fingerprint,
            });
        } catch (err: any) {
            console.error("Atomic consumed error:", err);
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/api/invites', requireAuth, async (req: any, res: any) => {
        // Accept guildId with guildId as backward-compatible fallback
        const guildId = req.body.guildId || (req.body.guildId || (req.body.guildId || req.body.serverId));
        const { maxUses, expiresInMinutes } = req.body;
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        
        let rateStr = inviteRates.get(ip) || { count: 0, start: now };
        if (now - rateStr.start > 60000) {
            rateStr = { count: 0, start: now };
        }
        rateStr.count++;
        inviteRates.set(ip, rateStr);
        
        if (rateStr.count >= 1000) {
            await dispatchSecurityAlert('RATE_LIMIT', `Suspended IP for excessive invite generation (${rateStr.count}/60s)`, ip);
            return res.status(429).json({ error: "Rate Limit Exceeded. Suspended." });
        }

        if (!guildId) {
            return res.status(400).json({ error: "Missing guildId or guildId" });
        }

        try {
            // Authorization: user must be OWNER or ADMIN in the guild
            const profile: any = await db.getGuildQuery(guildId,
                'SELECT role FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?',
                [req.accountId, guildId, 'active']
            );
            if (!profile || !['OWNER', 'ADMIN'].includes(profile.role)) {
                return res.status(403).json({ error: "Forbidden: Must be guild OWNER or ADMIN to create invites" });
            }

            // Check guild status: don't allow invites for suspended/stopped guilds
            const guildEntry: any = await db.getNodeQuery(
                'SELECT status FROM guilds WHERE id = ?',
                [guildId]
            );
            if (guildEntry && guildEntry.status !== 'active') {
                return res.status(403).json({ error: `Cannot create invites for a ${guildEntry.status} guild` });
            }

            // Very simple stub for generating an invite token.
            const token = crypto.randomBytes(16).toString('hex');
            const expiresAt = now + (expiresInMinutes || 1440) * 60000;
            
            await db.runNodeQuery(`
                INSERT INTO invites (token, host_uri, guild_id, max_uses, current_uses, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [token, process.env.PUBLIC_URL || 'http://localhost', guildId, maxUses || 1, 0, expiresAt]);
            
            res.json({ token, expiresAt });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
