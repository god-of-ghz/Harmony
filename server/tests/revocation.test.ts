import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
    generateRevocationCode,
    hashRevocationCode,
    validateRevocationCode,
    createRevocationPayload,
    verifyRevocationSignature,
} from '../src/crypto/revocation';

describe('Revocation System — CRL Kill Switch', () => {
    // Generate a test Ed25519 keypair once for the suite
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

    describe('generateRevocationCode()', () => {
        it('should produce a 64-character hex string (32 bytes)', () => {
            const code = generateRevocationCode();
            expect(code).toMatch(/^[0-9a-f]{64}$/);
        });

        it('should produce unique codes on each call', () => {
            const code1 = generateRevocationCode();
            const code2 = generateRevocationCode();
            expect(code1).not.toBe(code2);
        });
    });

    describe('hashRevocationCode()', () => {
        it('should produce a 64-character hex string (SHA-256)', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('should produce deterministic output for the same code', () => {
            const code = generateRevocationCode();
            const hash1 = hashRevocationCode(code);
            const hash2 = hashRevocationCode(code);
            expect(hash1).toBe(hash2);
        });
    });

    describe('validateRevocationCode()', () => {
        it('should return true for a valid code matching its hash', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);
            expect(validateRevocationCode(code, hash)).toBe(true);
        });

        it('should return false for an incorrect code', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);
            const wrongCode = generateRevocationCode(); // Different random code
            expect(validateRevocationCode(wrongCode, hash)).toBe(false);
        });

        it('should return false for a partial/truncated code', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);
            const partial = code.substring(0, 32); // Only half the code
            expect(validateRevocationCode(partial, hash)).toBe(false);
        });

        it('should return false for an empty code', () => {
            const hash = hashRevocationCode(generateRevocationCode());
            expect(validateRevocationCode('', hash)).toBe(false);
        });

        it('should return false for an empty hash', () => {
            const code = generateRevocationCode();
            expect(validateRevocationCode(code, '')).toBe(false);
        });

        it('should return false for non-hex garbage input', () => {
            const hash = hashRevocationCode(generateRevocationCode());
            expect(validateRevocationCode('not-a-valid-hex-string!@#$', hash)).toBe(false);
        });

        it('should reject uppercase hex even though regex accepts it (hash mismatch)', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);
            const upperCode = code.toUpperCase();
            // The regex accepts uppercase, but the hash of uppercase differs from lowercase
            // This is correct security behavior — exact code reproduction required
            expect(validateRevocationCode(upperCode, hash)).toBe(false);
        });
    });

    describe('createRevocationPayload()', () => {
        it('should produce a valid signed payload with a correct revocation code', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);

            const result = createRevocationPayload(privateKey, publicKeyPem, code, hash);

            expect(result.payload.action).toBe('REVOKE_IDENTITY');
            expect(result.payload.publicKey).toBe(publicKeyPem);
            expect(result.payload.timestamp).toBeTruthy();
            expect(result.payload.nonce).toMatch(/^[0-9a-f]{32}$/);
            expect(result.payload.codeHash).toBe(hash);
            expect(result.signature).toBeTruthy();
        });

        it('should throw for an invalid revocation code', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);
            const wrongCode = generateRevocationCode();

            expect(() => createRevocationPayload(privateKey, publicKeyPem, wrongCode, hash))
                .toThrow('Invalid revocation code');
        });

        it('should throw for a partial revocation code', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);

            expect(() => createRevocationPayload(privateKey, publicKeyPem, code.substring(0, 32), hash))
                .toThrow('Invalid revocation code');
        });

        it('should throw for an empty revocation code', () => {
            const hash = hashRevocationCode(generateRevocationCode());

            expect(() => createRevocationPayload(privateKey, publicKeyPem, '', hash))
                .toThrow('Invalid revocation code');
        });

        it('should produce a payload whose signature is mathematically verifiable', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);

            const result = createRevocationPayload(privateKey, publicKeyPem, code, hash);

            // Verify the Ed25519 signature directly
            const payloadString = JSON.stringify(result.payload);
            const signatureBuffer = Buffer.from(result.signature, 'base64');

            const isValid = crypto.verify(null, Buffer.from(payloadString), publicKey, signatureBuffer);
            expect(isValid).toBe(true);
        });

        it('should produce a payload that fails verification with a different key', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);

            const result = createRevocationPayload(privateKey, publicKeyPem, code, hash);

            // Generate a different keypair
            const { publicKey: otherPub } = crypto.generateKeyPairSync('ed25519');

            const payloadString = JSON.stringify(result.payload);
            const signatureBuffer = Buffer.from(result.signature, 'base64');

            const isValid = crypto.verify(null, Buffer.from(payloadString), otherPub, signatureBuffer);
            expect(isValid).toBe(false);
        });
    });

    describe('verifyRevocationSignature()', () => {
        it('should return true for a valid signed revocation', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);
            const result = createRevocationPayload(privateKey, publicKeyPem, code, hash);

            expect(verifyRevocationSignature(result, publicKeyPem)).toBe(true);
        });

        it('should return false for a tampered payload', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);
            const result = createRevocationPayload(privateKey, publicKeyPem, code, hash);

            // Tamper with the payload
            result.payload.timestamp = '2099-01-01T00:00:00.000Z';

            expect(verifyRevocationSignature(result, publicKeyPem)).toBe(false);
        });

        it('should return false for a mismatched public key', () => {
            const code = generateRevocationCode();
            const hash = hashRevocationCode(code);
            const result = createRevocationPayload(privateKey, publicKeyPem, code, hash);

            const { publicKey: otherPub } = crypto.generateKeyPairSync('ed25519');
            const otherPem = otherPub.export({ type: 'spki', format: 'pem' }) as string;

            expect(verifyRevocationSignature(result, otherPem)).toBe(false);
        });
    });
});
