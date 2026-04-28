import { Router } from 'express';
import { requireAuth, requireNodeOperator } from '../middleware/rbac';
import crypto from 'crypto';

export const createProvisionRoutes = (db: any) => {
    const router = Router();

    // -----------------------------------------------------------------------
    // Rate limiting: max 100 codes per hour per IP
    // -----------------------------------------------------------------------
    const provisionRates = new Map<string, { count: number; start: number }>();

    // -----------------------------------------------------------------------
    // POST /api/provision-codes — Generate a provision code
    // -----------------------------------------------------------------------
    router.post('/api/provision-codes', ...requireNodeOperator, async (req: any, res: any) => {
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const now = Date.now();

        // Rate limiting: 100 codes per hour
        let rateEntry = provisionRates.get(ip) || { count: 0, start: now };
        if (now - rateEntry.start > 3600000) {
            rateEntry = { count: 0, start: now };
        }
        rateEntry.count++;
        provisionRates.set(ip, rateEntry);

        if (rateEntry.count > 100) {
            return res.status(429).json({ error: 'Rate limit exceeded: max 100 provision codes per hour' });
        }

        try {
            const { expiresInHours, maxMembers, label } = req.body;

            // Calculate expires_at as a unix timestamp in seconds (matching DB convention)
            let expiresAt: number | undefined;
            if (expiresInHours !== undefined && expiresInHours !== null) {
                expiresAt = Math.floor(Date.now() / 1000) + (expiresInHours * 3600);
            }

            const code = await db.createProvisionCode(
                req.accountId,
                expiresAt,
                maxMembers,
                label
            );

            res.json({
                code,
                expiresAt: expiresAt ?? null,
                maxMembers: maxMembers ?? 0,
                label: label ?? '',
            });
        } catch (err: any) {
            console.error('[ProvisionRoutes] Error generating code:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // GET /api/provision-codes — List all provision codes
    // -----------------------------------------------------------------------
    router.get('/api/provision-codes', ...requireNodeOperator, async (req: any, res: any) => {
        try {
            const codes = await db.getProvisionCodes();
            const now = Math.floor(Date.now() / 1000);

            const enriched = codes.map((entry: any) => {
                let status: 'active' | 'used' | 'expired';
                if (entry.used_by) {
                    status = 'used';
                } else if (entry.expires_at && entry.expires_at < now) {
                    status = 'expired';
                } else {
                    status = 'active';
                }
                return { ...entry, status };
            });

            res.json(enriched);
        } catch (err: any) {
            console.error('[ProvisionRoutes] Error listing codes:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // DELETE /api/provision-codes/:code — Revoke a provision code
    // -----------------------------------------------------------------------
    router.delete('/api/provision-codes/:code', ...requireNodeOperator, async (req: any, res: any) => {
        try {
            const { code } = req.params;

            // Check existence first
            const validation = await db.validateProvisionCode(code);
            if (!validation.code && !validation.valid) {
                return res.status(404).json({ error: 'Provision code not found' });
            }

            await db.revokeProvisionCode(code);
            res.json({ success: true });
        } catch (err: any) {
            console.error('[ProvisionRoutes] Error revoking code:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // POST /api/provision-codes/validate — Check if a code is valid
    // -----------------------------------------------------------------------
    router.post('/api/provision-codes/validate', requireAuth, async (req: any, res: any) => {
        try {
            const { code } = req.body;
            if (!code) {
                return res.status(400).json({ error: 'Missing code in request body' });
            }

            const result = await db.validateProvisionCode(code);

            // Only return validity and resource limits — no internal metadata
            const response: any = { valid: result.valid };
            if (result.valid && result.code) {
                response.maxMembers = result.code.max_members ?? 0;
                response.expiresAt = result.code.expires_at ?? null;
            }

            res.json(response);
        } catch (err: any) {
            console.error('[ProvisionRoutes] Error validating code:', err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
