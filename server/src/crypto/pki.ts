/**
 * Server PKI Engine — Ed25519 Identity Keypair Management
 * 
 * Generates, persists, and loads a persistent Ed25519 keypair that serves as
 * the server's cryptographic identity for federation. Keys are stored in PEM
 * format within the data directory (already .gitignored).
 * 
 * This module is a pure utility with no coupling to Express or HTTP.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { generateRevocationCode, hashRevocationCode } from './revocation';
import { federationFetch } from '../utils/federationFetch';

// --- File Paths ---
const PRIVATE_KEY_FILENAME = 'server_identity.key';
const PUBLIC_KEY_FILENAME = 'server_identity.pub';
const REVOCATION_HASH_FILENAME = '.revocation_hash';

// --- In-Memory Singleton ---
let cachedIdentity: { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject } | null = null;

export interface ServerIdentity {
    publicKey: crypto.KeyObject;
    privateKey: crypto.KeyObject;
}

/**
 * Returns the paths for identity key files given a data directory.
 */
export function getIdentityPaths(dataDir: string) {
    return {
        privateKeyPath: path.join(dataDir, PRIVATE_KEY_FILENAME),
        publicKeyPath: path.join(dataDir, PUBLIC_KEY_FILENAME),
        revocationHashPath: path.join(dataDir, REVOCATION_HASH_FILENAME),
    };
}

/**
 * Checks whether the server identity key files already exist on disk.
 */
export function identityExists(dataDir: string): boolean {
    const { privateKeyPath, publicKeyPath } = getIdentityPaths(dataDir);
    return fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath);
}

/**
 * Loads an existing server identity from disk.
 * Throws if files are missing or unreadable (e.g. restricted permissions).
 */
export function loadServerIdentity(dataDir: string): ServerIdentity {
    const { privateKeyPath, publicKeyPath } = getIdentityPaths(dataDir);

    // Verify file accessibility before reading
    try {
        fs.accessSync(privateKeyPath, fs.constants.R_OK);
    } catch {
        throw new Error(
            `[PKI] Cannot read private key at ${privateKeyPath}. Check file permissions.`
        );
    }

    try {
        fs.accessSync(publicKeyPath, fs.constants.R_OK);
    } catch {
        throw new Error(
            `[PKI] Cannot read public key at ${publicKeyPath}. Check file permissions.`
        );
    }

    const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf-8');
    const publicKeyPem = fs.readFileSync(publicKeyPath, 'utf-8');

    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const publicKey = crypto.createPublicKey(publicKeyPem);

    console.log(`[PKI] Loaded existing server identity keypair from ${dataDir}`);

    return { publicKey, privateKey };
}

/**
 * Generates a new Ed25519 keypair and persists it to disk.
 * Also generates a one-time revocation code — the raw code is printed to stdout
 * and NEVER written to disk. Only its SHA-256 hash is stored.
 * 
 * Returns the generated identity.
 */
export function generateServerIdentity(dataDir: string): ServerIdentity {
    const { privateKeyPath, publicKeyPath, revocationHashPath } = getIdentityPaths(dataDir);

    // Ensure the data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Generate Ed25519 keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

    // Export to PEM format
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

    // Write keys to disk
    fs.writeFileSync(privateKeyPath, privateKeyPem, { mode: 0o600 });
    fs.writeFileSync(publicKeyPath, publicKeyPem, { mode: 0o644 });

    console.log(`[PKI] Generated new server identity keypair`);
    console.log(`[PKI]   Private key: ${privateKeyPath}`);
    console.log(`[PKI]   Public key:  ${publicKeyPath}`);

    // Generate and handle revocation code
    const revocationCode = generateRevocationCode();
    const revocationHash = hashRevocationCode(revocationCode);

    fs.writeFileSync(revocationHashPath, revocationHash, { mode: 0o600 });

    console.log(`\n${'='.repeat(72)}`);
    console.log(`⚠️  SAVE THIS REVOCATION CODE OFFLINE — IT WILL NOT BE SHOWN AGAIN`);
    console.log(`⚠️  Store it in a password manager or write it down physically.`);
    console.log(`\n    REVOCATION CODE: ${revocationCode}\n`);
    console.log(`${'='.repeat(72)}\n`);

    return { publicKey, privateKey };
}

/**
 * Computes a human-readable fingerprint (SHA-256, first 16 hex chars) of
 * the server's public key PEM for operator identification.
 */
export function computePublicKeyFingerprint(publicKey: crypto.KeyObject): string {
    const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const hash = crypto.createHash('sha256').update(pem).digest('hex');
    return hash.substring(0, 16).toUpperCase();
}

/**
 * Main boot-time initialization routine.
 * 
 * - If keys exist on disk → loads them
 * - If keys don't exist → generates new ones (including revocation code)
 * - Caches the identity in memory for fast runtime access
 * 
 * Returns the server identity.
 */
export function initializeServerIdentity(dataDir: string): ServerIdentity {
    let identity: ServerIdentity;

    if (identityExists(dataDir)) {
        identity = loadServerIdentity(dataDir);
    } else {
        identity = generateServerIdentity(dataDir);
    }

    cachedIdentity = identity;

    const fingerprint = computePublicKeyFingerprint(identity.publicKey);
    console.log(`[PKI] Server identity fingerprint: ${fingerprint}`);

    return identity;
}

/**
 * Returns the in-memory cached server identity.
 * Throws if `initializeServerIdentity` has not been called yet.
 */
export function getServerIdentity(): ServerIdentity {
    if (!cachedIdentity) {
        throw new Error('[PKI] Server identity not initialized. Call initializeServerIdentity() first.');
    }
    return cachedIdentity;
}

/**
 * Clears the in-memory cached identity. Used for testing.
 */
export function _resetCachedIdentity(): void {
    cachedIdentity = null;
}

/**
 * Signs a structured Delegation payload using the server's Ed25519 identity key.
 */
export function signDelegationPayload(payload: any, privateKey: crypto.KeyObject): string {
    const data = Buffer.from(JSON.stringify(payload));
    return crypto.sign(undefined, data, privateKey).toString('base64');
}

/**
 * Verifies a Delegation Certificate signature against a provided SPKI public key base64.
 */
export function verifyDelegationSignature(payload: any, signatureBase64: string, publicKeyBase64: string): boolean {
    try {
        const data = Buffer.from(JSON.stringify(payload));
        const pubKey = crypto.createPublicKey({
            key: Buffer.from(publicKeyBase64, 'base64'),
            format: 'der',
            type: 'spki'
        });
        return crypto.verify(undefined, data, pubKey, Buffer.from(signatureBase64, 'base64'));
    } catch {
        return false;
    }
}

// --- Dynamic Remote Key Fetching (Phase 1) ---

interface CacheEntry {
    key: crypto.KeyObject;
    expiresAt: number;
}

class PublicKeyCache {
    private cache = new Map<string, CacheEntry>();
    private refreshing = new Set<string>();
    private maxSize = 1000;
    private ttlMs = 1000 * 60 * 5; // 5 minutes
    private staleThresholdMs = 1000 * 60 * 1; // refresh in background if < 1 min left

    get(url: string): crypto.KeyObject | null {
        const entry = this.cache.get(url);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(url);
            return null;
        }
        // Stale-while-revalidate: refresh in background if getting close to expiry.
        // Guard with `refreshing` set to prevent re-entrant recursion:
        // get() → fetchRemotePublicKey() → get() → fetchRemotePublicKey() → stack overflow
        if (entry.expiresAt - Date.now() < this.staleThresholdMs && !this.refreshing.has(url)) {
            this.refreshing.add(url);
            fetchRemotePublicKey(url)
                .catch(() => {})
                .finally(() => this.refreshing.delete(url));
        }
        return entry.key;
    }

    set(url: string, key: crypto.KeyObject) {
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) this.cache.delete(firstKey);
        }
        this.cache.set(url, { key, expiresAt: Date.now() + this.ttlMs });
    }

    _clear() {
        this.cache.clear();
        this.refreshing.clear();
    }

    /**
     * Removes a specific URL from the cache, forcing the next access to
     * re-fetch the key. Used when a node's role changes (promote/demote)
     * to prevent stale keys from causing auth failures.
     */
    clearUrl(url: string) {
        this.cache.delete(url);
        this.refreshing.delete(url);
    }
}

const remoteKeyCache = new PublicKeyCache();

/**
 * Fetches and caches the Ed25519 public key of a remote Harmony server.
 */
export async function fetchRemotePublicKey(issuerUrl: string): Promise<crypto.KeyObject> {
    const cached = remoteKeyCache.get(issuerUrl);
    if (cached) return cached;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
        const res = await federationFetch(`${issuerUrl}/api/federation/key`, {
            signal: controller.signal as any
        });

        if (!res.ok) throw new Error(`HTTP error fetching public key from ${issuerUrl}: ${res.status}`);
        const data = await res.json() as any;
        if (!data.public_key) throw new Error(`Invalid response missing public_key from ${issuerUrl}`);

        const pubKey = crypto.createPublicKey({
            key: Buffer.from(data.public_key, 'base64'),
            format: 'der',
            type: 'spki'
        });

        remoteKeyCache.set(issuerUrl, pubKey);
        return pubKey;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Exposing cache for testing purposes.
 */
export const _remoteKeyCache = remoteKeyCache;
