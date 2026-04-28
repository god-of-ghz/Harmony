import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
    verifyMessageSignature,
    importPublicKeyFromBase64,
    ieeeP1363ToDer,
} from '../src/crypto/signatures';

/**
 * Helper: Generate an ECDSA P-256 keypair and simulate client-side signing
 * using the same algorithm the Harmony client uses (ECDSA P-256 / SHA-256).
 * 
 * Node.js crypto uses DER encoding by default, but the Web Crypto API
 * uses IEEE P1363 (r||s) format. We generate in IEEE format to match the client.
 */
function generateTestKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
    });

    // Export public key in the same format the client stores (SPKI, base64)
    const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const publicKeyBase64 = publicKeyDer.toString('base64');

    return { publicKey, privateKey, publicKeyBase64 };
}

/**
 * Helper: Sign content in IEEE P1363 format (matching Web Crypto API output)
 */
function signContentP1363(content: string, privateKey: crypto.KeyObject): string {
    const signature = crypto.sign('SHA256', Buffer.from(content), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
    });
    return signature.toString('base64');
}

describe('Client Message Signature Verification — ECDSA P-256', () => {
    const { publicKeyBase64, privateKey } = generateTestKeypair();

    describe('verifyMessageSignature()', () => {
        it('should return true for a valid signature with correct content', async () => {
            const content = 'Hello, Harmony!';
            const signature = signContentP1363(content, privateKey);

            const result = await verifyMessageSignature(content, signature, publicKeyBase64);
            expect(result).toBe(true);
        });

        it('should return false for tampered plaintext content', async () => {
            const originalContent = 'Hello, Harmony!';
            const signature = signContentP1363(originalContent, privateKey);

            const tamperedContent = 'Hello, Hacked World!';
            const result = await verifyMessageSignature(tamperedContent, signature, publicKeyBase64);
            expect(result).toBe(false);
        });

        it('should return false for a mismatched public key', async () => {
            const content = 'Hello, Harmony!';
            const signature = signContentP1363(content, privateKey);

            // Generate a different keypair
            const other = generateTestKeypair();

            const result = await verifyMessageSignature(content, signature, other.publicKeyBase64);
            expect(result).toBe(false);
        });

        it('should return false for an empty signature', async () => {
            const content = 'Hello, Harmony!';
            const result = await verifyMessageSignature(content, '', publicKeyBase64);
            expect(result).toBe(false);
        });

        it('should return false for a malformed/truncated signature', async () => {
            const content = 'Hello, Harmony!';
            const signature = signContentP1363(content, privateKey);

            // Truncate the signature
            const truncated = signature.substring(0, 20);
            const result = await verifyMessageSignature(content, truncated, publicKeyBase64);
            expect(result).toBe(false);
        });

        it('should return false for garbage base64 signature', async () => {
            const content = 'Hello, Harmony!';
            const result = await verifyMessageSignature(content, 'bm90YXNpZ25hdHVyZQ==', publicKeyBase64);
            expect(result).toBe(false);
        });

        it('should return false for empty content', async () => {
            const result = await verifyMessageSignature('', 'sig', publicKeyBase64);
            expect(result).toBe(false);
        });

        it('should return false for empty public key', async () => {
            const content = 'Hello, Harmony!';
            const signature = signContentP1363(content, privateKey);
            const result = await verifyMessageSignature(content, signature, '');
            expect(result).toBe(false);
        });

        it('should return false for invalid public key base64', async () => {
            const content = 'Hello, Harmony!';
            const signature = signContentP1363(content, privateKey);
            const result = await verifyMessageSignature(content, signature, 'not-a-real-key');
            expect(result).toBe(false);
        });

        it('should handle unicode content correctly', async () => {
            const content = '🔐 Encrypted greetings! こんにちは 🗝️';
            const signature = signContentP1363(content, privateKey);

            const result = await verifyMessageSignature(content, signature, publicKeyBase64);
            expect(result).toBe(true);
        });

        it('should handle very long content', async () => {
            const content = 'A'.repeat(10000);
            const signature = signContentP1363(content, privateKey);

            const result = await verifyMessageSignature(content, signature, publicKeyBase64);
            expect(result).toBe(true);
        });

        it('should detect single-character content tampering', async () => {
            const content = 'This is a secret message with important data.';
            const signature = signContentP1363(content, privateKey);

            // Change a single character
            const tampered = 'This is a secret message with important datA.';
            const result = await verifyMessageSignature(tampered, signature, publicKeyBase64);
            expect(result).toBe(false);
        });
    });

    describe('ieeeP1363ToDer()', () => {
        it('should convert a 64-byte signature to DER format', () => {
            const content = 'test';
            const p1363Sig = crypto.sign('SHA256', Buffer.from(content), {
                key: privateKey,
                dsaEncoding: 'ieee-p1363',
            });

            expect(p1363Sig.length).toBe(64);

            const der = ieeeP1363ToDer(p1363Sig.toString('base64'));
            expect(der[0]).toBe(0x30); // SEQUENCE tag
        });

        it('should throw for signatures of incorrect length', () => {
            const badSig = Buffer.alloc(32).toString('base64'); // 32 instead of 64
            expect(() => ieeeP1363ToDer(badSig)).toThrow('Invalid P-256 signature length');
        });
    });

    describe('importPublicKeyFromBase64()', () => {
        it('should successfully import a valid SPKI base64 public key', () => {
            const key = importPublicKeyFromBase64(publicKeyBase64);
            expect(key.type).toBe('public');
            expect(key.asymmetricKeyType).toBe('ec');
        });

        it('should throw for invalid base64 data', () => {
            expect(() => importPublicKeyFromBase64('not-valid-base64-spki-data')).toThrow();
        });
    });
});
