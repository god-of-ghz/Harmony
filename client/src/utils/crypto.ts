export const ITERATIONS = 100_000;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export async function generateSalt(length = 16): Promise<string> {
    const salt = window.crypto.getRandomValues(new Uint8Array(length));
    return arrayBufferToBase64(salt.buffer);
}

export async function getDeterministicSalt(email: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(email.toLowerCase().trim() + "_harmony_pake_v1");
    const hash = await window.crypto.subtle.digest("SHA-256", data);
    return arrayBufferToBase64(hash);
}

export async function generateIdentity() {
    return await window.crypto.subtle.generateKey(
        {
            name: "ECDSA",
            namedCurve: "P-256"
        },
        true, // extractable so we can export and encrypt it
        ["sign", "verify"]
    );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey("spki", key);
    return arrayBufferToBase64(exported);
}

export async function importPublicKey(base64: string): Promise<CryptoKey> {
    const buffer = base64ToArrayBuffer(base64);
    return await window.crypto.subtle.importKey(
        "spki",
        buffer,
        {
            name: "ECDSA",
            namedCurve: "P-256"
        },
        true,
        ["verify"]
    );
}

export async function computeFingerprint(publicKeyString: string): Promise<string> {
    const buffer = base64ToArrayBuffer(publicKeyString);
    const hash = await window.crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hash));
    const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `#${hex.slice(0, 4).toUpperCase()}`;
}

export async function deriveAuthKeys(password: string, saltBase64: string) {
    const encoder = new TextEncoder();
    const passwordKey = await window.crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"]
    );

    const saltBuffer = base64ToArrayBuffer(saltBase64);

    // Derive 512 bits (64 bytes)
    // The first 32 bytes will be the ServerAuthKey (hashed by server)
    // The second 32 bytes will be the ClientWrapKey (used locally for AES-GCM)
    const derivedBits = await window.crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: saltBuffer,
            iterations: ITERATIONS,
            hash: "SHA-256"
        },
        passwordKey,
        512
    );

    const serverAuthBytes = derivedBits.slice(0, 32);
    const clientWrapBytes = derivedBits.slice(32, 64);

    const serverAuthKeyBase64 = arrayBufferToBase64(serverAuthBytes);

    const clientWrapKey = await window.crypto.subtle.importKey(
        "raw",
        clientWrapBytes,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );

    return {
        serverAuthKey: serverAuthKeyBase64,
        clientWrapKey: clientWrapKey
    };
}

export async function encryptPrivateKey(privateKey: CryptoKey, wrapKey: CryptoKey): Promise<{ encryptedKey: string, iv: string }> {
    const exportedPrivateKey = await window.crypto.subtle.exportKey("pkcs8", privateKey);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        wrapKey,
        exportedPrivateKey
    );

    return {
        encryptedKey: arrayBufferToBase64(encrypted),
        iv: arrayBufferToBase64(iv.buffer)
    };
}

export async function decryptPrivateKey(encryptedKeyBase64: string, ivBase64: string, wrapKey: CryptoKey): Promise<CryptoKey> {
    const encryptedBuffer = base64ToArrayBuffer(encryptedKeyBase64);
    const ivBuffer = base64ToArrayBuffer(ivBase64);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: new Uint8Array(ivBuffer)
        },
        wrapKey,
        encryptedBuffer
    );

    return await window.crypto.subtle.importKey(
        "pkcs8",
        decryptedBuffer,
        {
            name: "ECDSA",
            namedCurve: "P-256"
        },
        true,
        ["sign"]
    );
}

export async function signPayload(payload: string, privateKey: CryptoKey): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const signature = await window.crypto.subtle.sign(
        {
            name: "ECDSA",
            hash: { name: "SHA-256" }
        },
        privateKey,
        data
    );
    return arrayBufferToBase64(signature);
}

export async function verifySignature(payload: string, signatureBase64: string, publicKey: CryptoKey): Promise<boolean> {
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(payload);
        const signature = base64ToArrayBuffer(signatureBase64);
        return await window.crypto.subtle.verify(
            {
                name: "ECDSA",
                hash: { name: "SHA-256" }
            },
            publicKey,
            signature,
            data
        );
    } catch (e) {
        return false;
    }
}
