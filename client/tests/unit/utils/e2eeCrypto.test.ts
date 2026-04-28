/**
 * E2EE (End-to-End Encryption) tests for Harmony's DM crypto layer.
 *
 * Tests the pure cryptographic functions from utils/crypto.ts:
 *   - Key derivation (PBKDF2 → serverAuth + clientWrap)
 *   - Identity keypair generation & export
 *   - Private key encrypt/decrypt (AES-GCM wrap)
 *   - Message encrypt/decrypt (AES-GCM per-message)
 *   - Shared key derivation (ECDH between two identities)
 *   - Signature creation & verification (ECDSA)
 *
 * The keyStore module relies on IndexedDB (polyfilled via fake-indexeddb/auto
 * in setupTests.tsx) so those tests also run in Vitest's jsdom environment.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    generateSalt,
    deriveAuthKeys,
    generateIdentity,
    exportPublicKey,
    encryptPrivateKey,
    decryptPrivateKey,
    signPayload,
    verifySignature,
    deriveSharedKey,
    encryptMessageContent,
    decryptMessageContent,
    ITERATIONS,
} from '../../../src/utils/crypto';
import { saveSessionKey, loadSessionKey, clearSessionKey } from '../../../src/utils/keyStore';

// ─────────────────────────────────────────────────────────────
// Key Derivation (PBKDF2)
// ─────────────────────────────────────────────────────────────
describe('Key Derivation (PBKDF2)', () => {
    it('produces consistent output for the same password and salt', async () => {
        const salt = await generateSalt();
        const result1 = await deriveAuthKeys('password123', salt);
        const result2 = await deriveAuthKeys('password123', salt);

        expect(result1.serverAuthKey).toBe(result2.serverAuthKey);
    });

    it('produces different output for different passwords', async () => {
        const salt = await generateSalt();
        const r1 = await deriveAuthKeys('password1', salt);
        const r2 = await deriveAuthKeys('password2', salt);

        expect(r1.serverAuthKey).not.toBe(r2.serverAuthKey);
    });

    it('produces different output for different salts', async () => {
        const salt1 = await generateSalt();
        const salt2 = await generateSalt();
        const r1 = await deriveAuthKeys('same-password', salt1);
        const r2 = await deriveAuthKeys('same-password', salt2);

        expect(r1.serverAuthKey).not.toBe(r2.serverAuthKey);
    });

    it('returns a serverAuthKey as base64 and a CryptoKey', async () => {
        const salt = await generateSalt();
        const { serverAuthKey, clientWrapKey } = await deriveAuthKeys('pw', salt);

        // serverAuthKey is base64
        expect(typeof serverAuthKey).toBe('string');
        expect(serverAuthKey.length).toBeGreaterThan(0);

        // clientWrapKey is a CryptoKey
        expect(clientWrapKey).toHaveProperty('algorithm');
        expect((clientWrapKey as CryptoKey).algorithm.name).toBe('AES-GCM');
    });

    it('exports ITERATIONS constant correctly', () => {
        expect(ITERATIONS).toBe(600_000);
    });
});

// ─────────────────────────────────────────────────────────────
// Identity Keypair
// ─────────────────────────────────────────────────────────────
describe('Identity Keypair (ECDSA P-256)', () => {
    it('generates a valid keypair', async () => {
        const kp = await generateIdentity();
        expect(kp.publicKey).toBeDefined();
        expect(kp.privateKey).toBeDefined();
        expect(kp.publicKey.algorithm.name).toBe('ECDSA');
        expect(kp.privateKey.algorithm.name).toBe('ECDSA');
    });

    it('exports public key to non-empty base64', async () => {
        const kp = await generateIdentity();
        const pub = await exportPublicKey(kp.publicKey);
        expect(typeof pub).toBe('string');
        expect(pub.length).toBeGreaterThan(10);
    });

    it('exports different public keys for different keypairs', async () => {
        const kp1 = await generateIdentity();
        const kp2 = await generateIdentity();
        const pub1 = await exportPublicKey(kp1.publicKey);
        const pub2 = await exportPublicKey(kp2.publicKey);

        expect(pub1).not.toBe(pub2);
    });
});

// ─────────────────────────────────────────────────────────────
// Private Key Encrypt / Decrypt (AES-GCM wrap)
// ─────────────────────────────────────────────────────────────
describe('Private Key Encrypt / Decrypt', () => {
    it('round-trips a private key through encrypt then decrypt', async () => {
        const salt = await generateSalt();
        const { clientWrapKey } = await deriveAuthKeys('wrap-password', salt);
        const { privateKey, publicKey } = await generateIdentity();

        const { encryptedKey, iv } = await encryptPrivateKey(privateKey, clientWrapKey);
        expect(typeof encryptedKey).toBe('string');
        expect(typeof iv).toBe('string');

        // Decrypt it back
        const recovered = await decryptPrivateKey(encryptedKey, iv, clientWrapKey);
        expect(recovered.algorithm.name).toBe('ECDSA');

        // Verify the recovered key can still sign and the original public key can verify
        const sig = await signPayload('test-data', recovered);
        const ok = await verifySignature('test-data', sig, publicKey);
        expect(ok).toBe(true);
    });

    it('decryption with wrong key fails', async () => {
        const salt1 = await generateSalt();
        const salt2 = await generateSalt();
        const { clientWrapKey: correctKey } = await deriveAuthKeys('password', salt1);
        const { clientWrapKey: wrongKey } = await deriveAuthKeys('wrong-password', salt2);
        const { privateKey } = await generateIdentity();

        const { encryptedKey, iv } = await encryptPrivateKey(privateKey, correctKey);

        // Attempting to decrypt with the wrong key should throw
        await expect(decryptPrivateKey(encryptedKey, iv, wrongKey)).rejects.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────
// Message Encryption / Decryption (AES-GCM per-message)
// ─────────────────────────────────────────────────────────────
describe('Message Encrypt / Decrypt (AES-GCM)', () => {
    let aesKey: CryptoKey;

    beforeEach(async () => {
        // Create two identities and derive a shared ECDH key
        const alice = await generateIdentity();
        const bob = await generateIdentity();
        const bobPub = await exportPublicKey(bob.publicKey);
        aesKey = await deriveSharedKey(alice.privateKey, bobPub);
    });

    it('encryption produces output different from plaintext', async () => {
        const plaintext = 'Hello, World!';
        const ciphertext = await encryptMessageContent(plaintext, aesKey);

        expect(ciphertext).not.toBe(plaintext);
        expect(ciphertext).toContain(':'); // iv:ciphertext format
    });

    it('decryption with correct key recovers original plaintext', async () => {
        const plaintext = 'Top secret message 🔐';
        const ciphertext = await encryptMessageContent(plaintext, aesKey);
        const recovered = await decryptMessageContent(ciphertext, aesKey);

        expect(recovered).toBe(plaintext);
    });

    it('encrypting the same plaintext twice produces different ciphertexts (random IV)', async () => {
        const plaintext = 'Same message';
        const ct1 = await encryptMessageContent(plaintext, aesKey);
        const ct2 = await encryptMessageContent(plaintext, aesKey);

        expect(ct1).not.toBe(ct2);
    });

    it('decryption with wrong key fails gracefully', async () => {
        const charlie = await generateIdentity();
        const dave = await generateIdentity();
        const davePub = await exportPublicKey(dave.publicKey);
        const wrongKey = await deriveSharedKey(charlie.privateKey, davePub);

        const ciphertext = await encryptMessageContent('secret', aesKey);

        await expect(decryptMessageContent(ciphertext, wrongKey)).rejects.toThrow();
    });

    it('rejects malformed ciphertext (missing colon separator)', async () => {
        await expect(
            decryptMessageContent('noColonHere', aesKey)
        ).rejects.toThrow('Invalid encrypted message format');
    });

    it('handles empty string gracefully', async () => {
        const ct = await encryptMessageContent('', aesKey);
        const recovered = await decryptMessageContent(ct, aesKey);
        expect(recovered).toBe('');
    });

    it('handles unicode and emoji', async () => {
        const msg = '你好世界 🌍🎉 مرحبا';
        const ct = await encryptMessageContent(msg, aesKey);
        const recovered = await decryptMessageContent(ct, aesKey);
        expect(recovered).toBe(msg);
    });

    it('handles long messages', async () => {
        const longMsg = 'A'.repeat(10000);
        const ct = await encryptMessageContent(longMsg, aesKey);
        const recovered = await decryptMessageContent(ct, aesKey);
        expect(recovered).toBe(longMsg);
    });
});

// ─────────────────────────────────────────────────────────────
// Shared Key Derivation (ECDH)
// ─────────────────────────────────────────────────────────────
describe('Shared Key Derivation (ECDH)', () => {
    it('two parties derive the same shared key', async () => {
        const alice = await generateIdentity();
        const bob = await generateIdentity();

        const alicePub = await exportPublicKey(alice.publicKey);
        const bobPub = await exportPublicKey(bob.publicKey);

        const sharedFromAlice = await deriveSharedKey(alice.privateKey, bobPub);
        const sharedFromBob = await deriveSharedKey(bob.privateKey, alicePub);

        // Verify by encrypting with one and decrypting with the other
        const ct = await encryptMessageContent('shared-secret-test', sharedFromAlice);
        const recovered = await decryptMessageContent(ct, sharedFromBob);
        expect(recovered).toBe('shared-secret-test');
    });

    it('different pairs produce different shared keys', async () => {
        const alice = await generateIdentity();
        const bob = await generateIdentity();
        const charlie = await generateIdentity();

        const bobPub = await exportPublicKey(bob.publicKey);
        const charliePub = await exportPublicKey(charlie.publicKey);

        const keyAB = await deriveSharedKey(alice.privateKey, bobPub);
        const keyAC = await deriveSharedKey(alice.privateKey, charliePub);

        // Encrypt with AB, should not decrypt with AC
        const ct = await encryptMessageContent('for-bob', keyAB);
        await expect(decryptMessageContent(ct, keyAC)).rejects.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────
// Signing & Verification (ECDSA)
// ─────────────────────────────────────────────────────────────
describe('Signing & Verification (ECDSA)', () => {
    it('verifies a valid signature', async () => {
        const { privateKey, publicKey } = await generateIdentity();
        const message = 'authenticate-me';
        const sig = await signPayload(message, privateKey);
        const valid = await verifySignature(message, sig, publicKey);
        expect(valid).toBe(true);
    });

    it('rejects when message is tampered', async () => {
        const { privateKey, publicKey } = await generateIdentity();
        const sig = await signPayload('original', privateKey);
        const valid = await verifySignature('tampered', sig, publicKey);
        expect(valid).toBe(false);
    });

    it('rejects when wrong public key is used', async () => {
        const alice = await generateIdentity();
        const bob = await generateIdentity();
        const sig = await signPayload('message', alice.privateKey);
        const valid = await verifySignature('message', sig, bob.publicKey);
        expect(valid).toBe(false);
    });

    it('signature is non-empty base64 string', async () => {
        const { privateKey } = await generateIdentity();
        const sig = await signPayload('data', privateKey);
        expect(typeof sig).toBe('string');
        expect(sig.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────
// IndexedDB KeyStore
// ─────────────────────────────────────────────────────────────
describe('IndexedDB KeyStore', () => {
    beforeEach(async () => {
        await clearSessionKey();
    });

    it('returns null when no key is stored', async () => {
        const key = await loadSessionKey();
        expect(key).toBeNull();
    });

    it('round-trips a CryptoKey through save and load', async () => {
        const { privateKey, publicKey } = await generateIdentity();
        await saveSessionKey(privateKey);

        const loaded = await loadSessionKey();
        expect(loaded).not.toBeNull();

        // Verify the loaded key can still sign
        const sig = await signPayload('idb-test', loaded as CryptoKey);
        const ok = await verifySignature('idb-test', sig, publicKey);
        expect(ok).toBe(true);
    });

    it('clearSessionKey removes the stored key', async () => {
        const { privateKey } = await generateIdentity();
        await saveSessionKey(privateKey);

        // Verify it's stored
        expect(await loadSessionKey()).not.toBeNull();

        // Clear
        await clearSessionKey();
        expect(await loadSessionKey()).toBeNull();
    });

    it('overwriting a key replaces the previous one', async () => {
        const kp1 = await generateIdentity();
        const kp2 = await generateIdentity();

        await saveSessionKey(kp1.privateKey);
        await saveSessionKey(kp2.privateKey); // Overwrite

        const loaded = await loadSessionKey();
        // The loaded key should be kp2's private key, not kp1's
        const sig = await signPayload('overwrite-test', loaded as CryptoKey);
        const ok1 = await verifySignature('overwrite-test', sig, kp1.publicKey);
        const ok2 = await verifySignature('overwrite-test', sig, kp2.publicKey);

        expect(ok1).toBe(false);
        expect(ok2).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────
// Salt Generation
// ─────────────────────────────────────────────────────────────
describe('Salt Generation', () => {
    it('produces base64-encoded salt', async () => {
        const salt = await generateSalt();
        expect(typeof salt).toBe('string');
        expect(salt.length).toBeGreaterThan(0);
    });

    it('produces different salts on each call', async () => {
        const s1 = await generateSalt();
        const s2 = await generateSalt();
        expect(s1).not.toBe(s2);
    });
});
