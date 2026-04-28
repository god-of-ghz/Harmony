import { Router } from 'express';
import { requireAuth } from '../middleware/rbac';
import crypto from 'crypto';

export const createDmRoutes = (db: any, broadcastMessage: (v: any) => void) => {
    const router = Router();

    // List all DMs for the current user
    router.get('/api/dms', requireAuth, async (req: any, res: any) => {
        try {
            const accountId = req.accountId;
            // Get all DMs for this user
            const sql = `
                SELECT c.id, c.is_group, c.name, c.owner_id
                FROM dm_channels c
                JOIN dm_participants p ON c.id = p.channel_id
                WHERE p.account_id = ?
            `;
            const channels = await db.allDmsQuery(sql, [accountId]);
            
            // For each channel get participants
            for (const ch of channels) {
                const participants = await db.allDmsQuery(`SELECT account_id FROM dm_participants WHERE channel_id = ?`, [ch.id]);
                ch.participants = participants.map((p: any) => p.account_id);
            }
            res.json(channels);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // Create a DM
    router.post('/api/dms', requireAuth, async (req: any, res: any) => {
        try {
            const accountId = req.accountId;
            const { targetAccountId } = req.body;
            
            if (!targetAccountId) return res.status(400).json({error: "Missing targetAccountId"});
            
            // Check if DM already exists between these EXACT two participants
            const existingChannels = await db.allDmsQuery(`
                SELECT p1.channel_id 
                FROM dm_participants p1
                JOIN dm_participants p2 ON p1.channel_id = p2.channel_id
                JOIN dm_channels c ON p1.channel_id = c.id
                WHERE p1.account_id = ? AND p2.account_id = ? AND c.is_group = 0
            `, [accountId, targetAccountId]);

            if (existingChannels.length > 0) {
                 const chId = existingChannels[0].channel_id;
                 const ch = await db.getDmsQuery(`SELECT * FROM dm_channels WHERE id = ?`, [chId]) as any;
                 ch.participants = [accountId, targetAccountId];
                 return res.json(ch);
            }

            const channelId = 'dm-' + crypto.randomUUID();
            await db.runDmsQuery(`INSERT INTO dm_channels (id, is_group, name, owner_id) VALUES (?, ?, ?, ?)`, [channelId, 0, null, accountId]);
            await db.runDmsQuery(`INSERT INTO dm_participants (channel_id, account_id) VALUES (?, ?)`, [channelId, accountId]);
            await db.runDmsQuery(`INSERT INTO dm_participants (channel_id, account_id) VALUES (?, ?)`, [channelId, targetAccountId]);
            
            res.json({ id: channelId, is_group: 0, participants: [accountId, targetAccountId] });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
