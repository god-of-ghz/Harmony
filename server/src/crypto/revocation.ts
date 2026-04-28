/**
 * Certificate Revocation List (CRL) — Self-Destruct Cryptogram
 * 
 * Provides the cryptographic logic for generating offline revocation codes
 * and creating signed "kill signal" payloads that can invalidate a compromised
 * server identity across the federation network.
 * 
 * This module is a pure utility with no I/O coupling.
 */

import crypto from 'crypto';

/**
 * Generates a cryptographically random 32-byte hex revocation code.
 * This code is shown to the admin ONCE and must be stored offline.
 */
export function generateRevocationCode(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Computes the SHA-256 hash of a revocation code.
 * The hash (not the raw code) is stored on disk for later comparison.
 */
export function hashRevocationCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Validates a candidate revocation code against a stored hash.
 */
export function validateRevocationCode(candidateCode: string, storedHash: string): boolean {
    if (!candidateCode || !storedHash) return false;

    // Basic format validation: must be a 64-char hex string (32 bytes)
    if (!/^[0-9a-f]{64}$/i.test(candidateCode)) return false;

    const candidateHash = hashRevocationCode(candidateCode);

    // Use timing-safe comparison to prevent side-channel attacks
    const candidateBuf = Buffer.from(candidateHash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');

    if (candidateBuf.length !== storedBuf.length) return false;

    return crypto.timingSafeEqual(candidateBuf, storedBuf);
}

export interface RevocationPayload {
    action: 'REVOKE_IDENTITY';
    publicKey: string;
    timestamp: string;
    nonce: string;
    codeHash: string;
}

export interface SignedRevocation {
    payload: RevocationPayload;
    signature: string;
}

/**
 * Creates a mathematically irrefutable "kill signal" payload.
 * 
 * The payload is signed with the server's own private key, proving that
 * the legitimate owner (who possesses both the private key and the offline
 * revocation code) authorized the revocation.
 * 
 * @param privateKey  — The server's Ed25519 private key
 * @param publicKeyPem — The server's public key in PEM format (included in payload)
 * @param revocationCode — The raw offline revocation code
 * @param storedHash — The SHA-256 hash stored on disk during PKI init
 * 
 * @throws If the revocation code is invalid
 * @returns The signed revocation payload
 */
export function createRevocationPayload(
    privateKey: crypto.KeyObject,
    publicKeyPem: string,
    revocationCode: string,
    storedHash: string
): SignedRevocation {
    // Validate the revocation code
    if (!validateRevocationCode(revocationCode, storedHash)) {
        throw new Error('Invalid revocation code. The provided code does not match the stored hash.');
    }

    const payload: RevocationPayload = {
        action: 'REVOKE_IDENTITY',
        publicKey: publicKeyPem,
        timestamp: new Date().toISOString(),
        nonce: crypto.randomBytes(16).toString('hex'),
        codeHash: hashRevocationCode(revocationCode),
    };

    const payloadString = JSON.stringify(payload);

    // Sign with Ed25519 (no hash algorithm needed — Ed25519 includes its own)
    const signature = crypto.sign(null, Buffer.from(payloadString), privateKey);

    return {
        payload,
        signature: signature.toString('base64'),
    };
}

/**
 * Verifies that a revocation payload was signed by the claimed public key.
 * Used by receiving nodes to validate incoming revocation broadcasts.
 */
export function verifyRevocationSignature(
    signedRevocation: SignedRevocation,
    publicKeyPem: string
): boolean {
    try {
        const payloadString = JSON.stringify(signedRevocation.payload);
        const signatureBuffer = Buffer.from(signedRevocation.signature, 'base64');
        const publicKey = crypto.createPublicKey(publicKeyPem);

        return crypto.verify(null, Buffer.from(payloadString), publicKey, signatureBuffer);
    } catch {
        return false;
    }
}
