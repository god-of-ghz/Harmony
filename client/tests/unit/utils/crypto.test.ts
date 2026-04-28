import { describe, it, expect, beforeEach } from 'vitest';
import { 
    generateIdentity, 
    deriveSharedKey, 
    encryptMessageContent, 
    decryptMessageContent,
    importPublicKey,
    exportPublicKey
} from '../../../src/utils/crypto';

describe('Harmony E2EE Cryptography', () => {
    let aliceIdentity: { publicKey: CryptoKey; privateKey: CryptoKey };
    let bobIdentity: { publicKey: CryptoKey; privateKey: CryptoKey };

    beforeEach(async () => {
        aliceIdentity = await generateIdentity();
        bobIdentity = await generateIdentity();
    });

    it('should derive the same shared key for Alice and Bob', async () => {
        const alicePubBase64 = await exportPublicKey(aliceIdentity.publicKey);
        const bobPubBase64 = await exportPublicKey(bobIdentity.publicKey);

        const aliceDerivedKey = await deriveSharedKey(aliceIdentity.privateKey, bobPubBase64);
        const bobDerivedKey = await deriveSharedKey(bobIdentity.privateKey, alicePubBase64);

        // We can't directly compare CryptoKey objects for equality easily, 
        // but we can test if they encrypt/decrypt consistently.
        const plaintext = "Hello Harmony!";
        const ciphertext = await encryptMessageContent(plaintext, aliceDerivedKey);
        const decrypted = await decryptMessageContent(ciphertext, bobDerivedKey);

        expect(decrypted).toBe(plaintext);
    });

    it('should fail to decrypt with an incorrect key', async () => {
        const alicePubBase64 = await exportPublicKey(aliceIdentity.publicKey);
        const malloryIdentity = await generateIdentity();
        const malloryPubBase64 = await exportPublicKey(malloryIdentity.publicKey);

        const aliceDerivedKey = await deriveSharedKey(aliceIdentity.privateKey, malloryPubBase64);
        const bobDerivedKey = await deriveSharedKey(bobIdentity.privateKey, alicePubBase64);

        const plaintext = "Secret message";
        const ciphertext = await encryptMessageContent(plaintext, aliceDerivedKey);

        // Bob tries to decrypt with his key derived from Alice (but Alice used Mallory's pubkey)
        await expect(decryptMessageContent(ciphertext, bobDerivedKey)).rejects.toThrow();
    });

    it('should handle ECDSA to ECDH conversion internally', async () => {
        // Our generateIdentity produces ECDSA keys. 
        // deriveSharedKey should handle the conversion to ECDH.
        const alicePubBase64 = await exportPublicKey(aliceIdentity.publicKey);
        const bobDerivedKey = await deriveSharedKey(bobIdentity.privateKey, alicePubBase64);

        expect(bobDerivedKey.algorithm.name).toBe('AES-GCM');
    });
});
