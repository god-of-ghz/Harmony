/**
 * Client Message Signature Verification — ECDSA P-256 / SHA-256
 * 
 * Verifies that messages received from clients were genuinely signed by the
 * claimed sender's private key. This prevents database administrators or
 * compromised servers from silently altering historical chat logs.
 * 
 * The client uses Web Crypto API with ECDSA P-256 / SHA-256 for signing.
 * Public keys are stored in SPKI/base64 format in the accounts table.
 * 
 * This module is a pure utility with no coupling to Express or HTTP.
 */

import crypto from 'crypto';

/**
 * Converts a base64-encoded SPKI public key string to a Node.js KeyObject.
 */
export function importPublicKeyFromBase64(publicKeyBase64: string): crypto.KeyObject {
    const derBuffer = Buffer.from(publicKeyBase64, 'base64');
    return crypto.createPublicKey({
        key: derBuffer,
        format: 'der',
        type: 'spki',
    });
}

/**
 * Converts a base64-encoded signature (IEEE P1363 / raw format from Web Crypto)
 * to DER format that Node.js crypto.verify() expects for ECDSA.
 * 
 * Web Crypto API exports ECDSA signatures in IEEE P1363 format (r || s),
 * while Node.js expects ASN.1 DER format. This function performs the conversion.
 */
export function ieeeP1363ToDer(signatureBase64: string): Buffer {
    const raw = Buffer.from(signatureBase64, 'base64');

    // P-256 signatures are 64 bytes: 32 bytes for r, 32 bytes for s
    if (raw.length !== 64) {
        throw new Error(`Invalid P-256 signature length: expected 64 bytes, got ${raw.length}`);
    }

    const r = raw.subarray(0, 32);
    const s = raw.subarray(32, 64);

    // Encode r and s as ASN.1 INTEGERs
    const encodeInteger = (value: Buffer): Buffer => {
        // Strip leading zeros but keep at least one byte
        let start = 0;
        while (start < value.length - 1 && value[start] === 0) start++;
        let trimmed = value.subarray(start);

        // If the high bit is set, prepend a 0x00 byte
        const needsPadding = trimmed[0] & 0x80;
        const len = trimmed.length + (needsPadding ? 1 : 0);

        const result = Buffer.alloc(2 + len);
        result[0] = 0x02; // INTEGER tag
        result[1] = len;
        if (needsPadding) {
            result[2] = 0x00;
            trimmed.copy(result, 3);
        } else {
            trimmed.copy(result, 2);
        }
        return result;
    };

    const rDer = encodeInteger(r);
    const sDer = encodeInteger(s);

    // Wrap in SEQUENCE
    const seqLen = rDer.length + sDer.length;
    const der = Buffer.alloc(2 + seqLen);
    der[0] = 0x30; // SEQUENCE tag
    der[1] = seqLen;
    rDer.copy(der, 2);
    sDer.copy(der, 2 + rDer.length);

    return der;
}

/**
 * Verifies an ECDSA P-256 / SHA-256 signature against message content.
 * 
 * @param content — The plaintext message content that was signed
 * @param signatureBase64 — The base64-encoded signature (IEEE P1363 format from Web Crypto)
 * @param publicKeyBase64 — The sender's public key in base64-encoded SPKI format
 * 
 * @returns true if the signature is valid, false otherwise
 */
export async function verifyMessageSignature(
    content: string,
    signatureBase64: string,
    publicKeyBase64: string
): Promise<boolean> {
    try {
        if (content == null || !signatureBase64 || !publicKeyBase64) {
            return false;
        }

        const publicKey = importPublicKeyFromBase64(publicKeyBase64);
        const derSignature = ieeeP1363ToDer(signatureBase64);

        const verifier = crypto.createVerify('SHA256');
        verifier.update(content);
        verifier.end();

        return verifier.verify(
            { key: publicKey, dsaEncoding: 'der' },
            derSignature
        );
    } catch {
        return false;
    }
}
