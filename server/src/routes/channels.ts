import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth, requireGuildRole, requireGuildPermission, Permission } from '../middleware/rbac';

export const createChannelRoutes = (db: any) => {
    const router = Router();

    const findServerId = (id: string): string | null => {
        return db.channelToServerId?.get(id) || null;
    };

    const injectServerId = async (req: any, res: any, next: any) => {
        if (!(req.query.guildId || req.query.serverId) && !(req.body.guildId || req.body.serverId) && req.params.channelId) {
            const resolved = findServerId(req.params.channelId as string);
            if (resolved) req.params.guildId = resolved;
        }
        next();
    };

    dualMount(router, 'get', '/api/guilds/:guildId/channels', requireAuth, async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const channels = await db.allGuildQuery(guildId, 'SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC', [guildId]);
            res.json(channels);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'post', '/api/guilds/:guildId/channels', requireAuth, requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const { name, categoryId, public_key } = req.body;
            const id = crypto.randomUUID();
            await db.runGuildQuery(guildId, 'INSERT INTO channels (id, server_id, category_id, name, public_key) VALUES (?, ?, ?, ?, ?)', [id, guildId, categoryId || null, name, public_key || null]);
            
            if (db.channelToServerId) {
                db.channelToServerId.set(id, guildId);
            }

            const newChannel = await db.getGuildQuery(guildId, 'SELECT * FROM channels WHERE id = ?', [id]);
            res.json(newChannel);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/api/channels/:channelId/category', requireAuth, requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const { channelId } = req.params;
            const { categoryId, guildId } = req.body;
            await db.runGuildQuery(guildId, 'UPDATE channels SET category_id = ? WHERE id = ?', [categoryId || null, channelId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/api/channels/:channelId', requireAuth, async (req: any, res: any) => {
        try {
            const { channelId } = req.params;
            const accountId = req.accountId;

            if (channelId.startsWith('dm-')) {
                const isParticipant = await db.getDmsQuery(`SELECT 1 FROM dm_participants WHERE channel_id = ? AND account_id = ?`, [channelId, accountId]);
                if (!isParticipant) return res.status(403).json({error: "Forbidden"});
                
                const channel = await db.getDmsQuery(`SELECT * FROM dm_channels WHERE id = ?`, [channelId]);
                if (!channel) return res.status(404).json({error: "Not Found"});
                
                const participants = await db.allDmsQuery(`SELECT account_id FROM dm_participants WHERE channel_id = ?`, [channelId]);
                
                let peerPublicKey = '';
                const peer = participants.find((p: any) => p.account_id !== accountId);
                if (peer) {
                    const acc: any = await db.getNodeQuery(`SELECT public_key FROM accounts WHERE id = ?`, [peer.account_id]);
                    if (acc && acc.public_key) peerPublicKey = acc.public_key;
                } else if (participants.length === 1 && participants[0].account_id === accountId) {
                    const acc: any = await db.getNodeQuery(`SELECT public_key FROM accounts WHERE id = ?`, [accountId]);
                    if (acc) peerPublicKey = acc.public_key;
                }
                
                return res.json({
                    ...channel,
                    public_key: peerPublicKey,
                    participants: participants.map((p:any) => p.account_id)
                });
            }

            const guildId = ((req.query.guildId || (req.query.guildId || req.query.serverId)) as string) || findServerId(channelId as string);
            if (!guildId) return res.status(404).json({error: "Server Not found"});
            
            const channel = await db.getGuildQuery(guildId, 'SELECT * FROM channels WHERE id = ?', [channelId]);
            if (!channel) return res.status(404).json({error: "Channel Not found"});
            res.json(channel);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.patch('/api/channels/:channelId', requireAuth, injectServerId, requireGuildPermission(Permission.MANAGE_CHANNELS), async (req: any, res: any) => {
        try {
            const { channelId } = req.params;
            const { name } = req.body;
            const guildId = (req.query.guildId || (req.query.guildId || req.query.serverId)) as string || (req.body.guildId || (req.body.guildId || req.body.serverId)) as string || findServerId(channelId as string);
            if (!guildId) return res.status(404).json({error: "Server Not found"});
            
            await db.runGuildQuery(guildId, 'UPDATE channels SET name = ? WHERE id = ?', [name, channelId]);
            const updated = await db.getGuildQuery(guildId, 'SELECT * FROM channels WHERE id = ?', [channelId]);
            res.json(updated);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.delete('/api/channels/:channelId', requireAuth, injectServerId, requireGuildPermission(Permission.MANAGE_CHANNELS), async (req: any, res: any) => {
        try {
            const { channelId } = req.params;
            const guildId = (req.query.guildId || (req.query.guildId || req.query.serverId)) as string || (req.body.guildId || (req.body.guildId || req.body.serverId)) as string || findServerId(channelId as string);
            if (!guildId) return res.status(404).json({error: "Server Not found"});
            
            await db.runGuildQuery(guildId, 'DELETE FROM channels WHERE id = ?', [channelId]);

            if (db.channelToServerId) {
                db.channelToServerId.delete(channelId);
            }

            res.json({ success: true, message: 'Channel deleted' });
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
