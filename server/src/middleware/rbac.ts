import type { Request, Response, NextFunction } from 'express';
import dbManager from '../database';
import jwt from '../crypto/jwt';
import { getServerIdentity, fetchRemotePublicKey } from '../crypto/pki';

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

// Default permissions granted to users with role=USER when no @everyone role exists.
// This ensures basic interaction capability without requiring explicit role assignment.
export const DEFAULT_USER_PERMS = Permission.SEND_MESSAGES | Permission.ATTACH_FILES
    | Permission.VIEW_CHANNEL | Permission.READ_MESSAGE_HISTORY | Permission.MENTION_EVERYONE;

// ---------------------------------------------------------------------------
// Shared helper: resolve guild ID from request params, query, or body.
// Accepts both guildId and serverId for backward compatibility.
// ---------------------------------------------------------------------------
function resolveGuildId(req: Request): string | undefined {
    return req.params.guildId || req.params.serverId ||
           (req.query.guildId as string) || (req.query.serverId as string) ||
           req.body?.guildId || req.body?.serverId;
}

// ---------------------------------------------------------------------------
// requireAuth — JWT verification. No changes from original.
// TODO [VISION:V1] Multi-Token Architecture — With per-node tokens, the `iss`
// will ALWAYS match the current server URL. The remote key fetch path (lines 77-86)
// becomes a legacy fallback only needed during the transition period. Once all
// clients use per-node tokens, the remote path can be removed entirely, and
// requireAuth becomes a simple local signature check with zero network dependencies.
// ---------------------------------------------------------------------------
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Unauthorized: Missing token" });
    }

    try {
        const decoded = jwt.decode(token, { complete: true });
        if (!decoded || typeof decoded !== 'object' || !decoded.payload) {
            return res.status(401).json({ error: "Unauthorized: Invalid token format" });
        }

        const payload = decoded.payload as any;
        const issuerUrl = payload.iss;
        const currentServerUrl = `${req.protocol}://${req.get('host')}`;
        console.log('[AUTH]', req.method, req.path, '| iss:', issuerUrl, '| self:', currentServerUrl, '| accountId:', payload.accountId);

        let publicKey;

        if (!issuerUrl || issuerUrl === currentServerUrl) {
            // Local issuer or missing
            try {
                publicKey = getServerIdentity().publicKey;
            } catch (err) {
                return res.status(500).json({ error: "Internal Server Error: PKI not initialized" });
            }
        } else {
            // Remote issuer - fetch dynamically
            try {
                publicKey = await fetchRemotePublicKey(issuerUrl);
                console.log('[AUTH] Remote key fetched from', issuerUrl, '✓');
            } catch (err) {
                console.error(`[AUTH] Failed to fetch remote public key from ${issuerUrl}:`, err);
                return res.status(401).json({ 
                    error: "Unauthorized: Primary server unreachable. Please reconnect when your primary server is online." 
                });
            }
        }

        const verified = jwt.verify(token, publicKey.export({ type: 'spki', format: 'pem'}), { algorithms: ['EdDSA'] }) as { accountId: string };
        req.accountId = verified.accountId;
        console.log('[AUTH] ✓ Verified', req.method, req.path, 'accountId:', verified.accountId);
        next();
    } catch (err: any) {
        console.error("JWT Verify Error in rbac:", err.message);
        console.error("  Token:", token.substring(0, 20) + "...");
        console.error("  Issuer:", err.jwtIssuer || 'unknown');
        return res.status(401).json({ error: "Unauthorized: Invalid token signature or expired" });
    }
};

// ---------------------------------------------------------------------------
// requireNodeOperator — Checks is_creator=1 in node.db (infrastructure access).
// Replaces old isCreator. No guild-content access implied.
// ---------------------------------------------------------------------------
export const requireNodeOperator = [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    const accountId = req.accountId;
    if (!accountId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const account: any = await dbManager.getNodeQuery('SELECT is_creator FROM accounts WHERE id = ?', [accountId]);
        if (account && account.is_creator) {
            return next();
        }
        return res.status(403).json({ error: "Forbidden: Node operator role required" });
    } catch (e) {
        console.error(`Error in requireNodeOperator for account ${accountId}:`, e);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}];

/** @deprecated Use requireNodeOperator instead */
export const isCreator = requireNodeOperator;
/** @deprecated Use requireNodeOperator instead */
export const isAdminOrCreator = requireNodeOperator;

// ---------------------------------------------------------------------------
// requireGuildAccess — Checks that the user has an active profile in the guild.
// There is NO is_creator bypass. The node operator must actually be a member
// of the guild to access its content.
// ---------------------------------------------------------------------------
export const requireGuildAccess = [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    const accountId = req.accountId;
    const guildId = resolveGuildId(req);

    if (!guildId) {
        return res.status(400).json({ error: "Bad Request: Missing guild context" });
    }

    try {
        // Deactivated accounts are always rejected
        const account: any = await dbManager.getNodeQuery(
            'SELECT is_deactivated FROM accounts WHERE id = ?', [accountId]
        );
        if (account && account.is_deactivated) {
            return res.status(403).json({ error: "Forbidden: Account is deactivated" });
        }

        // Check for active guild membership — NO is_creator bypass
        const profile: any = await dbManager.getGuildQuery(guildId,
            'SELECT id FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?',
            [accountId, guildId, 'active']
        );
        if (profile) return next();

        return res.status(403).json({ error: "Forbidden: You are not a member of this guild" });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
}];

/** @deprecated Use requireGuildAccess instead */
export const requireServerAccess = requireGuildAccess;

// ---------------------------------------------------------------------------
// requireGuildPermission — Checks guild-level permissions.
// NO is_creator bypass. The only bypass is if the user's profile has
// role = 'OWNER' in the guild.
// ---------------------------------------------------------------------------
export const requireGuildPermission = (requiredPermission: Permission) => {
    return [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
        const accountId = req.accountId;
        if (!accountId) return res.status(401).json({ error: "Unauthorized" });

        const guildId = resolveGuildId(req);
        if (!guildId) {
            console.warn(`[RBAC] requireGuildPermission: No guildId resolved for accountId=${accountId}, url=${req.originalUrl}`);
            return res.status(400).json({ error: "Bad Request: Missing guild context" });
        }

        try {
            // Check account status — deactivated accounts are always rejected
            const account: any = await dbManager.getNodeQuery('SELECT is_deactivated FROM accounts WHERE id = ?', [accountId]);
            if (account && account.is_deactivated) {
                console.warn(`[RBAC] requireGuildPermission REJECTED: account deactivated. accountId=${accountId}, guildId=${guildId}`);
                return res.status(403).json({ error: "Forbidden: Account is deactivated" });
            }

            // NO is_creator bypass — guild membership required

            // Guild owner ALWAYS has full authority over their guild
            const guildRecord: any = await dbManager.getNodeQuery('SELECT owner_account_id FROM guilds WHERE id = ?', [guildId]);
            if (guildRecord && guildRecord.owner_account_id === accountId) {
                return next();
            }

            // Orphaned imported guild: if owned by system_import, the node operator
            // becomes the de facto guild owner (auto-transfer ownership)
            if (guildRecord && guildRecord.owner_account_id === 'system_import' && account && !account.is_deactivated) {
                const isNodeOp: any = await dbManager.getNodeQuery('SELECT is_creator FROM accounts WHERE id = ?', [accountId]);
                if (isNodeOp && isNodeOp.is_creator) {
                    await dbManager.runNodeQuery('UPDATE guilds SET owner_account_id = ? WHERE id = ?', [accountId, guildId]);
                    console.log(`[RBAC] Auto-transferred orphaned guild ${guildId} ownership to node operator ${accountId}`);
                    return next();
                }
            }

            // Guild-specific check — require active membership
            const profile: any = await dbManager.getGuildQuery(guildId, 'SELECT id, role FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?', [accountId, guildId, 'active']);
            if (!profile) {
                // Diagnostic: check if profile exists at all (maybe membership_status is wrong)
                const anyProfile: any = await dbManager.getGuildQuery(guildId, 'SELECT id, role, membership_status FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, guildId]);
                console.warn(`[RBAC] requireGuildPermission REJECTED: No active profile. accountId=${accountId}, guildId=${guildId}, accountExists=${!!account}, anyProfile=${JSON.stringify(anyProfile || null)}`);
                return res.status(403).json({ error: "Forbidden: Not member of guild" });
            }

            if (profile.role === 'OWNER') return next();

            // Calculate Permissions from Roles
            const roles: any[] = await dbManager.allGuildQuery(guildId, 
                `SELECT r.permissions FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = ? AND pr.server_id = ?`,
                [profile.id, guildId]
            );

            let userPerms = 0;
            const everyoneRole: any = await dbManager.getGuildQuery(guildId, 'SELECT permissions FROM roles WHERE name = ?', ['@everyone']);

            if (!everyoneRole || everyoneRole.permissions > 0xFFFFFF) {
                // No @everyone role exists, or it's a massive Discord imported integer.
                // Apply sensible defaults so users with profiles can interact normally.
                // For USER-role profiles, always apply DEFAULT_USER_PERMS as baseline.
                if (profile.role === 'USER') {
                    userPerms |= DEFAULT_USER_PERMS;
                }
                
                // SECURITY: Do NOT apply massive Discord-imported permission integers.
                // Discord's bit flags don't align with Harmony's Permission enum, so
                // importing them raw would grant ADMINISTRATOR (bit 0) to every user.
                // Only apply if the value is within Harmony's valid permission range.
                if (everyoneRole && everyoneRole.permissions <= 0xFFFFFF) {
                    userPerms |= everyoneRole.permissions;
                }
            } else {
                userPerms |= everyoneRole.permissions;
                // Even with @everyone, ensure USER-role profiles get baseline defaults
                if (profile.role === 'USER') {
                    userPerms |= DEFAULT_USER_PERMS;
                }
            }

            for (const r of roles) {
                userPerms |= r.permissions;
            }

            if ((userPerms & requiredPermission) !== 0 || (userPerms & Permission.ADMINISTRATOR) !== 0) {
                return next();
            }

            console.warn(`[RBAC] requireGuildPermission REJECTED: Insufficient permissions. accountId=${accountId}, guildId=${guildId}, role=${profile.role}, userPerms=${userPerms}, required=${requiredPermission}`);
            return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
        } catch (err: any) {
            console.error(`[RBAC] requireGuildPermission ERROR: ${err.message}, accountId=${accountId}, guildId=${guildId}`);
            return res.status(500).json({ error: err.message });
        }
    }];
};

/** @deprecated Use requireGuildPermission instead */
export const requirePermission = requireGuildPermission;

// ---------------------------------------------------------------------------
// requireGuildRole — Checks guild-level role membership.
// NO is_creator bypass. Only the guild-level role matters.
// ---------------------------------------------------------------------------
export const requireGuildRole = (allowedRoles: string[]) => {
    return [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
        const accountId = req.accountId;
        if (!accountId) return res.status(401).json({ error: "Unauthorized" });

        const guildId = resolveGuildId(req);
        if (!guildId) {
            return res.status(400).json({ error: "Bad Request: Missing guild context" });
        }

        try {
            // Check account status — deactivated accounts are always rejected
            const account: any = await dbManager.getNodeQuery('SELECT is_deactivated FROM accounts WHERE id = ?', [accountId]);
            if (account && account.is_deactivated) {
                return res.status(403).json({ error: "Forbidden: Account is deactivated" });
            }

            // Guild owner ALWAYS has full authority over their guild
            const guild: any = await dbManager.getNodeQuery('SELECT owner_account_id FROM guilds WHERE id = ?', [guildId]);
            if (guild && guild.owner_account_id === accountId) {
                return next();
            }

            // Orphaned imported guild: if owned by system_import, the node operator
            // becomes the de facto guild owner (auto-transfer ownership)
            if (guild && guild.owner_account_id === 'system_import' && account && !account.is_deactivated) {
                const isNodeOp: any = await dbManager.getNodeQuery('SELECT is_creator FROM accounts WHERE id = ?', [accountId]);
                if (isNodeOp && isNodeOp.is_creator) {
                    await dbManager.runNodeQuery('UPDATE guilds SET owner_account_id = ? WHERE id = ?', [accountId, guildId]);
                    console.log(`[RBAC] Auto-transferred orphaned guild ${guildId} ownership to node operator ${accountId}`);
                    return next();
                }
            }

            // Require active membership
            const profile: any = await dbManager.getGuildQuery(guildId, 'SELECT role FROM profiles WHERE account_id = ? AND server_id = ? AND membership_status = ?', [accountId, guildId, 'active']);
            if (!profile) return res.status(403).json({ error: "Forbidden: Not member of guild" });

            if (allowedRoles.includes(profile.role)) return next();

            return res.status(403).json({ error: "Forbidden: Insufficient role" });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }];
};

/** @deprecated Use requireGuildRole instead */
export const requireRole = requireGuildRole;

// ---------------------------------------------------------------------------
// requireGuildOwner — Checks the guilds table in node.db.
// Verifies that the authenticated user is the registered owner of the guild.
// ---------------------------------------------------------------------------
export const requireGuildOwner = [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    const accountId = req.accountId;
    const guildId = req.params.guildId || req.params.serverId;

    if (!guildId) {
        return res.status(400).json({ error: "Bad Request: Missing guild context" });
    }

    try {
        const guild: any = await dbManager.getNodeQuery(
            'SELECT owner_account_id FROM guilds WHERE id = ?', [guildId]
        );

        if (guild && guild.owner_account_id === accountId) {
            return next();
        }

        return res.status(403).json({ error: "Forbidden: Guild owner access required" });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
}];

// ---------------------------------------------------------------------------
// requireNodeOperatorOrGuildOwner — For operations like guild deletion where
// either the node operator OR the guild owner should be able to act.
// ---------------------------------------------------------------------------
export const requireNodeOperatorOrGuildOwner = [requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    const accountId = req.accountId;

    try {
        // Check node operator first
        const account: any = await dbManager.getNodeQuery(
            'SELECT is_creator FROM accounts WHERE id = ?', [accountId]
        );
        if (account && account.is_creator) return next();

        // Check guild owner
        const guildId = req.params.guildId || req.params.serverId;
        if (guildId) {
            const guild: any = await dbManager.getNodeQuery(
                'SELECT owner_account_id FROM guilds WHERE id = ?', [guildId]
            );
            if (guild && guild.owner_account_id === accountId) return next();
        }

        return res.status(403).json({ error: "Forbidden: Node operator or guild owner access required" });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
}];
