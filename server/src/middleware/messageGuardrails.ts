import type { Request, Response, NextFunction } from 'express';
import dbManager from '../database';
import { Permission } from './rbac';

export const MAX_MESSAGE_LENGTH = 10000;
export const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export const BLOCKED_EXTENSIONS = [
    '.exe', '.bat', '.cmd', '.msi', '.scr', '.com', '.pif', '.vbs', '.vbe', 
    '.js', '.jse', '.wsf', '.wsh', '.ps1', '.dll', '.sys', '.cpl', '.inf', 
    '.reg', '.hta', '.jar', '.zip', '.7z', '.rar', '.tar', '.gz', '.iso', 
    '.dmg', '.deb', '.rpm', '.apk', '.app'
];

/**
 * Sanitizes message content to prevent null-byte truncation and basic injection vectors
 * Note: React handles XSS escaping on the client, but this protects non-React consumers
 * and the database itself.
 */
export const sanitizeMessageContent = (content: string): string => {
    if (!content) return '';
    let sanitized = content.replace(/\0/g, ''); // Strip null bytes
    
    // Naive defense-in-depth against raw script tags or obvious payload wrappers
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '[REDACTED: SCRIPT TAG]');
    sanitized = sanitized.replace(/javascript:/gi, 'javascript_blocked:');
    
    return sanitized;
};

/**
 * Validates an array of files against the blocked extensions list
 * Returns true if safe, false if any file has a blocked extension
 */
export const validateFileExtensions = (files: any[]): boolean => {
    if (!files || files.length === 0) return true;
    for (const file of files) {
        if (!file.originalname) continue;
        const ext = file.originalname.substring(file.originalname.lastIndexOf('.')).toLowerCase();
        if (BLOCKED_EXTENSIONS.includes(ext)) {
            return false;
        }
    }
    return true;
};

// Rate limiter state: accountId -> array of timestamps
const rateLimitMap = new Map<string, number[]>();

// Cleanup old timestamps periodically to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [accountId, timestamps] of rateLimitMap.entries()) {
        const valid = timestamps.filter(t => now - t < 1000);
        if (valid.length === 0) {
            rateLimitMap.delete(accountId);
        } else {
            rateLimitMap.set(accountId, valid);
        }
    }
}, 60000);

export class MessageRateLimiter {
    /**
     * Checks if the account has exceeded their message rate limit.
     * Returns true if allowed, false if rate limited.
     * 
     * @param accountId - The account ID to check
     * @param serverId - The server ID (if null, falls back to standard tier)
     * @param db - The database manager
     */
    static async checkRateLimit(accountId: string, serverId: string | null, db: any): Promise<boolean> {
        const now = Date.now();
        let limit = 5; // Default standard user limit

        if (serverId) {
            try {
                // Fetch settings for this server
                const settings = await db.allServerQuery(serverId, 'SELECT key, value FROM server_settings WHERE key IN (?, ?, ?)', [
                    'rate_limit_owner', 'rate_limit_admin', 'rate_limit_user'
                ]);
                const settingsMap = new Map<string, number>(settings.map((s: any) => [s.key, parseInt(s.value, 10)]));
                
                const ownerLimit = settingsMap.get('rate_limit_owner') || 30;
                const adminLimit = settingsMap.get('rate_limit_admin') || 20;
                const userLimit = settingsMap.get('rate_limit_user') || 5;

                limit = userLimit; // Start with user limit

                // Check node creator (implicit owner)
                const account: any = await db.getNodeQuery('SELECT is_creator FROM accounts WHERE id = ?', [accountId]);
                if (account && account.is_creator) {
                    limit = ownerLimit;
                } else {
                    // Check server role
                    const profile: any = await db.getServerQuery(serverId, 'SELECT id, role FROM profiles WHERE account_id = ? AND server_id = ?', [accountId, serverId]);
                    if (profile) {
                        if (profile.role === 'OWNER') {
                            limit = ownerLimit;
                        } else {
                            // Check admin perms
                            const roles: any[] = await db.allServerQuery(serverId, 
                                'SELECT r.permissions FROM roles r JOIN profile_roles pr ON r.id = pr.role_id WHERE pr.profile_id = ? AND pr.server_id = ?',
                                [profile.id, serverId]
                            );
                            let perms = 0;
                            for (const r of roles) perms |= r.permissions;
                            if ((perms & Permission.ADMINISTRATOR) !== 0) {
                                limit = adminLimit;
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Rate limiter failed to fetch settings, falling back to defaults", err);
            }
        }

        // Apply sliding window
        let timestamps = rateLimitMap.get(accountId) || [];
        timestamps = timestamps.filter(t => now - t < 1000); // Keep only timestamps from the last second
        
        if (timestamps.length >= limit) {
            // We exceeded the limit, save filtered timestamps and return false
            rateLimitMap.set(accountId, timestamps);
            return false;
        }

        timestamps.push(now);
        rateLimitMap.set(accountId, timestamps);
        return true;
    }
}
