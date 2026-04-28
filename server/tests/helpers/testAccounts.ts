/**
 * Shared test account helpers for Harmony server tests.
 *
 * The system test (system.test.ts) and federated auth test both do full
 * HTTP signup/login flows with identical payload shapes. This module
 * provides the common payloads and helpers to reduce repetition.
 *
 * Usage:
 *   import { createSignupPayload, createLoginPayload, TEST_PASSWORD } from './helpers/testAccounts';
 *
 *   const res = await request(baseUrl)
 *       .post('/api/accounts/signup')
 *       .send(createSignupPayload('test@example.com'));
 */

/**
 * Default test password used across system tests.
 */
export const TEST_PASSWORD = 'password123';

/**
 * Default test email used across system tests.
 */
export const TEST_EMAIL = 'test@system.local';

/**
 * Creates an EC P-256 keypair for test account registration.
 * Returns Base64-encoded public/private keys suitable for the signup payload.
 */
export async function generateTestKeyPair() {
    const { generateKeyPairSync } = await import('crypto');
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });
    return {
        publicKey,
        privateKey,
        publicKeyBase64: publicKey.toString('base64'),
        privateKeyBase64: privateKey.toString('base64'),
    };
}

/**
 * Creates a signup request payload.
 * Matches the shape expected by POST /api/accounts/signup.
 *
 * @param email - Account email (default: TEST_EMAIL)
 * @param publicKeyBase64 - Base64-encoded public key from generateTestKeyPair()
 * @param overrides - Override any field in the payload
 */
export function createSignupPayload(
    email = TEST_EMAIL,
    publicKeyBase64 = 'MOCK_PUBLIC_KEY',
    overrides: Record<string, any> = {},
) {
    return {
        email,
        serverAuthKey: TEST_PASSWORD,
        public_key: publicKeyBase64,
        encrypted_private_key: 'MOCK_ENC_PRIV',
        key_salt: 'salt',
        key_iv: 'iv',
        auth_salt: 'random_auth_salt_a',
        ...overrides,
    };
}

/**
 * Creates a login request payload.
 * Matches the shape expected by POST /api/accounts/login.
 *
 * @param email - Account email (default: TEST_EMAIL)
 * @param password - Password (default: TEST_PASSWORD)
 */
export function createLoginPayload(email = TEST_EMAIL, password = TEST_PASSWORD) {
    return {
        email,
        serverAuthKey: password,
    };
}
