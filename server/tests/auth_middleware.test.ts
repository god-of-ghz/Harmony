import { describe, it, expect, vi } from 'vitest';
import { requireAuth } from '../src/middleware/rbac';
import { generateToken } from '../src/app';

describe('requireAuth Middleware (Federated PKI)', () => {
    const createMockRes = () => {
        const res: any = {};
        res.status = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        return res;
    };

    it('should reject requests without an Authorization token', async () => {
        const req: any = { headers: {} };
        const res = createMockRes();
        const next = vi.fn();

        await requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Missing token' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should reject malformed tokens', async () => {
        const req: any = {
            headers: {
                authorization: 'Bearer not.a.real.jwt'
            }
        };
        const res = createMockRes();
        const next = vi.fn();

        await requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Invalid token format' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should verify a locally issued token (Primary PKI)', async () => {
        // Mock current server origin
        const currentServerUrl = 'http://localhost:3001';

        // Sign token with globally mocked EdDSA strategy
        const token = generateToken('user-123', currentServerUrl);

        const req: any = {
            protocol: 'http',
            get: (header: string) => header === 'host' ? 'localhost:3001' : undefined,
            headers: {
                authorization: `Bearer ${token}`
            }
        };
        const res = createMockRes();
        const next = vi.fn();

        await requireAuth(req, res, next);
        if (next.mock.calls.length === 0) {
            console.log("Failed Local Auth:", res.json.mock.calls);
        }

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.accountId).toBe('user-123');
    });

    it('should cleanly reject an invalid token signature without crashing', async () => {
        // Sign validly using hacker id so it trips mock verification signature throw
        let token = generateToken('user-hacker', 'http://localhost:3001');

        // TAMPER token signature
        const parts = token.split('.');
        parts[2] = 'tampered' + parts[2].substring(8);
        token = parts.join('.');

        const req: any = {
            protocol: 'http',
            get: (header: string) => header === 'host' ? 'localhost:3001' : undefined,
            headers: {
                authorization: `Bearer ${token}`
            }
        };
        const res = createMockRes();
        const next = vi.fn();

        await requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Invalid token signature or expired' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should reject an offline remote issuer gracefully (fetchRemotePublicKey catch)', async () => {
        // Sign token pretending to be an offline server
        const token = generateToken('user-remote', 'http://offline-server.local');

        const req: any = {
            protocol: 'http',
            get: (header: string) => header === 'host' ? 'localhost:3001' : undefined,
            headers: {
                authorization: `Bearer ${token}`
            }
        };
        const res = createMockRes();
        const next = vi.fn();

        await requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Primary server unreachable. Please reconnect when your primary server is online.' });
        expect(next).not.toHaveBeenCalled();
    });
});

