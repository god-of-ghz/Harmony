/**
 * Guild Identity — Per-Guild Ed25519 Keypair Management
 *
 * Each guild gets its own Ed25519 keypair for cryptographic identity that:
 * - Uniquely identifies the guild regardless of hosting node
 * - Survives migration (included in export bundles)
 * - Is encrypted at rest with the guild owner's public key (so the node
 *   operator cannot impersonate the guild)
 * - Allows clients to verify "this is the same guild I was in before"
 *
 * Encryption approach: Option A (Ed25519 → X25519 conversion + ECDH)
 * 1. Convert the guild owner's Ed25519 public key to X25519
 * 2. Generate an ephemeral X25519 keypair
 * 3. Derive a shared secret via X25519 ECDH
 * 4. Encrypt the guild's Ed25519 private key with AES-256-GCM using the
 *    shared secret
 * 5. Store the ephemeral public key alongside the ciphertext so the owner
 *    can reconstruct the shared secret with their private key
 *
 * Security note: This module is a pure utility with no coupling to Express.
 * The private key is NEVER written to disk in plaintext.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// --- Constants ---
const GUILD_IDENTITY_FILENAME = 'guild_identity.key';

/**
 * Shape of the guild identity file stored on disk.
 */
export interface GuildIdentityFile {
    version: number;
    algorithm: string;
    publicKey: string;                  // base64-encoded DER (SPKI) public key
    encryptedPrivateKey: string;        // base64-encoded: ephemeralPub(32) + iv(12) + authTag(16) + ciphertext
    encryptionMethod: string;           // 'x25519-aes-256-gcm'
    ownerPublicKeyFingerprint: string;  // fingerprint of the owner key used for encryption
    createdAt: number;                  // Unix epoch seconds
}

/**
 * Result returned by guild identity generation and loading functions.
 */
export interface GuildIdentityResult {
    fingerprint: string;
    publicKey: crypto.KeyObject;
}

/**
 * Full identity including decrypted private key.
 */
export interface GuildFullIdentity {
    fingerprint: string;
    publicKey: crypto.KeyObject;
    privateKey: crypto.KeyObject;
}

// ---------------------------------------------------------------------------
// Ed25519 ↔ X25519 Conversion Utilities
//
// Ed25519 and X25519 share the same underlying curve (Curve25519), but use
// different coordinate representations:
//   - Ed25519 uses twisted Edwards coordinates (x, y)
//   - X25519 uses Montgomery coordinates (u)
//
// The conversion formulas are:
//   Public key:  u = (1 + y) / (1 - y) mod p     (Edwards y → Montgomery u)
//   Private key: SHA-512(seed)[0..31], clamped    (seed → X25519 scalar)
//
// where p = 2^255 - 19
// ---------------------------------------------------------------------------

/** Curve25519 field prime: 2^255 - 19 */
const CURVE25519_P = (1n << 255n) - 19n;

/**
 * Modular exponentiation: base^exp mod m.
 * Used for modular inverse via Fermat's little theorem.
 */
function modPow(base: bigint, exp: bigint, m: bigint): bigint {
    let result = 1n;
    base = ((base % m) + m) % m;
    while (exp > 0n) {
        if (exp & 1n) {
            result = (result * base) % m;
        }
        exp >>= 1n;
        base = (base * base) % m;
    }
    return result;
}

/**
 * Converts an Ed25519 public key to an X25519 public key for ECDH.
 *
 * Extracts the Edwards y-coordinate from the Ed25519 public key encoding,
 * then converts to Montgomery u-coordinate: u = (1 + y) / (1 - y) mod p.
 */
function ed25519PubToX25519(edPub: crypto.KeyObject): crypto.KeyObject {
    const rawEd = edPub.export({ type: 'spki', format: 'der' });

    // Ed25519 SPKI DER is 44 bytes: 12-byte header + 32-byte key material
    const edKeyBytes = rawEd.subarray(rawEd.length - 32);

    // Decode the Edwards y-coordinate from the 32-byte encoding (little-endian)
    // The top bit of the last byte is the sign bit of x; clear it to get y.
    let y = 0n;
    for (let i = 0; i < 32; i++) {
        y |= BigInt(edKeyBytes[i]) << (BigInt(i) * 8n);
    }
    y &= (1n << 255n) - 1n;  // Clear the sign bit

    // Convert: u = (1 + y) * (1 - y)^(-1) mod p
    const p = CURVE25519_P;
    const numerator = (1n + y) % p;
    const denominator = ((p + 1n - y) % p);
    const denominatorInv = modPow(denominator, p - 2n, p);  // Fermat's little theorem
    const u = (numerator * denominatorInv) % p;

    // Encode u as 32 bytes little-endian
    const uBytes = Buffer.alloc(32);
    let val = u;
    for (let i = 0; i < 32; i++) {
        uBytes[i] = Number(val & 0xffn);
        val >>= 8n;
    }

    // Construct X25519 SPKI DER: 12-byte header + 32-byte public key
    return crypto.createPublicKey({
        key: Buffer.concat([
            Buffer.from('302a300506032b656e032100', 'hex'),  // X25519 SPKI header
            uBytes
        ]),
        format: 'der',
        type: 'spki'
    });
}

/**
 * Converts an Ed25519 private key to an X25519 private key for ECDH.
 *
 * Ed25519 stores a 32-byte seed. The actual Ed25519 private scalar is
 * derived as SHA-512(seed)[0..31] with clamping. X25519 uses the same
 * scalar derivation, making the conversion straightforward:
 *   1. Extract the 32-byte seed from the Ed25519 PKCS#8 DER
 *   2. Hash with SHA-512, take first 32 bytes
 *   3. Clamp: clear bits 0,1,2 of first byte; clear bit 7, set bit 6 of last byte
 */
function ed25519PrivToX25519(edPriv: crypto.KeyObject): crypto.KeyObject {
    const rawPrivDer = edPriv.export({ type: 'pkcs8', format: 'der' });

    // Extract the 32-byte seed from the PKCS#8 DER encoding
    // Ed25519 PKCS#8 DER is 48 bytes: 16-byte header + 32-byte seed
    const seed = rawPrivDer.subarray(rawPrivDer.length - 32);

    // SHA-512 of seed → first 32 bytes → clamped = X25519 private scalar
    const hash = crypto.createHash('sha512').update(seed).digest();
    const scalar = Buffer.from(hash.subarray(0, 32));
    scalar[0] &= 248;   // Clear bottom 3 bits
    scalar[31] &= 127;  // Clear top bit
    scalar[31] |= 64;   // Set second-to-top bit

    // Construct X25519 PKCS#8 DER: 16-byte header + 32-byte scalar
    return crypto.createPrivateKey({
        key: Buffer.concat([
            Buffer.from('302e020100300506032b656e04220420', 'hex'),  // X25519 PKCS#8 header
            scalar
        ]),
        format: 'der',
        type: 'pkcs8'
    });
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Computes a human-readable fingerprint from an Ed25519 public key.
 * Format: first 32 hex characters of SHA-256 hash of the DER-encoded public key.
 */
export function computeGuildFingerprint(publicKey: crypto.KeyObject): string {
    const derBytes = publicKey.export({ type: 'spki', format: 'der' });
    const hash = crypto.createHash('sha256').update(derBytes).digest('hex');
    return hash.substring(0, 32);
}

/**
 * Computes the owner's key fingerprint (for the identity file metadata).
 * Uses the same algorithm as computeGuildFingerprint but is semantically
 * distinct — this fingerprints the *owner's* key, not the guild's key.
 */
function computeOwnerKeyFingerprint(ownerPublicKey: crypto.KeyObject): string {
    const derBytes = ownerPublicKey.export({ type: 'spki', format: 'der' });
    const hash = crypto.createHash('sha256').update(derBytes).digest('hex');
    return hash.substring(0, 32);
}

/**
 * Encrypts the guild's Ed25519 private key using the owner's public key.
 *
 * Encryption scheme (Option A):
 * 1. Convert owner's Ed25519 public key → X25519 public key
 * 2. Generate ephemeral X25519 keypair
 * 3. Compute shared secret = ECDH(ephemeralPrivate, ownerX25519Public)
 * 4. Derive AES key = SHA-256(sharedSecret)
 * 5. Encrypt guild private key with AES-256-GCM
 * 6. Output = ephemeralPublicKey(32) || iv(12) || authTag(16) || ciphertext
 */
function encryptPrivateKey(
    guildPrivateKey: crypto.KeyObject,
    ownerPublicKey: crypto.KeyObject
): Buffer {
    // 1. Convert owner's Ed25519 public key to X25519
    const ownerX25519Pub = ed25519PubToX25519(ownerPublicKey);

    // 2. Generate ephemeral X25519 keypair
    const ephemeral = crypto.generateKeyPairSync('x25519');

    // 3. Compute shared secret via ECDH
    const sharedSecret = crypto.diffieHellman({
        privateKey: ephemeral.privateKey,
        publicKey: ownerX25519Pub
    });

    // 4. Derive AES-256 key from shared secret
    const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();

    // 5. Encrypt the guild's private key
    const iv = crypto.randomBytes(12);
    const guildPrivDer = guildPrivateKey.export({ type: 'pkcs8', format: 'der' });
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const encrypted = Buffer.concat([cipher.update(guildPrivDer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // 6. Pack: ephemeralPub(32) || iv(12) || authTag(16) || ciphertext
    const ephemeralPubRaw = ephemeral.publicKey.export({ type: 'spki', format: 'der' });
    // X25519 SPKI DER is 44 bytes: 12-byte header + 32-byte key
    const ephemeralPubBytes = ephemeralPubRaw.subarray(ephemeralPubRaw.length - 32);

    return Buffer.concat([ephemeralPubBytes, iv, authTag, encrypted]);
}

/**
 * Decrypts the guild's Ed25519 private key using the owner's private key.
 *
 * Reverses the encryption scheme:
 * 1. Extract ephemeralPublicKey(32) || iv(12) || authTag(16) || ciphertext
 * 2. Convert owner's Ed25519 private key → X25519 private key
 * 3. Reconstruct ephemeral X25519 public key from raw bytes
 * 4. Compute shared secret = ECDH(ownerX25519Private, ephemeralPublic)
 * 5. Derive AES key = SHA-256(sharedSecret)
 * 6. Decrypt with AES-256-GCM
 */
function decryptPrivateKey(
    encryptedData: Buffer,
    ownerPrivateKey: crypto.KeyObject
): crypto.KeyObject {
    // 1. Unpack: ephemeralPub(32) || iv(12) || authTag(16) || ciphertext
    const ephemeralPubBytes = encryptedData.subarray(0, 32);
    const iv = encryptedData.subarray(32, 44);
    const authTag = encryptedData.subarray(44, 60);
    const ciphertext = encryptedData.subarray(60);

    // 2. Convert owner's Ed25519 private key to X25519
    const ownerX25519Priv = ed25519PrivToX25519(ownerPrivateKey);

    // 3. Reconstruct ephemeral X25519 public key from raw 32 bytes
    const ephemeralPub = crypto.createPublicKey({
        key: Buffer.concat([
            Buffer.from('302a300506032b656e032100', 'hex'),  // X25519 SPKI header
            ephemeralPubBytes
        ]),
        format: 'der',
        type: 'spki'
    });

    // 4. Compute shared secret via ECDH
    const sharedSecret = crypto.diffieHellman({
        privateKey: ownerX25519Priv,
        publicKey: ephemeralPub
    });

    // 5. Derive AES-256 key from shared secret
    const aesKey = crypto.createHash('sha256').update(sharedSecret).digest();

    // 6. Decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    // 7. Reconstruct the Ed25519 private key from DER
    return crypto.createPrivateKey({
        key: decrypted,
        format: 'der',
        type: 'pkcs8'
    });
}

/**
 * Returns the path to the guild identity file within a guild data directory.
 */
export function getGuildIdentityPath(guildDataDir: string): string {
    return path.join(guildDataDir, GUILD_IDENTITY_FILENAME);
}

/**
 * Generates a new Ed25519 keypair for a guild and saves it to disk.
 * The private key is encrypted using the guild owner's public key.
 * Returns the guild's public key fingerprint.
 *
 * @param guildDataDir - Path to the guild's data directory (e.g., data/guilds/{guildId}/)
 * @param ownerPublicKey - The guild owner's Ed25519 public key (as a base64 DER string from accounts table)
 * @returns The guild's fingerprint and public key
 * @throws If key generation or file write fails
 */
export function generateGuildIdentity(
    guildDataDir: string,
    ownerPublicKey: string
): { fingerprint: string; publicKey: crypto.KeyObject } {
    // Ensure the guild data directory exists
    if (!fs.existsSync(guildDataDir)) {
        fs.mkdirSync(guildDataDir, { recursive: true });
    }

    // Parse the owner's public key from base64 DER
    const ownerPubKeyObj = crypto.createPublicKey({
        key: Buffer.from(ownerPublicKey, 'base64'),
        format: 'der',
        type: 'spki'
    });

    // Generate Ed25519 keypair for the guild
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

    // Compute fingerprints
    const fingerprint = computeGuildFingerprint(publicKey);
    const ownerFingerprint = computeOwnerKeyFingerprint(ownerPubKeyObj);

    // Encrypt the private key with the owner's public key
    const encryptedPrivateKey = encryptPrivateKey(privateKey, ownerPubKeyObj);

    // Build the identity file
    const identityFile: GuildIdentityFile = {
        version: 1,
        algorithm: 'ed25519',
        publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        encryptedPrivateKey: encryptedPrivateKey.toString('base64'),
        encryptionMethod: 'x25519-aes-256-gcm',
        ownerPublicKeyFingerprint: ownerFingerprint,
        createdAt: Math.floor(Date.now() / 1000)
    };

    // Write to disk with restricted permissions
    const identityPath = getGuildIdentityPath(guildDataDir);
    fs.writeFileSync(identityPath, JSON.stringify(identityFile, null, 2), { mode: 0o600 });

    console.log(`[GuildIdentity] Generated identity for guild in ${guildDataDir}`);
    console.log(`[GuildIdentity]   Fingerprint: ${fingerprint}`);
    console.log(`[GuildIdentity]   Encrypted with owner key: ${ownerFingerprint}`);

    return { fingerprint, publicKey };
}

/**
 * Loads a guild's identity from disk.
 * Returns the public key and fingerprint (does NOT decrypt private key).
 *
 * @param guildDataDir - Path to the guild's data directory
 * @returns The guild's fingerprint and public key, or null if not found
 */
export function loadGuildPublicIdentity(
    guildDataDir: string
): { fingerprint: string; publicKey: crypto.KeyObject } | null {
    const identityPath = getGuildIdentityPath(guildDataDir);

    if (!fs.existsSync(identityPath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(identityPath, 'utf-8');
        const data: GuildIdentityFile = JSON.parse(raw);

        const publicKey = crypto.createPublicKey({
            key: Buffer.from(data.publicKey, 'base64'),
            format: 'der',
            type: 'spki'
        });

        const fingerprint = computeGuildFingerprint(publicKey);

        return { fingerprint, publicKey };
    } catch (err) {
        console.error(`[GuildIdentity] Failed to load public identity from ${guildDataDir}:`, err);
        return null;
    }
}

/**
 * Decrypts and loads the guild's full identity (including private key).
 * Requires the guild owner's private key for decryption.
 * Used during guild export.
 *
 * @param guildDataDir - Path to the guild's data directory
 * @param ownerPrivateKey - The guild owner's Ed25519 private key
 * @returns Full identity including fingerprint, public key, and private key, or null on failure
 */
export function loadGuildFullIdentity(
    guildDataDir: string,
    ownerPrivateKey: crypto.KeyObject
): GuildFullIdentity | null {
    const identityPath = getGuildIdentityPath(guildDataDir);

    if (!fs.existsSync(identityPath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(identityPath, 'utf-8');
        const data: GuildIdentityFile = JSON.parse(raw);

        const publicKey = crypto.createPublicKey({
            key: Buffer.from(data.publicKey, 'base64'),
            format: 'der',
            type: 'spki'
        });

        const encryptedPrivateKey = Buffer.from(data.encryptedPrivateKey, 'base64');
        const privateKey = decryptPrivateKey(encryptedPrivateKey, ownerPrivateKey);

        const fingerprint = computeGuildFingerprint(publicKey);

        return { fingerprint, publicKey, privateKey };
    } catch (err) {
        console.error(`[GuildIdentity] Failed to load full identity from ${guildDataDir}:`, err);
        return null;
    }
}

/**
 * Verifies that a guild's identity matches an expected fingerprint.
 *
 * @param guildDataDir - Path to the guild's data directory
 * @param expectedFingerprint - The expected fingerprint to verify against
 * @returns true if the guild's identity fingerprint matches the expected one
 */
export function verifyGuildFingerprint(
    guildDataDir: string,
    expectedFingerprint: string
): boolean {
    const identity = loadGuildPublicIdentity(guildDataDir);
    if (!identity) {
        return false;
    }
    return identity.fingerprint === expectedFingerprint;
}
