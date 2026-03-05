import type { Request, Response, NextFunction } from 'express';
import { getQuery } from '../database';

// Global Creator Check
export const isCreator = async (req: Request, res: Response, next: NextFunction) => {
    const accountId = req.headers['x-account-id'] as string;
    if (!accountId) return res.status(401).json({ error: "Unauthorized" });

    const account: any = await getQuery('SELECT is_creator FROM accounts WHERE id = ?', [accountId]);
    if (account && account.is_creator) {
        return next();
    }
    return res.status(403).json({ error: "Forbidden: Creator role required" });
};

// Server RBAC Check
export const requireRole = (allowedRoles: string[]) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const accountId = req.headers['x-account-id'] as string;
        const serverId = req.params.serverId || req.body.serverId;

        if (!accountId || !serverId) return res.status(401).json({ error: "Unauthorized or missing parameters" });

        // Check if creator first (Creator can do anything)
        const account: any = await getQuery('SELECT is_creator FROM accounts WHERE id = ?', [accountId]);
        if (account && account.is_creator) {
            return next();
        }

        // Check profile role
        const profile: any = await getQuery('SELECT role FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, serverId]);
        if (!profile) return res.status(403).json({ error: "Forbidden: Not part of server" });

        if (allowedRoles.includes(profile.role)) {
            return next();
        }

        return res.status(403).json({ error: `Forbidden: Requires one of [${allowedRoles.join(', ')}] role` });
    };
};
