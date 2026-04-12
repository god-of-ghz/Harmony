import type { Request, Response, NextFunction } from 'express';
import dbManager from '../database';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';

// Extend Express Request to include accountId
declare global {
    namespace Express {
        interface Request {
            accountId?: string;
        }
    }
}

export enum Permission {
    ADMINISTRATOR = 1 << 0,
    MANAGE_SERVER = 1 << 1,
    MANAGE_ROLES = 1 << 2,
    MANAGE_CHANNELS = 1 << 3,
    KICK_MEMBERS = 1 << 4,
    BAN_MEMBERS = 1 << 5,
    MANAGE_MESSAGES = 1 << 6,
    SEND_MESSAGES = 1 << 7,
    ATTACH_FILES = 1 << 8,
    MENTION_EVERYONE = 1 << 9,
    VIEW_CHANNEL = 1 << 10,
    READ_MESSAGE_HISTORY = 1 << 11,
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Unauthorized: Missing token" });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { accountId: string };
        req.accountId = decoded.accountId;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }
};

// Global Creator/Admin Check
export const isCreator = [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    const accountId = req.accountId;
    if (!accountId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const account: any = await dbManager.getNodeQuery('SELECT is_creator, is_admin FROM accounts WHERE id = ?', [accountId]);
        if (account && (account.is_creator || account.is_admin)) {
            return next();
        }
        return res.status(403).json({ error: "Forbidden: Creator or Admin role required" });
    } catch (e) {
        console.error(`Error in isCreator for account ${accountId}:`, e);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}];

export const isAdminOrCreator = isCreator; // Alias

export const requirePermission = (requiredPermission: Permission) => {
    return [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
        const accountId = req.accountId;
        if (!accountId) return res.status(401).json({ error: "Unauthorized" });

        const serverId = req.params.serverId || req.query.serverId || req.body.serverId;
        if (!serverId) {
            // If no server context, we can't check server-specific permissions unless they are global admins
            const account: any = await dbManager.getNodeQuery('SELECT is_creator, is_admin FROM accounts WHERE id = ?', [accountId]);
            if (account && (account.is_creator || account.is_admin)) return next();
            return res.status(400).json({ error: "Bad Request: Missing server context" });
        }

        try {
            // Global admin check
            const account: any = await dbManager.getNodeQuery('SELECT is_creator, is_admin FROM accounts WHERE id = ?', [accountId]);
            if (account && (account.is_creator || account.is_admin)) return next();

            // Server-specific check
            const profile: any = await dbManager.getServerQuery(serverId, 'SELECT id, role FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, serverId]);
            if (!profile) return res.status(403).json({ error: "Forbidden: Not member of server" });

            if (profile.role === 'OWNER') return next();

            // Calculate Permissions from Roles
            const roles: any[] = await dbManager.allServerQuery(serverId, 
                `SELECT r.permissions FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = ? AND pr.server_id = ?`,
                [profile.id, serverId]
            );

            let userPerms = 0;
            const everyoneRole: any = await dbManager.getServerQuery(serverId, 'SELECT permissions FROM roles WHERE name = ?', ['@everyone']);
            if (everyoneRole) {
                userPerms |= everyoneRole.permissions;
            }

            for (const r of roles) {
                userPerms |= r.permissions;
            }

            if ((userPerms & requiredPermission) !== 0 || (userPerms & Permission.ADMINISTRATOR) !== 0) {
                return next();
            }

            return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }];
};

export const requireRole = (allowedRoles: string[]) => {
    return [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
        const accountId = req.accountId;
        if (!accountId) return res.status(401).json({ error: "Unauthorized" });

        const serverId = req.params.serverId || req.query.serverId || req.body.serverId;
        if (!serverId) {
            const account: any = await dbManager.getNodeQuery('SELECT is_creator, is_admin FROM accounts WHERE id = ?', [accountId]);
            if (account && (account.is_creator || account.is_admin)) return next();
            return res.status(400).json({ error: "Bad Request: Missing server context" });
        }

        try {
            const account: any = await dbManager.getNodeQuery('SELECT is_creator, is_admin FROM accounts WHERE id = ?', [accountId]);
            if (account && (account.is_creator || account.is_admin)) return next();

            const profile: any = await dbManager.getServerQuery(serverId, 'SELECT role FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, serverId]);
            if (!profile) return res.status(403).json({ error: "Forbidden: Not member of server" });

            if (allowedRoles.includes(profile.role)) return next();

            return res.status(403).json({ error: "Forbidden: Insufficient role" });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }];
};

/**
 * Middleware that ensures the authenticated user has access to the specified server.
 * A user has access if they are a global creator, global admin, or have a profile on the server.
 * @param req - The Express request object.
 * @param res - The Express response object.
 * @param next - The Express next function.
 */
export const requireServerAccess = [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    const accountId = req.accountId;
    const serverId = req.params.serverId || req.query.serverId || req.body.serverId;

    if (!serverId) {
        return res.status(400).json({ error: "Bad Request: Missing server context" });
    }

    try {
        // Global admin/creator bypass
        const account: any = await dbManager.getNodeQuery('SELECT is_creator, is_admin FROM accounts WHERE id = ?', [accountId]);
        if (account && (account.is_creator || account.is_admin)) return next();

        // Check for server membership (profile existence)
        const profile: any = await dbManager.getServerQuery(serverId, 'SELECT id FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, serverId]);
        if (profile) return next();

        return res.status(403).json({ error: "Forbidden: You do not have access to this server" });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
}];
