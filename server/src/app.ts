import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireGuildRole, requireNodeOperator, requireGuildPermission, Permission, requireAuth, requireGuildAccess } from './middleware/rbac';
import { MAX_UPLOAD_SIZE_BYTES, validateFileExtensions } from './middleware/messageGuardrails';
import { DATA_DIR } from './database';
import jwt from './crypto/jwt';
import { TOKEN_EXPIRY } from './config';
import staticRoutes from './routes/static';
import healthRoutes from './routes/health';
import { createGuildContentRoutes } from './routes/servers';
import { createCategoryRoutes } from './routes/categories';
import { dispatchSecurityAlert } from './utils/webhook';
import { createChannelRoutes } from './routes/channels';
import { createMessageRoutes } from './routes/messages';
import { createProfileRoutes } from './routes/profiles';
import { createInviteRoutes } from './routes/invites';
import { createDmRoutes } from './routes/dms';
import { createGuildRoutes } from './routes/guilds';
import { createProvisionRoutes } from './routes/provision';

import { getServerIdentity, signDelegationPayload, verifyDelegationSignature, _remoteKeyCache } from './crypto/pki';
import { federationFetch } from './utils/federationFetch';

// TODO [VISION:V1] Multi-Token Architecture — Currently a single JWT is issued at
// login time by the primary server. All other nodes verify it by fetching the
// issuer's public key (remote path in requireAuth). V1 should have each node issue
// its own JWT when the user connects/joins, so verification is always local.
// This means: (1) the login response returns the primary-signed token, (2) when
// the client connects to a replica/standard node, it presents the primary token
// ONCE for initial identity proof, (3) the replica issues its own short-lived JWT
// signed by its own key, (4) the client uses that per-node token for all subsequent
// requests to that node. This eliminates cross-node key fetches entirely.
// See also: appStore.ts (tokenMap), apiFetch.ts, rbac.ts (requireAuth).
export const generateToken = (accountId: string, selfUrl?: string, primary_server_url?: string) => {
    const privateKey = getServerIdentity().privateKey.export({ type: 'pkcs8', format: 'pem' });
    // CRITICAL: The `iss` (issuer) MUST be the URL of the server that actually signs the
    // token with its private key. requireAuth verifies the token by fetching the issuer's
    // public key. If a replica server signs with its own key but claims iss=primaryServer,
    // requireAuth will fetch the primary's public key and verification will FAIL.
    const options: any = { algorithm: 'EdDSA', expiresIn: TOKEN_EXPIRY };
    if (selfUrl) options.issuer = selfUrl;
    return jwt.sign(
        { accountId, primaryUrl: primary_server_url || selfUrl },
        privateKey,
        options
    );
};

/**
 * Shared helper: claim ownership of the node for a given account.
 * Used by both the signup route (first-time) and the claim-ownership endpoint (join flow).
 * Only succeeds if no owner currently exists.
 */
export const claimNodeOwnership = async (accountId: string, db: any): Promise<{ success: boolean, error?: string }> => {
    const owner: any = await db.getNodeQuery('SELECT id FROM accounts WHERE is_creator = 1 LIMIT 1');
    if (owner) {
        return { success: false, error: 'This server already has an owner.' };
    }
    await db.runNodeQuery('UPDATE accounts SET is_creator = 1, is_admin = 1 WHERE id = ?', [accountId]);
    return { success: true };
};

export const createApp = (db: any, broadcastMessage: (v: any) => void) => {
    const app = express();
    const allowedOrigins = [
        'http://localhost:3000',
        'https://localhost:3000',
        ...Array.from({ length: 10 }, (_, i) => `http://localhost:${3001 + i}`),
        ...Array.from({ length: 10 }, (_, i) => `https://localhost:${3001 + i}`),
        ...Array.from({ length: 10 }, (_, i) => `http://localhost:${5173 + i}`),
        ...Array.from({ length: 10 }, (_, i) => `https://localhost:${5173 + i}`)
    ];

    app.use(cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true
    }));
    app.use(express.json({ limit: '1mb' }));

    app.use('/', staticRoutes);
    app.use('/api/health', healthRoutes);
    app.use('/', createGuildContentRoutes(db, broadcastMessage));
    app.use('/', createCategoryRoutes(db));
    app.use('/', createChannelRoutes(db));
    app.use('/', createMessageRoutes(db, broadcastMessage));
    app.use('/', createProfileRoutes(db, broadcastMessage));
    app.use('/', createInviteRoutes(db));
    app.use('/', createDmRoutes(db, broadcastMessage));
    app.use(createGuildRoutes(db, broadcastMessage));
    app.use(createProvisionRoutes(db));

    app.get('/api/node/status', async (req: any, res: any) => {
        try {
            const accountRow: any = await db.getNodeQuery('SELECT COUNT(*) as count FROM accounts');
            const hasAccounts = (accountRow?.count ?? 0) > 0;
            const servers = await db.getAllLoadedServers();
            const hasOwner = servers.some((s: any) => s.owner_id != null && s.owner_id !== '');
            res.json({ hasAccounts, hasOwner, serverCount: servers.length });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/federation/key', (req: any, res: any) => {
        try {
            const pubKeyBuf = getServerIdentity().publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
            res.json({ public_key: pubKeyBuf.toString('base64') });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // Federation endpoint: returns a user's public key for message signature verification.
    // Used by untrusted/unfederated servers that don't have the account record synced locally.
    // This is intentionally unauthenticated (like /api/federation/key) since public keys are,
    // by definition, public information.
    app.get('/api/accounts/:accountId/public-key', async (req: any, res: any) => {
        try {
            const { accountId } = req.params;
            const account: any = await db.getNodeQuery('SELECT public_key FROM accounts WHERE id = ?', [accountId]);
            if (!account || !account.public_key) {
                return res.status(404).json({ error: 'Account not found or has no public key' });
            }
            res.json({ public_key: account.public_key });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // Allowed MIME types for attachments (Phase 4 lockdown: SVG removed)
    const ALLOWED_MIME_TYPES = new Set([
        'image/png', 'image/jpeg', 'image/gif', 'image/webp',
        'video/mp4', 'video/webm',
        'audio/mpeg', 'audio/ogg', 'audio/wav',
        'application/pdf',
        'text/plain',
    ]);

    dualMount(app, 'post', '/api/guilds/:guildId/attachments', requireGuildPermission(Permission.ATTACH_FILES), multer({ limits: { fileSize: MAX_UPLOAD_SIZE_BYTES, files: 10 } }).array('files'), async (req: any, res: any) => {
        try {
            const guildId = (req.params.guildId || (req.params.guildId || req.params.serverId)) as string;
            const files = req.files as any[];
            if (!files || files.length === 0) return res.status(400).json({ error: "No files provided" });

            if (!validateFileExtensions(files)) {
                return res.status(400).json({ error: "One or more files have a blocked extension." });
            }

            // P18 FIX: was 'servers' — data dir is now 'guilds'
            const serverDir = path.join(DATA_DIR, 'guilds', guildId);
            const uploadsDir = path.join(serverDir, 'uploads');
            if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

            // Validate file types using `file-type` (magic byte inspection)
            const fileTypeMod = await import('file-type');
            const fileType = fileTypeMod.default || fileTypeMod;
            const fromBuffer = fileType.fromBuffer || (fileType as any).fileTypeFromBuffer || (fileTypeMod as any).fileTypeFromBuffer;
            const urls = [];
            for (const file of files) {
                const detected = await fromBuffer(file.buffer);
                if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
                    return res.status(400).json({ error: `Rejected dangerous file type: ${detected?.mime ?? 'unknown'} for file ${file.originalname}` });
                }

                const filename = `${Date.now()}-${file.originalname}`;
                const filePath = path.join(uploadsDir, filename);
                fs.writeFileSync(filePath, file.buffer);
                urls.push(`/uploads/${guildId}/${filename}`);
            }

            res.json({ success: true, urls });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/accounts/owner-exists', async (req: any, res: any) => {
        try {
            const owner: any = await db.getNodeQuery('SELECT id FROM accounts WHERE is_creator = 1 LIMIT 1');
            res.json({ exists: !!owner });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/accounts/settings', requireAuth, async (req: any, res: any) => {
        try {
            const accountId = req.accountId;
            if (!accountId) return res.status(401).json({ error: 'Unauthorized' });
            
            const record: any = await db.getNodeQuery('SELECT settings FROM account_settings WHERE account_id = ?', [accountId]);
            if (!record) {
                return res.json({});
            }
            try {
                res.json(JSON.parse(record.settings));
            } catch (e) {
                res.json({});
            }
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/accounts/settings', requireAuth, async (req: any, res: any) => {
        try {
            const accountId = req.accountId;
            if (!accountId) return res.status(401).json({ error: 'Unauthorized' });

            const newSettings = req.body;
            let currentSettings = {};
            const record: any = await db.getNodeQuery('SELECT settings FROM account_settings WHERE account_id = ?', [accountId]);
            
            if (record && record.settings) {
                try {
                    currentSettings = JSON.parse(record.settings);
                } catch (e) {}
            }

            const mergedSettings = { ...currentSettings, ...newSettings };
            
            await db.runNodeQuery(
                "INSERT INTO account_settings (account_id, settings, updated_at) VALUES (?, ?, CAST(strftime('%s','now') AS INTEGER)) ON CONFLICT(account_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at",
                [accountId, JSON.stringify(mergedSettings)]
            );
            
            res.json(mergedSettings);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    const ALLOWED_AVATAR_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

    app.post('/api/accounts/avatar', requireAuth, multer({ limits: { fileSize: 8 * 1024 * 1024, files: 1 } }).single('avatar'), async (req: any, res: any) => {
        try {
            const accountId = req.accountId;
            if (!accountId) return res.status(401).json({ error: 'Unauthorized' });

            const file = req.file;
            if (!file) return res.status(400).json({ error: 'No file provided' });

            // Magic-byte validation
            const fileTypeMod = await import('file-type');
            const fileType = fileTypeMod.default || fileTypeMod;
            const fromBuffer = fileType.fromBuffer || (fileType as any).fileTypeFromBuffer || (fileTypeMod as any).fileTypeFromBuffer;
            const detected = await fromBuffer(file.buffer);
            if (!detected || !ALLOWED_AVATAR_MIMES.has(detected.mime)) {
                return res.status(400).json({ error: `Invalid image type: ${detected?.mime ?? 'unknown'}. Allowed: PNG, JPEG, GIF, WebP.` });
            }

            const avatarsDir = path.join(DATA_DIR, 'avatars');
            if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

            const ext = detected.ext || 'png';
            const filename = `${accountId}_${Date.now()}.${ext}`;
            const filePath = path.join(avatarsDir, filename);
            fs.writeFileSync(filePath, file.buffer);

            const avatarUrl = `/avatars/${filename}`;
            res.json({ success: true, avatar_url: avatarUrl });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/accounts/salt', async (req, res) => {
        const { email } = req.query;
        if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Missing email' });
        try {
            const account: any = await db.getNodeQuery('SELECT auth_salt FROM accounts WHERE email = ?', [email]);
            if (account) {
                res.json({ salt: account.auth_salt });
            } else {
                // To mitigate enumeration attacks slightly, though time checks are omitted here for simplicity
                res.status(404).json({ error: 'Account not found' });
            }
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/signup', async (req, res) => {
        const { email, serverAuthKey, public_key, encrypted_private_key, key_salt, key_iv, auth_salt, claimOwnership } = req.body;
        const id = crypto.randomUUID();
        try {
            // Check for key collision
            const existing: any = await db.getNodeQuery('SELECT id FROM accounts WHERE email = ?', [email]);
            if (existing) return res.status(409).json({ error: "Email already exists" });

            const salt = crypto.randomBytes(16).toString('hex');
            const hashedVerifier = crypto.scryptSync(serverAuthKey, salt, 64).toString('hex');
            const auth_verifier = `${salt}:${hashedVerifier}`;

            await db.runNodeQuery(
                `INSERT INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, auth_salt, is_creator, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, auth_salt || '', 0, 0]
            );

            // Use shared helper for ownership claiming
            if (claimOwnership) {
                await claimNodeOwnership(id, db);
            }

            const account: any = await db.getNodeQuery('SELECT id, email, is_creator, is_admin FROM accounts WHERE id = ?', [id]);
            const selfUrl = `${req.protocol}://${req.get('host')}`;
            const primary_server_url = selfUrl;
            // Persist primary_server_url so federation endpoints can resolve it
            await db.runNodeQuery('UPDATE accounts SET primary_server_url = ? WHERE id = ?', [primary_server_url, id]);
            // Register this server as a trusted server for the new account
            await db.runNodeQuery('INSERT OR IGNORE INTO account_servers (account_id, server_url, trust_level) VALUES (?, ?, ?)', [id, selfUrl, 'trusted']);
            const token = generateToken(account.id, selfUrl, primary_server_url);
            const servers = [{ url: selfUrl, trust_level: 'trusted', status: 'active' }];
            res.json({ ...account, token, primary_server_url, servers, trusted_servers: [selfUrl], dismissed_global_claim: false });
        } catch (err: any) {
            console.error("Signup error:", err);
            res.status(500).json({ error: "Email already exists or error occurred" });
        }
    });

    const failedLogins = new Map<string, { count: number, last: number }>();

    app.post('/api/accounts/login', async (req, res) => {
        const { email, serverAuthKey, initialServerUrl } = req.body;
        const ip = req.ip || req.connection.remoteAddress || 'unknown';

        const now = Date.now();
        const failRecord = failedLogins.get(ip) || { count: 0, last: now };
        
        if (now - failRecord.last > 15 * 60 * 1000) {
            failRecord.count = 0; // reset after 15 min
        }
        
        if (failRecord.count >= 50) {
            failRecord.last = now; // renew lock
            failedLogins.set(ip, failRecord);
            dispatchSecurityAlert('AUTH_FAILED', `Suspended IP due to excessive failed logins for ${email}`, ip);
            return res.status(429).json({ error: "Too many failed login attempts. Suspended." });
        }

        try {
            let account: any = await db.getNodeQuery('SELECT * FROM accounts WHERE email = ?', [email]);
            let authenticated = false;

            // If account exists and we are a REPLICA, we MUST try primary first (Dynamic failover)
            if (account && account.authority_role === 'replica' && account.primary_server_url) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    const fedRes = await federationFetch(`${account.primary_server_url}/api/accounts/federate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, serverAuthKey }),
                        signal: controller.signal as any
                    });
                    clearTimeout(timeoutId);

                    if (fedRes.ok) {
                        const { account: remoteAccount, trusted_servers } = await fedRes.json() as any;
                        // Sync updated credentials from primary
                        await db.runNodeQuery(
                            `INSERT OR REPLACE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, auth_salt, is_creator, is_admin, authority_role, primary_server_url, delegation_cert, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [remoteAccount.id, remoteAccount.email, remoteAccount.auth_verifier, remoteAccount.public_key, remoteAccount.encrypted_private_key, remoteAccount.key_salt, remoteAccount.key_iv, remoteAccount.auth_salt || '', remoteAccount.is_creator, remoteAccount.is_admin, 'replica', account.primary_server_url, account.delegation_cert, remoteAccount.updated_at]
                        );
                        const selfUrl = `${req.protocol}://${req.get('host')}`;
                        // Build servers array preserving trust_level from primary
                        const serverEntries = (trusted_servers || []).map((entry: any) => {
                            const url = typeof entry === 'string' ? entry : entry.url;
                            const trust_level = typeof entry === 'string' ? 'trusted' : (entry.trust_level || 'trusted');
                            return { url, trust_level, status: 'active' };
                        });
                        // Ensure selfUrl and primary are included
                        if (!serverEntries.some((s: any) => s.url === selfUrl)) {
                            serverEntries.push({ url: selfUrl, trust_level: 'trusted', status: 'active' });
                        }
                        if (account.primary_server_url && !serverEntries.some((s: any) => s.url === account.primary_server_url)) {
                            serverEntries.push({ url: account.primary_server_url, trust_level: 'trusted', status: 'active' });
                        }
                        const mergedTrusted = serverEntries.map((s: any) => s.url);
                        return res.json({
                            id: remoteAccount.id, email: remoteAccount.email, is_creator: remoteAccount.is_creator, is_admin: remoteAccount.is_admin,
                            public_key: remoteAccount.public_key, encrypted_private_key: remoteAccount.encrypted_private_key,
                            key_salt: remoteAccount.key_salt, key_iv: remoteAccount.key_iv, auth_salt: remoteAccount.auth_salt,
                            authority_role: 'replica',
                            dismissed_global_claim: !!remoteAccount.dismissed_global_claim,
                            servers: serverEntries,
                            trusted_servers: mergedTrusted,
                            token: generateToken(remoteAccount.id, `${req.protocol}://${req.get('host')}`, account.primary_server_url)
                        });
                    } else if (fedRes.status === 401) {
                        return res.status(401).json({ error: "Invalid credentials" });
                    } else {
                        console.log("Primary responded with error, falling back to Replica cache");
                    }
                } catch (err: any) {
                    console.log(`Federation network timeout, cascaded to replica local cache for ${email}:`, err.message);
                }
            }

            if (account && account.auth_verifier) {
                if (account.auth_verifier.includes(':')) {
                    const [salt, storedHash] = account.auth_verifier.split(':');
                    const computedHash = crypto.scryptSync(serverAuthKey, salt, 64);
                    const storedHashBuf = Buffer.from(storedHash, 'hex');
                    if (computedHash.length === storedHashBuf.length) {
                        authenticated = crypto.timingSafeEqual(computedHash, storedHashBuf);
                    }
                } else {
                    authenticated = account.auth_verifier === serverAuthKey;
                }
            }

            if (authenticated) {
                // Reject deactivated accounts
                if (account.is_deactivated) {
                    return res.status(403).json({ error: 'Account deactivated on this server' });
                }

                // reset on success
                failedLogins.delete(ip);
                const ts = await db.allNodeQuery('SELECT server_url, trust_level, status FROM account_servers WHERE account_id = ?', [account.id]);
                const selfUrl = `${req.protocol}://${req.get('host')}`;
                const primaryUrl = account.primary_server_url || req.body.initialServerUrl || selfUrl;

                // Build full servers array with trust_level and status
                const servers = ts.map((s: any) => ({ url: s.server_url, trust_level: s.trust_level, status: s.status }));
                // Also build flat list for backward compat
                const mergedTrusted = [...new Set([...ts.map((s: any) => s.server_url), selfUrl, ...(account.primary_server_url ? [account.primary_server_url] : [])])];

                // primary_server_url: for replicas, do NOT fall back to selfUrl
                const resolvedPrimaryUrl = account.authority_role === 'replica'
                    ? (account.primary_server_url || null)
                    : (account.primary_server_url || selfUrl);

                return res.json({
                    id: account.id, email: account.email, is_creator: account.is_creator, is_admin: account.is_admin,
                    public_key: account.public_key, encrypted_private_key: account.encrypted_private_key,
                    key_salt: account.key_salt, key_iv: account.key_iv, auth_salt: account.auth_salt,
                    authority_role: account.authority_role,
                    delegation_cert: account.delegation_cert || '',
                    primary_server_url: resolvedPrimaryUrl,
                    dismissed_global_claim: !!account.dismissed_global_claim,
                    servers,
                    trusted_servers: mergedTrusted,
                    token: generateToken(account.id, selfUrl, primaryUrl)
                });
            } else {
                failRecord.count++;
                failRecord.last = now;
                failedLogins.set(ip, failRecord);
                console.log(`[SECURITY] AUTH_FAILED IP: ${ip} - Login Check Failed for ${email}`);
            }

            // Attempt federation if an initial server URL is provided and local lookup failed
            if (!authenticated && initialServerUrl && (!account || account.authority_role !== 'replica')) {
                try {
                    const fedRes = await federationFetch(`${initialServerUrl}/api/accounts/federate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, serverAuthKey })
                    });
                    if (fedRes.ok) {
                        const { account: remoteAccount, trusted_servers } = await fedRes.json() as any;
                        // Upsert the federated account locally
                        // FEDERATION FIX: Never copy is_creator/is_admin from remote — they are node-local.
                        await db.runNodeQuery(
                            `INSERT OR REPLACE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, auth_salt, is_creator, is_admin, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [remoteAccount.id, remoteAccount.email, remoteAccount.auth_verifier, remoteAccount.public_key, remoteAccount.encrypted_private_key, remoteAccount.key_salt, remoteAccount.key_iv, remoteAccount.auth_salt || '', 0, 0, remoteAccount.updated_at]
                        );
                        const selfUrl = `${req.protocol}://${req.get('host')}`;
                        // Build servers array preserving trust_level from primary
                        const serverEntries = (trusted_servers || []).map((entry: any) => {
                            const url = typeof entry === 'string' ? entry : entry.url;
                            const trust_level = typeof entry === 'string' ? 'trusted' : (entry.trust_level || 'trusted');
                            return { url, trust_level, status: 'active' };
                        });
                        // Ensure selfUrl and initialServerUrl are included
                        if (!serverEntries.some((s: any) => s.url === selfUrl)) {
                            serverEntries.push({ url: selfUrl, trust_level: 'trusted', status: 'active' });
                        }
                        if (initialServerUrl && !serverEntries.some((s: any) => s.url === initialServerUrl)) {
                            serverEntries.push({ url: initialServerUrl, trust_level: 'trusted', status: 'active' });
                        }
                        const mergedTrusted = serverEntries.map((s: any) => s.url);
                        return res.json({
                            id: remoteAccount.id, email: remoteAccount.email, is_creator: remoteAccount.is_creator, is_admin: remoteAccount.is_admin,
                            public_key: remoteAccount.public_key, encrypted_private_key: remoteAccount.encrypted_private_key,
                            key_salt: remoteAccount.key_salt, key_iv: remoteAccount.key_iv, auth_salt: remoteAccount.auth_salt,
                            authority_role: remoteAccount.authority_role || 'primary',
                            dismissed_global_claim: !!remoteAccount.dismissed_global_claim,
                            servers: serverEntries,
                            trusted_servers: mergedTrusted,
                            token: generateToken(remoteAccount.id, selfUrl, initialServerUrl || selfUrl)
                        });
                    }
                } catch (fedErr) {
                    console.error("Federation failed:", fedErr);
                }
            }

            res.status(401).json({ error: "Invalid credentials" });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // TODO [VISION:Beta] This endpoint authenticates the USER (via password check)
    // but does not authenticate the CALLING SERVER. A third party could call this
    // endpoint to confirm whether an email exists (information disclosure). Acceptable
    // for alpha; Beta should add rate limiting per source IP or require a server identity
    // header to mitigate enumeration attacks.
    app.post('/api/accounts/federate', async (req, res) => {
        const { email, serverAuthKey } = req.body;
        try {
            const account: any = await db.getNodeQuery('SELECT * FROM accounts WHERE email = ?', [email]);
            let authenticated = false;
            if (account && account.auth_verifier) {
                if (account.auth_verifier.includes(':')) {
                    const [salt, storedHash] = account.auth_verifier.split(':');
                    const computedHash = crypto.scryptSync(serverAuthKey, salt, 64);
                    const storedHashBuf = Buffer.from(storedHash, 'hex');
                    if (computedHash.length === storedHashBuf.length) {
                        authenticated = crypto.timingSafeEqual(computedHash, storedHashBuf);
                    }
                } else {
                    authenticated = account.auth_verifier === serverAuthKey;
                }
            }

            if (authenticated) {
                const servers = await db.allNodeQuery('SELECT server_url, trust_level, status FROM account_servers WHERE account_id = ?', [account.id]);
                res.json({ account, trusted_servers: servers.map((s: any) => ({ url: s.server_url, trust_level: s.trust_level })) });
            } else {
                res.status(401).json({ error: "Invalid credentials" });
            }
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // TODO [VISION:Beta] This endpoint accepts UNAUTHENTICATED requests. Any caller
    // that knows a user's ID can push a crafted payload to overwrite credentials.
    // Beta must add server-to-server authentication here — either require a delegation
    // certificate (like /api/accounts/replica-sync does) or a server-signed JWT.
    // Do NOT fix during alpha — the sync flow is still being stabilized.
    app.post('/api/accounts/sync', async (req, res) => {
        const { account, trusted_servers } = req.body;
        try {
            const existing: any = await db.getNodeQuery('SELECT updated_at FROM accounts WHERE id = ?', [account.id]);
            if (existing) {
                if (account.updated_at > existing.updated_at) {
                    // FEDERATION FIX: Never overwrite is_creator or is_admin — they are node-local attributes.
                    await db.runNodeQuery(
                        'UPDATE accounts SET email = ?, auth_verifier = ?, public_key = ?, encrypted_private_key = ?, key_salt = ?, key_iv = ?, auth_salt = ?, dismissed_global_claim = ?, is_deactivated = 0, updated_at = ? WHERE id = ?',
                        [account.email, account.auth_verifier, account.public_key, account.encrypted_private_key, account.key_salt, account.key_iv, account.auth_salt || '', account.dismissed_global_claim || 0, account.updated_at, account.id]
                    );
                } else {
                    return res.json({ success: true, message: 'Local is newer or same' });
                }
            } else {
                // FEDERATION FIX: New federated accounts always start with is_creator=0, is_admin=0.
                await db.runNodeQuery(
                    'INSERT INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, auth_salt, is_creator, is_admin, dismissed_global_claim, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [account.id, account.email, account.auth_verifier, account.public_key, account.encrypted_private_key, account.key_salt, account.key_iv, account.auth_salt || '', 0, 0, account.dismissed_global_claim || 0, account.updated_at]
                );
            }

            await db.runNodeQuery('DELETE FROM account_servers WHERE account_id = ?', [account.id]);
            for (const entry of (trusted_servers || [])) {
                // Support both flat URL strings (legacy) and {url, trust_level} objects
                const url = typeof entry === 'string' ? entry : entry.url;
                const trustLevel = typeof entry === 'string' ? 'trusted' : (entry.trust_level || 'trusted');
                await db.runNodeQuery('INSERT INTO account_servers (account_id, server_url, trust_level) VALUES (?, ?, ?)', [account.id, url, trustLevel]);
            }
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/delegate', requireAuth, async (req, res) => {
        try {
            const { targetServerUrl } = req.body;
            const accountId = req.accountId;
            if (!accountId || !targetServerUrl) return res.status(400).json({ error: "Missing required fields" });

            const identity = getServerIdentity();
            const timestamp = Date.now();
            const payload = { userId: accountId, targetServerUrl, timestamp };
            
            const signature = signDelegationPayload(payload, identity.privateKey);
            const pubKeyB64 = identity.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
            const delegationCert = { payload, signature, primaryServerUrl: 'true', primaryPublicKey: pubKeyB64 };
            
            res.json({ success: true, delegationCert });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/replica-sync', async (req, res) => {
        try {
            const { account, trusted_servers, delegationCert, primaryServerUrl } = req.body;
            if (!delegationCert || !delegationCert.payload || !delegationCert.signature || !delegationCert.primaryPublicKey) {
                return res.status(400).json({ error: "Malformed delegation certificate" });
            }

            const { payload, signature, primaryPublicKey } = delegationCert;
            if (payload.userId !== account.id) return res.status(400).json({ error: "Invalid delegation parameters" });
            if (Date.now() - payload.timestamp > 1000 * 60 * 60 * 24) return res.status(401).json({ error: "Delegation certificate expired" });

            const isValid = verifyDelegationSignature(payload, signature, primaryPublicKey);
            if (!isValid) return res.status(401).json({ error: "Invalid signature on delegation certificate" });

            const certString = JSON.stringify(delegationCert);

            const existing: any = await db.getNodeQuery('SELECT updated_at FROM accounts WHERE id = ?', [account.id]);
            if (existing) {
                // FEDERATION FIX: Never overwrite is_creator or is_admin — they are node-local attributes.
                await db.runNodeQuery(
                    'UPDATE accounts SET email = ?, auth_verifier = ?, public_key = ?, encrypted_private_key = ?, key_salt = ?, key_iv = ?, auth_salt = ?, dismissed_global_claim = ?, authority_role = ?, primary_server_url = ?, delegation_cert = ?, updated_at = ? WHERE id = ?',
                    [account.email, account.auth_verifier, account.public_key, account.encrypted_private_key, account.key_salt, account.key_iv, account.auth_salt || '', account.dismissed_global_claim || 0, 'replica', primaryServerUrl, certString, account.updated_at, account.id]
                );
            } else {
                // FEDERATION FIX: New federated accounts always start with is_creator=0, is_admin=0.
                await db.runNodeQuery(
                    'INSERT INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv, auth_salt, is_creator, is_admin, dismissed_global_claim, authority_role, primary_server_url, delegation_cert, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [account.id, account.email, account.auth_verifier, account.public_key, account.encrypted_private_key, account.key_salt, account.key_iv, account.auth_salt || '', 0, 0, account.dismissed_global_claim || 0, 'replica', primaryServerUrl, certString, account.updated_at]
                );
            }

            await db.runNodeQuery('DELETE FROM account_servers WHERE account_id = ?', [account.id]);
            for (const entry of (trusted_servers || [])) {
                // Support both flat URL strings (legacy) and {url, trust_level} objects
                const url = typeof entry === 'string' ? entry : entry.url;
                const trustLevel = typeof entry === 'string' ? 'trusted' : (entry.trust_level || 'trusted');
                await db.runNodeQuery('INSERT INTO account_servers (account_id, server_url, trust_level) VALUES (?, ?, ?)', [account.id, url, trustLevel]);
            }
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });


    app.post('/api/node/claim-ownership', requireAuth, async (req: any, res: any) => {
        try {
            const accountId = req.accountId;
            if (!accountId) return res.status(401).json({ error: 'Unauthorized' });

            const result = await claimNodeOwnership(accountId, db);
            if (!result.success) {
                return res.status(409).json({ error: result.error });
            }

            // Re-fetch account to return updated state
            const account: any = await db.getNodeQuery('SELECT id, email, is_creator, is_admin FROM accounts WHERE id = ?', [accountId]);
            res.json({ success: true, account });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/:accountId/trusted_servers', requireAuth, async (req: any, res: any) => {
        const { accountId } = req.params;
        const { serverUrl } = req.body;
        try {
            await db.runNodeQuery("INSERT INTO account_servers (account_id, server_url, trust_level) VALUES (?, ?, 'trusted') ON CONFLICT(account_id, server_url) DO UPDATE SET trust_level = 'trusted'", [accountId, serverUrl]);
            await db.runNodeQuery("UPDATE accounts SET updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?", [accountId]);

            // Push the full updated account struct to the new peer
            const fullAccount: any = await db.getNodeQuery('SELECT * FROM accounts WHERE id = ?', [accountId]);
            const trustedList = await db.allNodeQuery('SELECT server_url, trust_level FROM account_servers WHERE account_id = ?', [accountId]);

            try {
                const syncRes = await federationFetch(`${serverUrl}/api/accounts/sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account: fullAccount,
                        trusted_servers: trustedList.map((t: any) => ({ url: t.server_url, trust_level: t.trust_level }))
                    })
                });

                if (!syncRes.ok) {
                    await db.runNodeQuery('DELETE FROM account_servers WHERE account_id = ? AND server_url = ?', [accountId, serverUrl]);
                    return res.status(502).json({ error: `Failed to federate identity to ${serverUrl}: Server responded with status ${syncRes.status}. Check if the server is accessible.` });
                }
            } catch (syncErr: any) {
                console.error(`Failed to push identity sync to ${serverUrl}:`, syncErr);
                await db.runNodeQuery('DELETE FROM account_servers WHERE account_id = ? AND server_url = ?', [accountId, serverUrl]);
                
                let errorMsg = `Network error: Could not reach ${serverUrl}.`;
                if (serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1')) {
                    errorMsg = `Your Home Server cannot reach '${serverUrl}'. If the target server is on another PC, you must use its local network IP address (e.g., 192.168.x.x) instead of localhost.`;
                }
                return res.status(502).json({ error: errorMsg });
            }

            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/accounts/:accountId/trusted_servers/reorder', async (req, res) => {
        const { accountId } = req.params;
        const { trusted_servers } = req.body;
        try {
            // Preserve trust_level by reading current values before delete
            const existing = await db.allNodeQuery('SELECT server_url, trust_level FROM account_servers WHERE account_id = ?', [accountId]);
            const trustMap = new Map((existing as any[]).map((s: any) => [s.server_url, s.trust_level]));
            await db.runNodeQuery('DELETE FROM account_servers WHERE account_id = ?', [accountId]);
            for (const url of (trusted_servers || [])) {
                const trustLevel = trustMap.get(url) || 'untrusted';
                await db.runNodeQuery('INSERT INTO account_servers (account_id, server_url, trust_level) VALUES (?, ?, ?)', [accountId, url, trustLevel]);
            }
            await db.runNodeQuery("UPDATE accounts SET updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?", [accountId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/accounts/:accountId/trusted_servers', requireAuth, async (req: any, res: any) => {
        const { accountId } = req.params;
        const { serverUrl } = req.body;
        try {
            await db.runNodeQuery('DELETE FROM account_servers WHERE account_id = ? AND server_url = ?', [accountId, serverUrl]);
            await db.runNodeQuery("UPDATE accounts SET updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?", [accountId]);

            // Best-effort: notify the removed server to deactivate this account
            // TODO: Offline sync queue needed for unreachable servers
            if (serverUrl) {
                const identity = getServerIdentity();
                const timestamp = Date.now();
                const certPayload = { userId: accountId, targetServerUrl: serverUrl, timestamp };
                const signature = signDelegationPayload(certPayload, identity.privateKey);
                const pubKeyB64 = identity.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
                const delegationCert = { payload: certPayload, signature, primaryPublicKey: pubKeyB64 };

                (async () => {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 3000);
                        await federationFetch(`${serverUrl}/api/federation/deactivate`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ accountId, delegationCert }),
                            signal: controller.signal as any
                        });
                        clearTimeout(timeoutId);
                    } catch (err: any) {
                        console.log(`[Federation] Failed to send deactivation to ${serverUrl}: ${err.message}`);
                    }
                })();
            }

            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/federation/promote', async (req, res) => {
        try {
            const { accountId, delegationCert, serverAuthKey, oldPrimaryUrl } = req.body;
            if (!delegationCert) return res.status(400).json({ error: 'Missing delegation certificate' });
            
            let certObj = typeof delegationCert === 'string' ? JSON.parse(delegationCert) : delegationCert;
            
            const { payload, signature, primaryPublicKey } = certObj;
            if (!payload || !signature || !primaryPublicKey) {
                return res.status(400).json({ error: "Malformed delegation certificate" });
            }

            if (payload.userId !== accountId) return res.status(400).json({ error: "Invalid delegation parameters" });
            if (Date.now() - payload.timestamp > 1000 * 60 * 60 * 24 * 7) return res.status(401).json({ error: "Delegation certificate heavily expired" });
            
            const isValid = verifyDelegationSignature(payload, signature, primaryPublicKey);
            if (!isValid) return res.status(401).json({ error: "Invalid signature on delegation certificate" });

            // Re-authenticate: verify password against local account record
            if (!serverAuthKey) return res.status(401).json({ error: 'Password required for promotion' });
            const account: any = await db.getNodeQuery('SELECT * FROM accounts WHERE id = ?', [accountId]);
            if (!account) return res.status(404).json({ error: 'Account not found' });

            let authenticated = false;
            if (account.auth_verifier) {
                if (account.auth_verifier.includes(':')) {
                    const [salt, storedHash] = account.auth_verifier.split(':');
                    const computedHash = crypto.scryptSync(serverAuthKey, salt, 64);
                    const storedHashBuf = Buffer.from(storedHash, 'hex');
                    if (computedHash.length === storedHashBuf.length) {
                        authenticated = crypto.timingSafeEqual(computedHash, storedHashBuf);
                    }
                } else {
                    authenticated = account.auth_verifier === serverAuthKey;
                }
            }
            if (!authenticated) return res.status(401).json({ error: 'Invalid credentials for promotion' });

            // Promote this server to primary
            // --- But first, sync global profile from old primary ---
            // The global_profiles table is per-node. Without this sync, the new
            // primary would have an empty profile for the user, breaking the
            // profile page. Best-effort: if old primary is unreachable, the
            // user can re-set their profile manually.
            if (oldPrimaryUrl) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    const profileRes = await federationFetch(
                        `${oldPrimaryUrl}/api/federation/profile/${accountId}`,
                        { signal: controller.signal as any }
                    );
                    clearTimeout(timeoutId);
                    if (profileRes.ok) {
                        const profile = await profileRes.json() as any;
                        if (profile && profile.account_id) {
                            await db.runNodeQuery(`
                                INSERT INTO global_profiles (account_id, display_name, bio, avatar_url, status_message, version, signature)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                                ON CONFLICT(account_id) DO UPDATE SET
                                    display_name = excluded.display_name,
                                    bio = excluded.bio,
                                    avatar_url = excluded.avatar_url,
                                    status_message = excluded.status_message,
                                    version = excluded.version,
                                    signature = excluded.signature
                            `, [
                                profile.account_id,
                                profile.display_name || '',
                                profile.bio || '',
                                profile.avatar_url || '',
                                profile.status_message || '',
                                profile.version || 1,
                                profile.signature || ''
                            ]);
                            console.log(`[Federation] Synced global profile from ${oldPrimaryUrl} for ${accountId}`);
                        }
                    }
                } catch (err: any) {
                    console.log(`[Federation] Could not sync global profile from old primary: ${err.message}`);
                }
            }
            const selfUrl = `${req.protocol}://${req.get('host')}`;
            await db.runNodeQuery(
                "UPDATE accounts SET authority_role = 'primary', primary_server_url = NULL, updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?",
                [accountId]
            );

            // Ensure the newly-promoted server is 'trusted' in account_servers
            await db.runNodeQuery(
                "INSERT INTO account_servers (account_id, server_url, trust_level) VALUES (?, ?, 'trusted') ON CONFLICT(account_id, server_url) DO UPDATE SET trust_level = 'trusted'",
                [accountId, selfUrl]
            );

            // Build delegation cert for demote calls (signed by us, the new primary)
            const identity = getServerIdentity();
            const demoteTimestamp = Date.now();
            const demotePayload = { userId: accountId, targetServerUrl: selfUrl, timestamp: demoteTimestamp };
            const demoteSignature = signDelegationPayload(demotePayload, identity.privateKey);
            const pubKeyB64 = identity.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
            const demoteCert = { payload: demotePayload, signature: demoteSignature, primaryPublicKey: pubKeyB64 };

            // Best-effort: demote old primary
            if (oldPrimaryUrl) {
                (async () => {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 3000);
                        await federationFetch(`${oldPrimaryUrl}/api/federation/demote`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ accountId, newPrimaryUrl: selfUrl, delegationCert: demoteCert }),
                            signal: controller.signal as any
                        });
                        clearTimeout(timeoutId);
                    } catch (err: any) {
                        console.log(`[Federation] Failed to demote old primary ${oldPrimaryUrl}: ${err.message}`);
                    }
                })();
            }

            // Best-effort: notify all OTHER servers in account_servers to demote
            const allServers = await db.allNodeQuery('SELECT server_url FROM account_servers WHERE account_id = ?', [accountId]);
            for (const srv of allServers as any[]) {
                if (srv.server_url === selfUrl || srv.server_url === oldPrimaryUrl) continue;
                (async () => {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 3000);
                        await federationFetch(`${srv.server_url}/api/federation/demote`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ accountId, newPrimaryUrl: selfUrl, delegationCert: demoteCert }),
                            signal: controller.signal as any
                        });
                        clearTimeout(timeoutId);
                    } catch (err: any) {
                        console.log(`[Federation] Failed to notify replica ${srv.server_url} of demotion: ${err.message}`);
                    }
                })();
            }

            // Generate a fresh JWT signed by this server (the new primary)
            // so the client can immediately authenticate without re-login.
            // Without this, the client would keep using the old JWT with
            // iss=oldPrimary, forcing every node to take the expensive remote
            // key fetch path in requireAuth until re-login.
            const newToken = generateToken(accountId, selfUrl, selfUrl);
            res.json({ success: true, message: 'Server promoted to Primary', token: newToken });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/federation/deactivate', async (req, res) => {
        try {
            const { accountId, delegationCert } = req.body;
            if (!delegationCert || !delegationCert.payload || !delegationCert.signature || !delegationCert.primaryPublicKey) {
                return res.status(400).json({ error: 'Malformed delegation certificate' });
            }

            const { payload, signature, primaryPublicKey } = delegationCert;
            if (payload.userId !== accountId) return res.status(400).json({ error: 'Invalid delegation parameters' });
            if (Date.now() - payload.timestamp > 1000 * 60 * 60 * 24) return res.status(401).json({ error: 'Delegation certificate expired' });

            const isValid = verifyDelegationSignature(payload, signature, primaryPublicKey);
            if (!isValid) return res.status(401).json({ error: 'Invalid signature on delegation certificate' });

            // Deactivate the account
            await db.runNodeQuery('UPDATE accounts SET is_deactivated = 1 WHERE id = ?', [accountId]);

            // Set membership_status=left on ALL profiles for this account across all loaded servers
            const servers = await db.getAllLoadedServers();
            for (const server of servers) {
                await db.runGuildQuery(
                    server.id,
                    "UPDATE profiles SET membership_status = 'left', left_at = ? WHERE account_id = ?",
                    [Date.now(), accountId]
                );
            }

            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/federation/demote', async (req, res) => {
        try {
            const { accountId, newPrimaryUrl, delegationCert } = req.body;
            if (!delegationCert || !delegationCert.payload || !delegationCert.signature || !delegationCert.primaryPublicKey) {
                return res.status(400).json({ error: 'Malformed delegation certificate' });
            }

            const { payload, signature, primaryPublicKey } = delegationCert;
            if (payload.userId !== accountId) return res.status(400).json({ error: 'Invalid delegation parameters' });
            if (Date.now() - payload.timestamp > 1000 * 60 * 60 * 24) return res.status(401).json({ error: 'Delegation certificate expired' });

            const isValid = verifyDelegationSignature(payload, signature, primaryPublicKey);
            if (!isValid) return res.status(401).json({ error: 'Invalid signature on delegation certificate' });

            // Demote: set to replica and point to new primary
            await db.runNodeQuery(
                "UPDATE accounts SET authority_role = 'replica', primary_server_url = ?, updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?",
                [newPrimaryUrl, accountId]
            );

            // Clear any cached public keys for the old primary URL.
            // After demotion, the old primary's key in our cache is stale — if we
            // later need to verify tokens issued by the new primary, we should
            // fetch the new primary's key fresh rather than using a cached entry.
            const selfUrl = `${req.protocol}://${req.get('host')}`;
            _remoteKeyCache.clearUrl(selfUrl);
            if (newPrimaryUrl) _remoteKeyCache.clearUrl(newPrimaryUrl);

            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /api/accounts/:accountId/state
     * Returns the authenticated user's account-bound state: linked servers,
     * dismissed_global_claim, authority_role, and primary_server_url.
     * Users can only fetch their own state.
     */
    app.get('/api/accounts/:accountId/state', requireAuth, async (req: any, res: any) => {
        try {
            const { accountId } = req.params;
            if (accountId !== req.accountId) {
                return res.status(403).json({ error: 'Forbidden: Cannot access another user\'s state' });
            }

            const servers = await db.allNodeQuery(
                'SELECT server_url, trust_level, status FROM account_servers WHERE account_id = ?',
                [accountId]
            );
            const account: any = await db.getNodeQuery(
                'SELECT dismissed_global_claim, authority_role, primary_server_url, is_creator FROM accounts WHERE id = ?',
                [accountId]
            );

            res.json({
                servers: servers.map((s: any) => ({ url: s.server_url, trust_level: s.trust_level, status: s.status })),
                dismissed_global_claim: !!(account?.dismissed_global_claim),
                authority_role: account?.authority_role || 'primary',
                primary_server_url: account?.primary_server_url || null,
                is_creator: !!(account?.is_creator)
            });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * POST /api/accounts/:accountId/servers
     * Registers a server in the account's server list with trust_level='untrusted'
     * and status='active'. Uses INSERT OR IGNORE for idempotency.
     */
    app.post('/api/accounts/:accountId/servers', requireAuth, async (req: any, res: any) => {
        try {
            const { accountId } = req.params;
            const { serverUrl } = req.body;
            if (!serverUrl) return res.status(400).json({ error: 'Missing serverUrl' });

            await db.runNodeQuery(
                'INSERT OR IGNORE INTO account_servers (account_id, server_url, trust_level, status) VALUES (?, ?, ?, ?)',
                [accountId, serverUrl, 'untrusted', 'active']
            );
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/guest/login', async (req, res) => {
        try {
            const guestId = `guest-${crypto.randomUUID()}`;
            const primaryUrl = `${req.protocol}://${req.get('host')}`;
            const token = generateToken(guestId, primaryUrl);
            res.json({ id: guestId, email: 'Guest', is_creator: false, isGuest: true, trusted_servers: [], token });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/accounts/unclaimed-imports', requireAuth, async (req, res) => {
        try {
            const accountId = req.accountId;
            const account: any = await db.getNodeQuery('SELECT dismissed_global_claim FROM accounts WHERE id = ?', [accountId]);
            if (account?.dismissed_global_claim) {
                return res.json([]);
            }
            const imports = await db.allNodeQuery('SELECT id, global_name, avatar, bio FROM imported_discord_users WHERE account_id IS NULL');
            res.json(imports);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/dismiss-claim', requireAuth, async (req, res) => {
        try {
            const accountId = req.accountId;
            const acc: any = await db.getNodeQuery('SELECT authority_role FROM accounts WHERE id = ?', [accountId]);
            if (acc && acc.authority_role === 'replica') {
                return res.status(403).json({ error: "Cannot dismiss claim on a Replica server." });
            }

            await db.runNodeQuery('UPDATE accounts SET dismissed_global_claim = 1 WHERE id = ?', [accountId]);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/link-discord', requireAuth, async (req, res) => {
        try {
            const { discord_id } = req.body;
            const accountId = req.accountId;
            if (!accountId) return res.status(401).json({ error: "Unauthorized" });

            const acc: any = await db.getNodeQuery('SELECT authority_role FROM accounts WHERE id = ?', [accountId]);
            if (acc && acc.authority_role === 'replica') {
                return res.status(403).json({ error: "Cannot link discord on a Replica server. Please use your Primary server." });
            }

            // 1. Link in Node DB
            await db.runNodeQuery('UPDATE imported_discord_users SET account_id = ? WHERE id = ?', [accountId, discord_id]);
            await db.runNodeQuery('UPDATE accounts SET dismissed_global_claim = 1 WHERE id = ?', [accountId]);

            // 2. Update Global Profile (display_name, avatar, bio)
            const imported: any = await db.getNodeQuery('SELECT * FROM imported_discord_users WHERE id = ?', [discord_id]);
            if (imported) {
                await db.runNodeQuery(
                    `INSERT INTO global_profiles (account_id, display_name, avatar_url, bio) VALUES (?, ?, ?, ?) 
                     ON CONFLICT(account_id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url, bio = excluded.bio`,
                    [accountId, imported.global_name || '', imported.avatar || '', imported.bio || '']
                );
            }

            // 3. Link across all loaded servers
            const servers = await db.getAllLoadedServers();
            for (const server of servers) {
                await db.runGuildQuery(server.id, 'UPDATE profiles SET account_id = ? WHERE id = ?', [accountId, discord_id]);
                const profile = await db.getGuildQuery(server.id, 'SELECT * FROM profiles WHERE id = ? AND server_id = ?', [discord_id, server.id]);
                if (profile) {
                    broadcastMessage({ type: 'PROFILE_UPDATE', data: profile });
                }
            }

            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });



    app.post('/api/import', requireNodeOperator, async (req: any, res: any) => {
        const { path: filePath } = req.body;
        try {
            const { importDirectory, importDiscordJson } = await import('./importer');
            const fsMod = require('fs');
            const stat = fsMod.statSync(filePath);
            if (stat.isDirectory()) {
                const pathNode = require('path');
                const serverName = pathNode.basename(filePath);
                await importDirectory(filePath, serverName);
            } else {
                const guildId = 'server-' + Date.now().toString();
                // P18 FIX: was 'INTO servers' — node.db registry table is 'guilds'
                await db.runNodeQuery(`INSERT OR IGNORE INTO guilds (id, name, icon, owner_account_id) VALUES (?, ?, ?, ?)`, [guildId, "Imported Server", '', '']);
                await importDiscordJson(filePath, guildId, 'legacy-id');
            }
            res.json({ success: true, message: 'Import triggered' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });



    /**
     * PUT /api/accounts/password/unauthenticated
     * Pre-login password change — used when the user is not yet logged in
     * (e.g., "Forgot Password" flow on the login screen).
     * Accepts email + oldServerAuthKey (derived from current password) for verification.
     * Does NOT require a JWT token, but DOES require the current password to be correct.
     */
    app.put('/api/accounts/password/unauthenticated', async (req: any, res: any) => {
        const { email, oldServerAuthKey, serverAuthKey, public_key, encrypted_private_key, key_salt, key_iv } = req.body;

        if (!email || !oldServerAuthKey || !serverAuthKey) {
            return res.status(400).json({ error: 'Missing required fields: email, oldServerAuthKey, serverAuthKey' });
        }

        try {
            const acc: any = await db.getNodeQuery('SELECT * FROM accounts WHERE email = ?', [email]);
            if (!acc) return res.status(404).json({ error: 'Account not found' });

            if (acc.authority_role === 'replica') {
                return res.status(403).json({ error: 'Cannot modify credentials on a Replica server. Please use your Primary server.' });
            }

            // Verify the current password
            let authenticated = false;
            if (acc.auth_verifier) {
                if (acc.auth_verifier.includes(':')) {
                    const [salt, storedHash] = acc.auth_verifier.split(':');
                    const computedHash = crypto.scryptSync(oldServerAuthKey, salt, 64);
                    const storedHashBuf = Buffer.from(storedHash, 'hex');
                    if (computedHash.length === storedHashBuf.length) {
                        authenticated = crypto.timingSafeEqual(computedHash, storedHashBuf);
                    }
                } else {
                    authenticated = acc.auth_verifier === oldServerAuthKey;
                }
            }

            if (!authenticated) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }

            // Hash the new password with a fresh scrypt salt
            const newSalt = crypto.randomBytes(16).toString('hex');
            const hashedVerifier = crypto.scryptSync(serverAuthKey, newSalt, 64).toString('hex');
            const newAuthVerifier = `${newSalt}:${hashedVerifier}`;

            const updateFields: any[] = [newAuthVerifier, encrypted_private_key, key_salt, key_iv];
            let sql = 'UPDATE accounts SET auth_verifier = ?, encrypted_private_key = ?, key_salt = ?, key_iv = ?';

            if (public_key) {
                sql += ', public_key = ?';
                updateFields.push(public_key);
            }

            sql += ", updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?";
            updateFields.push(acc.id);

            await db.runNodeQuery(sql, updateFields);

            // Propagate to trusted servers
            const trustedServers = await db.allNodeQuery(
                'SELECT server_url FROM account_servers WHERE account_id = ? AND trust_level = ?',
                [acc.id, 'trusted']
            );
            const selfUrl = `${req.protocol}://${req.get('host')}`;
            const updatedAccount: any = await db.getNodeQuery('SELECT * FROM accounts WHERE id = ?', [acc.id]);
            const allServerUrls = await db.allNodeQuery('SELECT server_url FROM account_servers WHERE account_id = ?', [acc.id]);

            for (const srv of trustedServers as any[]) {
                if (srv.server_url === selfUrl) continue;
                (async () => {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 3000);
                        await federationFetch(`${srv.server_url}/api/accounts/sync`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                account: updatedAccount,
                                trusted_servers: (allServerUrls as any[]).map((s: any) => s.server_url)
                            }),
                            signal: controller.signal as any
                        });
                        clearTimeout(timeoutId);
                    } catch (err: any) {
                        console.log(`[Federation] Failed to propagate password change to ${srv.server_url}: ${err.message}`);
                    }
                })();
            }

            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/accounts/password', requireAuth, async (req: any, res: any) => {
        const { oldServerAuthKey, serverAuthKey, public_key, encrypted_private_key, key_salt, key_iv } = req.body;
        const accountId = req.accountId;

        if (!oldServerAuthKey || !serverAuthKey) {
            return res.status(400).json({ error: 'Missing required fields: oldServerAuthKey and serverAuthKey' });
        }

        try {
            const acc: any = await db.getNodeQuery('SELECT * FROM accounts WHERE id = ?', [accountId]);
            if (!acc) return res.status(404).json({ error: 'Account not found' });

            if (acc.authority_role === 'replica') {
                return res.status(403).json({ error: "Cannot modify credentials on a Replica server. Please use your Primary server." });
            }

            // Verify current password before allowing the change
            let authenticated = false;
            if (acc.auth_verifier) {
                if (acc.auth_verifier.includes(':')) {
                    const [salt, storedHash] = acc.auth_verifier.split(':');
                    const computedHash = crypto.scryptSync(oldServerAuthKey, salt, 64);
                    const storedHashBuf = Buffer.from(storedHash, 'hex');
                    if (computedHash.length === storedHashBuf.length) {
                        authenticated = crypto.timingSafeEqual(computedHash, storedHashBuf);
                    }
                } else {
                    // Legacy plain-text verifier — allow once for migration, then it'll be re-hashed
                    authenticated = acc.auth_verifier === oldServerAuthKey;
                }
            }

            if (!authenticated) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }

            // Hash new password with a fresh scrypt salt (same pattern as signup)
            const newSalt = crypto.randomBytes(16).toString('hex');
            const hashedVerifier = crypto.scryptSync(serverAuthKey, newSalt, 64).toString('hex');
            const newAuthVerifier = `${newSalt}:${hashedVerifier}`;

            const updateFields: any[] = [newAuthVerifier, encrypted_private_key, key_salt, key_iv];
            let sql = 'UPDATE accounts SET auth_verifier = ?, encrypted_private_key = ?, key_salt = ?, key_iv = ?';

            // Re-key: also update public_key if a new one is provided
            if (public_key) {
                sql += ', public_key = ?';
                updateFields.push(public_key);
            }

            sql += ", updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?";
            updateFields.push(accountId);

            await db.runNodeQuery(sql, updateFields);

            // Propagate password change to all trusted servers
            const trustedServers = await db.allNodeQuery(
                'SELECT server_url FROM account_servers WHERE account_id = ? AND trust_level = ?',
                [accountId, 'trusted']
            );
            const selfUrl = `${req.protocol}://${req.get('host')}`;
            const updatedAccount: any = await db.getNodeQuery('SELECT * FROM accounts WHERE id = ?', [accountId]);
            const allServerUrls = await db.allNodeQuery('SELECT server_url FROM account_servers WHERE account_id = ?', [accountId]);

            for (const srv of trustedServers as any[]) {
                if (srv.server_url === selfUrl) continue;
                (async () => {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 3000);
                        await federationFetch(`${srv.server_url}/api/accounts/sync`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                account: updatedAccount,
                                trusted_servers: (allServerUrls as any[]).map((s: any) => s.server_url)
                            }),
                            signal: controller.signal as any
                        });
                        clearTimeout(timeoutId);
                    } catch (err: any) {
                        console.log(`[Federation] Failed to propagate password change to ${srv.server_url}: ${err.message}`);
                    }
                })();
            }

            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/accounts/relationships/request', requireAuth, async (req: any, res: any) => {
        try {
            const accountId = req.accountId;
            const { targetId } = req.body;
            if (!accountId || !targetId) return res.status(400).json({ error: 'Missing accountId or targetId' });
            const existing: any = await db.getNodeQuery('SELECT status FROM relationships WHERE account_id = ? AND target_id = ?', [accountId, targetId]);
            if (existing) return res.status(409).json({ error: 'Relationship already exists' });
            await db.runNodeQuery('INSERT INTO relationships (account_id, target_id, status, timestamp) VALUES (?, ?, ?, ?)', [accountId, targetId, 'pending', Date.now()]);
            broadcastMessage({ type: 'RELATIONSHIP_UPDATE', data: { account_id: accountId, target_id: targetId, status: 'pending' } });
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/accounts/relationships/accept', requireAuth, async (req: any, res: any) => {
        try {
            const accountId = req.accountId;
            const { targetId } = req.body;
            await db.runNodeQuery('UPDATE relationships SET status = ? WHERE target_id = ? AND account_id = ? AND status = ?', ['friend', targetId, accountId, 'pending']);
            broadcastMessage({ type: 'RELATIONSHIP_UPDATE', data: { account_id: targetId, target_id: accountId, status: 'friend' } });
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/accounts/relationships/:targetId', requireAuth, async (req: any, res: any) => {
        try {
            const accountId = req.accountId;
            const { targetId } = req.params;
            await db.runNodeQuery('DELETE FROM relationships WHERE (account_id = ? AND target_id = ?) OR (account_id = ? AND target_id = ?)', [accountId, targetId, targetId, accountId]);
            broadcastMessage({ type: 'RELATIONSHIP_UPDATE', data: { account_id: accountId, target_id: targetId, status: 'none' } });
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // Global Error Handler
    app.use((err: any, req: any, res: any, next: any) => {
        console.error("GLOBAL SERVER ERROR:", err);
        res.status(500).json({ 
            error: "Internal Server Error", 
            message: err.message, 
            stack: err.stack 
        });
    });

    return app;
};

function dualMount(router: any, method: string, path: string, ...handlers: any[]) {
    const guildPath = path;
    const serverPath = path.replace(':guildId', ':serverId').replace('/guilds/', '/servers/');
    router[method](guildPath, ...handlers);
    router[method](serverPath, ...handlers);
}
