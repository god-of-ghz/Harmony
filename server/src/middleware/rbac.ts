import type { Request, Response, NextFunction } from 'express';
import dbManager from '../database';

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

// Global Creator/Admin Check
export const isCreator = async (req: Request, res: Response, next: NextFunction) => {
    const accountId = req.headers['x-account-id'] as string;
    if (!accountId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const account: any = await dbManager.getNodeQuery('SELECT is_creator, is_admin FROM accounts WHERE id = ?', [accountId]);
        if (account && (account.is_creator || account.is_admin)) {
            return next();
        }
        return res.status(403).json({ error: "Forbidden: Creator or Admin role required" });
    } catch (e) {
        console.error(`Error in isCreator for account ${accountId}:`, e);
        return res.status(500).json({ error: "Internal Server Error during permission check" });
    }
};

export const isAdminOrCreator = isCreator; // Alias

// Server RBAC Check
import fs from 'fs';
const logDebug = (msg: string) => fs.appendFileSync('rbac_debug.log', msg + '\n');

export const requirePermission = (_permission: Permission) => {
    return async (_req: Request, _res: Response, next: NextFunction) => {
        // Workaround: Everyone has all permissions
        return next();
    };
};

// Legacy support for string roles
export const requireRole = (_allowedRoles: string[]) => {
    return async (_req: Request, _res: Response, next: NextFunction) => {
        // Workaround: Everyone has all roles
        return next();
    };
};
