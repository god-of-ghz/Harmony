import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import type { Request, Response, NextFunction } from 'express';

import dbManager, { executeRun, executeGet } from '../database';
import {
    requireGuildAccess,
    requireGuildPermission,
    requireGuildRole,
    requireGuildOwner,
    requireNodeOperator,
    requireNodeOperatorOrGuildOwner,
    // Deprecated aliases
    requireServerAccess,
    requirePermission,
    requireRole,
    isCreator,
    isAdminOrCreator,
    Permission,
} from '../middleware/rbac';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const GUILD_ID = 'rbac-test-guild';
const OPERATOR_ID = 'operator-account';
const REGULAR_ID = 'regular-account';
const DEACTIVATED_ID = 'deactivated-account';
const RANDOM_ID = 'random-account';

// ---------------------------------------------------------------------------
// Test setup: create temp databases
// ---------------------------------------------------------------------------
const tmpDir = path.resolve(process.cwd(), '.rbac_test_tmp_' + Date.now());
const guildDir = path.join(tmpDir, 'guilds', GUILD_ID);
const guildDbPath = path.join(guildDir, 'guild.db');

// We need in-memory node DB for isolation, but dbManager.getNodeQuery uses
// the singleton. Instead, we'll use the singleton's nodeDb and clean up.
// For guild DB, we create a real file so loadGuildInstance can find it.

function rmrf(dir: string) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** Create a mock Express request object. */
function mockRequest(overrides: Partial<Request> & { accountId?: string } = {}): Request {
    const req = {
        accountId: overrides.accountId,
        params: overrides.params || {},
        query: overrides.query || {},
        body: overrides.body || {},
        headers: overrides.headers || {},
        originalUrl: overrides.originalUrl || '/test',
        get: () => 'localhost:3001',
        protocol: 'http',
    } as unknown as Request;
    return req;
}

/** Create a mock Express response object that captures status/json calls. */
function mockResponse(): Response & { _status: number; _json: any } {
    const res: any = {
        _status: 0,
        _json: null,
        status(code: number) {
            res._status = code;
            return res;
        },
        json(data: any) {
            res._json = data;
            return res;
        },
    };
    return res as Response & { _status: number; _json: any };
}

/** Run a middleware chain (array of middleware fns). */
async function runMiddleware(
    middlewareOrArray: any,
    req: Request,
    res: Response
): Promise<boolean> {
    const chain = Array.isArray(middlewareOrArray) ? middlewareOrArray : [middlewareOrArray];
    let nextCalled = false;

    const next: NextFunction = () => {
        nextCalled = true;
    };

    for (const mw of chain) {
        if (nextCalled) break;
        // If response was already sent (status set), stop processing
        if ((res as any)._status !== 0) break;
        await mw(req, res, next);
    }

    return nextCalled;
}

// ---------------------------------------------------------------------------
// Global Setup / Teardown
// ---------------------------------------------------------------------------

// We skip requireAuth by directly setting req.accountId on mock requests.
// The middleware arrays include requireAuth as [0], so we need to run only
// the handler function [1]. Instead, let's run the full chain but mock
// requireAuth to just call next() with accountId already set.

/**
 * Run only the business-logic handler of a middleware array, skipping requireAuth.
 * This allows testing the authorization logic in isolation.
 */
async function runHandler(
    middlewareArray: any[],
    req: Request,
    res: Response
): Promise<boolean> {
    // The middleware array is [requireAuth, handler].
    // We skip requireAuth and run only the handler with accountId already set.
    const handler = middlewareArray[middlewareArray.length - 1];
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };
    await handler(req, res, next);
    return nextCalled;
}

beforeAll(async () => {
    // Create guild directory and DB file
    fs.mkdirSync(guildDir, { recursive: true });

    // Ensure node DB tables exist
    await new Promise<void>((resolve) => {
        dbManager.initNodeDb(dbManager.nodeDb);
        dbManager.nodeDb.get('SELECT 1', () => resolve());
    });

    // Insert test accounts
    const insertAcct = `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, is_creator, is_deactivated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await dbManager.runNodeQuery(insertAcct, [OPERATOR_ID, 'operator@test.com', 'salt:hash', 'pk', 'epk', 's', 'iv', 1, 0]);
    await dbManager.runNodeQuery(insertAcct, [REGULAR_ID, 'regular@test.com', 'salt:hash', 'pk', 'epk', 's', 'iv', 0, 0]);
    await dbManager.runNodeQuery(insertAcct, [DEACTIVATED_ID, 'deactivated@test.com', 'salt:hash', 'pk', 'epk', 's', 'iv', 0, 1]);
    await dbManager.runNodeQuery(insertAcct, [RANDOM_ID, 'random@test.com', 'salt:hash', 'pk', 'epk', 's', 'iv', 0, 0]);

    // Register guild with REGULAR_ID as owner
    await dbManager.runNodeQuery(
        `INSERT OR IGNORE INTO guilds (id, name, owner_account_id, fingerprint) VALUES (?, ?, ?, ?)`,
        [GUILD_ID, 'RBAC Test Guild', REGULAR_ID, '']
    );

    // Create guild database
    const guildDb = new sqlite3.Database(guildDbPath);
    await new Promise<void>((resolve) => {
        guildDb.run('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;', () => {
            dbManager.initGuildDb(guildDb);
            guildDb.get('SELECT 1', () => resolve());
        });
    });

    // Insert guild_info row
    await executeRun(guildDb,
        `INSERT OR IGNORE INTO guild_info (id, name) VALUES (?, ?)`,
        [GUILD_ID, 'RBAC Test Guild']
    );

    // Insert profiles: REGULAR_ID has an active OWNER profile, OPERATOR_ID has NONE
    await executeRun(guildDb,
        `INSERT OR IGNORE INTO profiles (id, server_id, account_id, original_username, role, membership_status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['profile-regular', GUILD_ID, REGULAR_ID, 'RegularUser', 'OWNER', 'active']
    );

    // DEACTIVATED_ID has an active profile (but account is deactivated)
    await executeRun(guildDb,
        `INSERT OR IGNORE INTO profiles (id, server_id, account_id, original_username, role, membership_status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['profile-deactivated', GUILD_ID, DEACTIVATED_ID, 'DeactivatedUser', 'USER', 'active']
    );

    // RANDOM_ID has an active USER profile (for permission tests)
    await executeRun(guildDb,
        `INSERT OR IGNORE INTO profiles (id, server_id, account_id, original_username, role, membership_status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['profile-random', GUILD_ID, RANDOM_ID, 'RandomUser', 'USER', 'active']
    );

    // Close the standalone handle — we'll load it through the manager
    await new Promise<void>((r) => guildDb.close(() => r()));

    // Load guild into dbManager so getGuildQuery works
    dbManager.loadGuildInstance(GUILD_ID, guildDbPath);
    // Wait for load to complete
    await new Promise((r) => setTimeout(r, 200));
});

afterAll(async () => {
    // Unload guild DB
    try { dbManager.unloadGuildInstance(GUILD_ID); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 200));

    // Clean up node DB test data
    await dbManager.runNodeQuery(`DELETE FROM guilds WHERE id = ?`, [GUILD_ID]);
    await dbManager.runNodeQuery(`DELETE FROM accounts WHERE id IN (?, ?, ?, ?)`, [OPERATOR_ID, REGULAR_ID, DEACTIVATED_ID, RANDOM_ID]);

    // Remove temp directory
    try { rmrf(tmpDir); } catch { /* ignore EBUSY on Windows */ }
});

// ---------------------------------------------------------------------------
// 1. requireGuildAccess
// ---------------------------------------------------------------------------
describe('requireGuildAccess', () => {
    it('1. member allowed — regular user with active profile → next()', async () => {
        const req = mockRequest({ accountId: REGULAR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireGuildAccess as any[], req, res);
        expect(passed).toBe(true);
    });

    it('2. non-member blocked — operator user with no profile → 403', async () => {
        const req = mockRequest({ accountId: OPERATOR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireGuildAccess as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(403);
        expect(res._json.error).toContain('not a member');
    });

    it('3. node operator blocked (KEY BEHAVIORAL CHANGE) — is_creator=1 but no profile → 403', async () => {
        const req = mockRequest({ accountId: OPERATOR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireGuildAccess as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(403);
    });

    it('4. deactivated blocked — deactivated account with active profile → 403', async () => {
        const req = mockRequest({ accountId: DEACTIVATED_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireGuildAccess as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(403);
        expect(res._json.error).toContain('deactivated');
    });

    it('missing guild context → 400', async () => {
        const req = mockRequest({ accountId: REGULAR_ID, params: {} });
        const res = mockResponse();
        const passed = await runHandler(requireGuildAccess as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(400);
    });

    it('accepts serverId param for backward compatibility', async () => {
        const req = mockRequest({ accountId: REGULAR_ID, params: { serverId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireGuildAccess as any[], req, res);
        expect(passed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 2. requireGuildPermission
// ---------------------------------------------------------------------------
describe('requireGuildPermission', () => {
    it('5. member with permission — SEND_MESSAGES → allowed', async () => {
        // RANDOM_ID has USER role — DEFAULT_USER_PERMS includes SEND_MESSAGES
        const mw = requireGuildPermission(Permission.SEND_MESSAGES);
        const req = mockRequest({ accountId: RANDOM_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(true);
    });

    it('6. member without permission — MANAGE_SERVER → 403', async () => {
        // RANDOM_ID has USER role — DEFAULT_USER_PERMS does NOT include MANAGE_SERVER
        const mw = requireGuildPermission(Permission.MANAGE_SERVER);
        const req = mockRequest({ accountId: RANDOM_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(403);
        expect(res._json.error).toContain('Insufficient permissions');
    });

    it('7. node operator without membership — is_creator=1 but not a member → 403', async () => {
        const mw = requireGuildPermission(Permission.SEND_MESSAGES);
        const req = mockRequest({ accountId: OPERATOR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(403);
    });

    it('8. guild OWNER role bypass — user with role=OWNER → always allowed', async () => {
        // REGULAR_ID has OWNER role — should bypass permission check
        const mw = requireGuildPermission(Permission.ADMINISTRATOR);
        const req = mockRequest({ accountId: REGULAR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(true);
    });

    it('accepts serverId param for backward compatibility', async () => {
        const mw = requireGuildPermission(Permission.SEND_MESSAGES);
        const req = mockRequest({ accountId: RANDOM_ID, params: { serverId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(true);
    });

    it('missing guild context → 400', async () => {
        const mw = requireGuildPermission(Permission.SEND_MESSAGES);
        const req = mockRequest({ accountId: RANDOM_ID, params: {} });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// 3. requireGuildRole
// ---------------------------------------------------------------------------
describe('requireGuildRole', () => {
    it('9. correct role — user with OWNER role, checking for [OWNER] → allowed', async () => {
        const mw = requireGuildRole(['OWNER']);
        const req = mockRequest({ accountId: REGULAR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(true);
    });

    it('10. wrong role — user with USER role, checking for [OWNER] → 403', async () => {
        const mw = requireGuildRole(['OWNER']);
        const req = mockRequest({ accountId: RANDOM_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(403);
        expect(res._json.error).toContain('Insufficient role');
    });

    it('11. node operator bypass removed — is_creator=1, not a member → 403', async () => {
        const mw = requireGuildRole(['OWNER', 'USER']);
        const req = mockRequest({ accountId: OPERATOR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(403);
    });

    it('accepts serverId param for backward compatibility', async () => {
        const mw = requireGuildRole(['OWNER']);
        const req = mockRequest({ accountId: REGULAR_ID, params: { serverId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 4. requireGuildOwner
// ---------------------------------------------------------------------------
describe('requireGuildOwner', () => {
    it('12. owner allowed — guild owner → next()', async () => {
        const req = mockRequest({ accountId: REGULAR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireGuildOwner as any[], req, res);
        expect(passed).toBe(true);
    });

    it('13. non-owner blocked — non-owner member → 403', async () => {
        const req = mockRequest({ accountId: RANDOM_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireGuildOwner as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(403);
        expect(res._json.error).toContain('Guild owner access required');
    });

    it('14. node operator blocked — node operator who isn\'t guild owner → 403', async () => {
        const req = mockRequest({ accountId: OPERATOR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireGuildOwner as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(403);
    });

    it('accepts serverId param for backward compatibility', async () => {
        const req = mockRequest({ accountId: REGULAR_ID, params: { serverId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireGuildOwner as any[], req, res);
        expect(passed).toBe(true);
    });

    it('missing guild context → 400', async () => {
        const req = mockRequest({ accountId: REGULAR_ID, params: {} });
        const res = mockResponse();
        const passed = await runHandler(requireGuildOwner as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// 5. requireNodeOperator
// ---------------------------------------------------------------------------
describe('requireNodeOperator', () => {
    it('15. operator allowed — is_creator=1 → next()', async () => {
        const req = mockRequest({ accountId: OPERATOR_ID });
        const res = mockResponse();
        const passed = await runHandler(requireNodeOperator as any[], req, res);
        expect(passed).toBe(true);
    });

    it('16. non-operator blocked — is_creator=0 → 403', async () => {
        const req = mockRequest({ accountId: REGULAR_ID });
        const res = mockResponse();
        const passed = await runHandler(requireNodeOperator as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(403);
        expect(res._json.error).toContain('Node operator role required');
    });

    it('missing accountId → 401', async () => {
        const req = mockRequest({});
        const res = mockResponse();
        const passed = await runHandler(requireNodeOperator as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(401);
    });
});

// ---------------------------------------------------------------------------
// 6. requireNodeOperatorOrGuildOwner
// ---------------------------------------------------------------------------
describe('requireNodeOperatorOrGuildOwner', () => {
    it('17. operator allowed — node operator → next()', async () => {
        const req = mockRequest({ accountId: OPERATOR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireNodeOperatorOrGuildOwner as any[], req, res);
        expect(passed).toBe(true);
    });

    it('18. guild owner allowed — guild owner (not node operator) → next()', async () => {
        const req = mockRequest({ accountId: REGULAR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireNodeOperatorOrGuildOwner as any[], req, res);
        expect(passed).toBe(true);
    });

    it('19. random user blocked — neither operator nor owner → 403', async () => {
        const req = mockRequest({ accountId: RANDOM_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireNodeOperatorOrGuildOwner as any[], req, res);
        expect(passed).toBe(false);
        expect(res._status).toBe(403);
        expect(res._json.error).toContain('Node operator or guild owner access required');
    });

    it('operator works even without guild context', async () => {
        const req = mockRequest({ accountId: OPERATOR_ID, params: {} });
        const res = mockResponse();
        const passed = await runHandler(requireNodeOperatorOrGuildOwner as any[], req, res);
        expect(passed).toBe(true);
    });

    it('accepts serverId param for backward compatibility', async () => {
        const req = mockRequest({ accountId: REGULAR_ID, params: { serverId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireNodeOperatorOrGuildOwner as any[], req, res);
        expect(passed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 7. Deprecated aliases
// ---------------------------------------------------------------------------
describe('Deprecated aliases', () => {
    it('20a. requireServerAccess works identically to requireGuildAccess', async () => {
        expect(requireServerAccess).toBe(requireGuildAccess);

        const req = mockRequest({ accountId: REGULAR_ID, params: { serverId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(requireServerAccess as any[], req, res);
        expect(passed).toBe(true);
    });

    it('20b. requirePermission works identically to requireGuildPermission', async () => {
        expect(requirePermission).toBe(requireGuildPermission);

        const mw = requirePermission(Permission.SEND_MESSAGES);
        const req = mockRequest({ accountId: RANDOM_ID, params: { serverId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(true);
    });

    it('20c. requireRole works identically to requireGuildRole', async () => {
        expect(requireRole).toBe(requireGuildRole);

        const mw = requireRole(['OWNER']);
        const req = mockRequest({ accountId: REGULAR_ID, params: { guildId: GUILD_ID } });
        const res = mockResponse();
        const passed = await runHandler(mw as any[], req, res);
        expect(passed).toBe(true);
    });

    it('20d. isCreator works identically to requireNodeOperator', async () => {
        expect(isCreator).toBe(requireNodeOperator);

        const req = mockRequest({ accountId: OPERATOR_ID });
        const res = mockResponse();
        const passed = await runHandler(isCreator as any[], req, res);
        expect(passed).toBe(true);
    });

    it('20e. isAdminOrCreator works identically to requireNodeOperator', async () => {
        expect(isAdminOrCreator).toBe(requireNodeOperator);
    });
});
