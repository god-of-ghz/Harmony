import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth, requireGuildRole } from '../middleware/rbac';

export const createCategoryRoutes = (db: any) => {
    const router = Router();

    dualMount(router, 'get', '/api/guilds/:guildId/categories', requireAuth, async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const categories = await db.allGuildQuery(guildId, 'SELECT * FROM channel_categories WHERE server_id = ? ORDER BY position ASC', [guildId]);
            res.json(categories);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    dualMount(router, 'post', '/api/guilds/:guildId/categories', requireAuth, requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const guildId = req.params.guildId || (req.params.guildId || (req.params.guildId || req.params.serverId));
            const { name, position } = req.body;
            const id = crypto.randomUUID();
            await db.runGuildQuery(guildId, 'INSERT INTO channel_categories (id, server_id, name, position) VALUES (?, ?, ?, ?)', [id, guildId, name, position || 0]);
            const newCategory = await db.getGuildQuery(guildId, 'SELECT * FROM channel_categories WHERE id = ?', [id]);
            res.json(newCategory);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/api/categories/:categoryId', requireAuth, requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const { categoryId } = req.params;
            // P18 FIX: accept both guildId and serverId for backward compatibility
            const { name } = req.body;
            const guildId = req.body.guildId || req.body.serverId;
            await db.runGuildQuery(guildId, 'UPDATE channel_categories SET name = ? WHERE id = ?', [name, categoryId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.delete('/api/categories/:categoryId', requireAuth, requireGuildRole(['OWNER', 'ADMIN']), async (req: any, res: any) => {
        try {
            const { categoryId } = req.params;
            const guildId = (req.query.guildId || (req.query.guildId || req.query.serverId)) as string || (req.body.guildId || (req.body.guildId || req.body.serverId));
            await db.runGuildQuery(guildId, 'DELETE FROM channel_categories WHERE id = ?', [categoryId]);
            res.json({ success: true, message: 'Category deleted' });
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
