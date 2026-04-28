import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
    generateGuildIdentity,
    loadGuildPublicIdentity,
    loadGuildFullIdentity,
    computeGuildFingerprint,
    verifyGuildFingerprint,
    getGuildIdentityPath,
    GuildIdentityFile
} from '../crypto/guild_identity';
import dbManager from '../database';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate an Ed25519 keypair for use as a test "owner" account. */
function generateOwnerKeypair() {
    return crypto.generateKeyPairSync('ed25519');
}

/** Export owner public key as base64 DER string (matches accounts.public_key column format). */
function ownerPubKeyToBase64(publicKey: crypto.KeyObject): string {
    return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

/** Create a temp directory for test data, returning its path. */
function createTempDir(): string {
    const dir = path.join(__dirname, `test_guild_identity_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** Remove a directory recursively. */
function rmrf(dir: string) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// 1. Key Generation
// ---------------------------------------------------------------------------
describe('Guild Identity — Key Generation', () => {
    let tempDir: string;

    beforeEach(() => { tempDir = createTempDir(); });
    afterEach(() => { rmrf(tempDir); });

    it('should generate a guild identity and return fingerprint + public key', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        const result = generateGuildIdentity(tempDir, ownerPubBase64);

        expect(result).toBeDefined();
        expect(result.fingerprint).toBeTruthy();
        expect(result.fingerprint).toHaveLength(32);
        expect(/^[0-9a-f]{32}$/.test(result.fingerprint)).toBe(true);
        expect(result.publicKey).toBeDefined();
        expect(result.publicKey.type).toBe('public');
        expect(result.publicKey.asymmetricKeyType).toBe('ed25519');
    });

    it('should create the guild_identity.key file on disk', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        generateGuildIdentity(tempDir, ownerPubBase64);

        const identityPath = getGuildIdentityPath(tempDir);
        expect(fs.existsSync(identityPath)).toBe(true);
    });

    it('should create the guild data directory if it does not exist', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);
        const nestedDir = path.join(tempDir, 'nested', 'guild', 'dir');

        generateGuildIdentity(nestedDir, ownerPubBase64);

        expect(fs.existsSync(nestedDir)).toBe(true);
        expect(fs.existsSync(getGuildIdentityPath(nestedDir))).toBe(true);
    });

    it('should write a valid JSON identity file with expected fields', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        generateGuildIdentity(tempDir, ownerPubBase64);

        const identityPath = getGuildIdentityPath(tempDir);
        const raw = fs.readFileSync(identityPath, 'utf-8');
        const data: GuildIdentityFile = JSON.parse(raw);

        expect(data.version).toBe(1);
        expect(data.algorithm).toBe('ed25519');
        expect(data.publicKey).toBeTruthy();
        expect(data.encryptedPrivateKey).toBeTruthy();
        expect(data.encryptionMethod).toBe('x25519-aes-256-gcm');
        expect(data.ownerPublicKeyFingerprint).toBeTruthy();
        expect(data.ownerPublicKeyFingerprint).toHaveLength(32);
        expect(data.createdAt).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 2. Key Persistence
// ---------------------------------------------------------------------------
describe('Guild Identity — Key Persistence', () => {
    let tempDir: string;

    beforeEach(() => { tempDir = createTempDir(); });
    afterEach(() => { rmrf(tempDir); });

    it('should load the same fingerprint after generation', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        const generated = generateGuildIdentity(tempDir, ownerPubBase64);
        const loaded = loadGuildPublicIdentity(tempDir);

        expect(loaded).not.toBeNull();
        expect(loaded!.fingerprint).toBe(generated.fingerprint);
    });

    it('should load the same public key after generation', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        const generated = generateGuildIdentity(tempDir, ownerPubBase64);
        const loaded = loadGuildPublicIdentity(tempDir);

        expect(loaded).not.toBeNull();

        const genPem = generated.publicKey.export({ type: 'spki', format: 'pem' });
        const loadedPem = loaded!.publicKey.export({ type: 'spki', format: 'pem' });
        expect(loadedPem).toEqual(genPem);
    });

    it('should return null when loading from a directory with no identity file', () => {
        const loaded = loadGuildPublicIdentity(tempDir);
        expect(loaded).toBeNull();
    });

    it('should return null when loading from a non-existent directory', () => {
        const loaded = loadGuildPublicIdentity(path.join(tempDir, 'nonexistent'));
        expect(loaded).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 3. Fingerprint Computation
// ---------------------------------------------------------------------------
describe('Guild Identity — Fingerprint Computation', () => {
    let tempDir: string;

    beforeEach(() => { tempDir = createTempDir(); });
    afterEach(() => { rmrf(tempDir); });

    it('should produce different fingerprints for different guild identities', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        const dir1 = path.join(tempDir, 'guild1');
        const dir2 = path.join(tempDir, 'guild2');

        const id1 = generateGuildIdentity(dir1, ownerPubBase64);
        const id2 = generateGuildIdentity(dir2, ownerPubBase64);

        expect(id1.fingerprint).not.toBe(id2.fingerprint);
    });

    it('should compute deterministic fingerprints for the same key', () => {
        const { publicKey } = crypto.generateKeyPairSync('ed25519');

        const fp1 = computeGuildFingerprint(publicKey);
        const fp2 = computeGuildFingerprint(publicKey);

        expect(fp1).toBe(fp2);
        expect(fp1).toHaveLength(32);
    });

    it('should compute a 32-hex-char fingerprint', () => {
        const { publicKey } = crypto.generateKeyPairSync('ed25519');
        const fp = computeGuildFingerprint(publicKey);

        expect(fp).toHaveLength(32);
        expect(/^[0-9a-f]{32}$/.test(fp)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 4. Fingerprint Verification
// ---------------------------------------------------------------------------
describe('Guild Identity — Fingerprint Verification', () => {
    let tempDir: string;

    beforeEach(() => { tempDir = createTempDir(); });
    afterEach(() => { rmrf(tempDir); });

    it('should verify correct fingerprint', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        const identity = generateGuildIdentity(tempDir, ownerPubBase64);
        const result = verifyGuildFingerprint(tempDir, identity.fingerprint);

        expect(result).toBe(true);
    });

    it('should reject incorrect fingerprint', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        generateGuildIdentity(tempDir, ownerPubBase64);
        const result = verifyGuildFingerprint(tempDir, 'deadbeefdeadbeefdeadbeefdeadbeef');

        expect(result).toBe(false);
    });

    it('should return false for non-existent identity', () => {
        const result = verifyGuildFingerprint(tempDir, 'deadbeefdeadbeefdeadbeefdeadbeef');
        expect(result).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 5. Encryption at Rest
// ---------------------------------------------------------------------------
describe('Guild Identity — Encryption at Rest', () => {
    let tempDir: string;

    beforeEach(() => { tempDir = createTempDir(); });
    afterEach(() => { rmrf(tempDir); });

    it('should NOT contain raw private key bytes in the identity file', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        // Generate an identity and then inspect the file
        const identity = generateGuildIdentity(tempDir, ownerPubBase64);

        // Also generate the guild's raw private key format to compare against.
        // We know the file stores it encrypted; verify by checking the file
        // does NOT contain the raw private key PEM or DER.
        const identityPath = getGuildIdentityPath(tempDir);
        const rawFile = fs.readFileSync(identityPath, 'utf-8');
        const data: GuildIdentityFile = JSON.parse(rawFile);

        // The encrypted private key should not be the same as the raw DER base64.
        // We can't directly access the private key from the generated identity result
        // (which only returns the public key), but we can verify the encrypted
        // field is different from what a raw PKCS#8 DER would look like.
        
        // A raw Ed25519 PKCS#8 DER is 48 bytes → 64 base64 chars.
        // The encrypted data includes ephemeral pub (32) + iv (12) + authTag (16) + ciphertext (48)
        // = 108 bytes → 144 base64 chars. So the encrypted field should be significantly larger.
        const encryptedBytes = Buffer.from(data.encryptedPrivateKey, 'base64');
        
        // 32 (ephemeral pub) + 12 (iv) + 16 (auth tag) + at least 48 (encrypted PKCS#8 DER)
        expect(encryptedBytes.length).toBeGreaterThanOrEqual(108);

        // Ensure the file doesn't contain the PEM markers
        expect(rawFile).not.toContain('BEGIN PRIVATE KEY');
        expect(rawFile).not.toContain('END PRIVATE KEY');
    });

    it('should store the encryption method metadata correctly', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        generateGuildIdentity(tempDir, ownerPubBase64);

        const identityPath = getGuildIdentityPath(tempDir);
        const data: GuildIdentityFile = JSON.parse(fs.readFileSync(identityPath, 'utf-8'));

        expect(data.encryptionMethod).toBe('x25519-aes-256-gcm');
    });
});

// ---------------------------------------------------------------------------
// 6. Decryption Roundtrip
// ---------------------------------------------------------------------------
describe('Guild Identity — Decryption Roundtrip', () => {
    let tempDir: string;

    beforeEach(() => { tempDir = createTempDir(); });
    afterEach(() => { rmrf(tempDir); });

    it('should decrypt the private key with the owner private key', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        const generated = generateGuildIdentity(tempDir, ownerPubBase64);
        const full = loadGuildFullIdentity(tempDir, owner.privateKey);

        expect(full).not.toBeNull();
        expect(full!.fingerprint).toBe(generated.fingerprint);
        expect(full!.privateKey).toBeDefined();
        expect(full!.privateKey.type).toBe('private');
        expect(full!.privateKey.asymmetricKeyType).toBe('ed25519');
    });

    it('should recover a functional private key that can sign and verify', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        generateGuildIdentity(tempDir, ownerPubBase64);
        const full = loadGuildFullIdentity(tempDir, owner.privateKey);

        expect(full).not.toBeNull();

        // Sign a test message with the recovered private key
        const testData = Buffer.from('guild-identity-test-message');
        const signature = crypto.sign(undefined, testData, full!.privateKey);

        // Verify with the public key
        const valid = crypto.verify(undefined, testData, full!.publicKey, signature);
        expect(valid).toBe(true);
    });

    it('should recover the same public key from decrypted private key', () => {
        const owner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        const generated = generateGuildIdentity(tempDir, ownerPubBase64);
        const full = loadGuildFullIdentity(tempDir, owner.privateKey);

        expect(full).not.toBeNull();

        // Derive public key from the recovered private key and compare
        const derivedPub = crypto.createPublicKey(full!.privateKey);
        const derivedPem = derivedPub.export({ type: 'spki', format: 'pem' });
        const originalPem = generated.publicKey.export({ type: 'spki', format: 'pem' });
        expect(derivedPem).toEqual(originalPem);
    });

    it('should fail to decrypt with the wrong owner key', () => {
        const owner = generateOwnerKeypair();
        const wrongOwner = generateOwnerKeypair();
        const ownerPubBase64 = ownerPubKeyToBase64(owner.publicKey);

        generateGuildIdentity(tempDir, ownerPubBase64);

        // Try decrypting with the wrong owner's private key — should return null
        const result = loadGuildFullIdentity(tempDir, wrongOwner.privateKey);
        expect(result).toBeNull();
    });

    it('should return null when trying to load full identity from non-existent directory', () => {
        const owner = generateOwnerKeypair();
        const result = loadGuildFullIdentity(path.join(tempDir, 'nonexistent'), owner.privateKey);
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 7. Integration with initializeGuildBundle
// ---------------------------------------------------------------------------
describe('Guild Identity — initializeGuildBundle Integration', () => {
    const guildId = `gi-integ-${Date.now()}`;
    let ownerKeypair: ReturnType<typeof generateOwnerKeypair>;
    let ownerPubBase64: string;

    beforeEach(async () => {
        ownerKeypair = generateOwnerKeypair();
        ownerPubBase64 = ownerPubKeyToBase64(ownerKeypair.publicKey);

        // Ensure tables exist
        await new Promise<void>((resolve) => {
            dbManager.initNodeDb(dbManager.nodeDb);
            dbManager.nodeDb.get('SELECT 1', () => resolve());
        });

        // Insert test account with the real owner public key
        await dbManager.runNodeQuery(
            `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['gi-integ-owner', 'gi-integ@test.com', 'salt:hash', ownerPubBase64, 'epk', 's', 'iv']
        );
    });

    afterEach(async () => {
        try { dbManager.unloadGuildInstance(guildId); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 100)); // Let SQLite release file locks
        await dbManager.runNodeQuery(`DELETE FROM guilds WHERE id = ?`, [guildId]);
        await dbManager.runNodeQuery(`DELETE FROM accounts WHERE id = 'gi-integ-owner'`);

        // Clean up the guild directory on disk
        const { GUILDS_DIR } = await import('../database');
        const guildDir = path.join(GUILDS_DIR, guildId);
        try { rmrf(guildDir); } catch { /* ignore EBUSY on Windows */ }
    });

    it('should generate guild identity and store fingerprint in registry', async () => {
        await dbManager.initializeGuildBundle(
            guildId, 'Identity Test Guild', '', 'gi-integ-owner', '', ownerPubBase64
        );

        // Wait for async operations
        await new Promise((r) => setTimeout(r, 300));

        // Verify registry entry has a real fingerprint
        const entry = await dbManager.getGuildRegistryEntry(guildId);
        expect(entry).toBeDefined();
        expect(entry!.fingerprint).toBeTruthy();
        expect(entry!.fingerprint).toHaveLength(32);
        expect(/^[0-9a-f]{32}$/.test(entry!.fingerprint)).toBe(true);
    });

    it('should create guild_identity.key file in guild directory', async () => {
        const { GUILDS_DIR } = await import('../database');

        await dbManager.initializeGuildBundle(
            guildId, 'Identity File Guild', '', 'gi-integ-owner', '', ownerPubBase64
        );

        await new Promise((r) => setTimeout(r, 300));

        const identityPath = path.join(GUILDS_DIR, guildId, 'guild_identity.key');
        expect(fs.existsSync(identityPath)).toBe(true);

        // Verify it's valid JSON with expected fields
        const data: GuildIdentityFile = JSON.parse(fs.readFileSync(identityPath, 'utf-8'));
        expect(data.version).toBe(1);
        expect(data.algorithm).toBe('ed25519');
    });

    it('should produce a fingerprint matching the identity file', async () => {
        const { GUILDS_DIR } = await import('../database');

        await dbManager.initializeGuildBundle(
            guildId, 'Fingerprint Match Guild', '', 'gi-integ-owner', '', ownerPubBase64
        );

        await new Promise((r) => setTimeout(r, 300));

        // Load the identity from disk
        const guildDir = path.join(GUILDS_DIR, guildId);
        const loaded = loadGuildPublicIdentity(guildDir);
        expect(loaded).not.toBeNull();

        // Verify it matches the registry
        const entry = await dbManager.getGuildRegistryEntry(guildId);
        expect(entry!.fingerprint).toBe(loaded!.fingerprint);
    });

    it('should not generate identity when no owner public key is provided', async () => {
        const noKeyGuildId = `gi-nokey-${Date.now()}`;
        const { GUILDS_DIR } = await import('../database');

        await dbManager.initializeGuildBundle(
            noKeyGuildId, 'No Key Guild', '', 'gi-integ-owner', ''
        );

        await new Promise((r) => setTimeout(r, 300));

        const identityPath = path.join(GUILDS_DIR, noKeyGuildId, 'guild_identity.key');
        expect(fs.existsSync(identityPath)).toBe(false);

        // Registry should still exist but with empty fingerprint
        const entry = await dbManager.getGuildRegistryEntry(noKeyGuildId);
        expect(entry).toBeDefined();
        expect(entry!.fingerprint).toBe('');

        // Clean up
        try { dbManager.unloadGuildInstance(noKeyGuildId); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 100));
        await dbManager.runNodeQuery(`DELETE FROM guilds WHERE id = ?`, [noKeyGuildId]);
        try { rmrf(path.join(GUILDS_DIR, noKeyGuildId)); } catch { /* ignore EBUSY on Windows */ }
    });
});
