/**
 * CLI: Revoke Server Identity
 * 
 * Usage: tsx src/cli/revoke-identity.ts <revocation-code>
 *    or: npm run revoke -- <revocation-code>
 * 
 * Accepts the offline revocation code generated during initial PKI setup,
 * validates it against the stored hash, and produces a signed "kill signal"
 * payload designed for future network broadcast.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../database';
import { getIdentityPaths, loadServerIdentity } from '../crypto/pki';
import { createRevocationPayload } from '../crypto/revocation';

const revocationCode = process.argv[2];

if (!revocationCode) {
    console.error('Usage: npm run revoke -- <revocation-code>');
    console.error('');
    console.error('The revocation code was displayed when the server identity was first generated.');
    console.error('If you have lost it, the server identity cannot be revoked.');
    process.exit(1);
}

async function main() {
    const { revocationHashPath, publicKeyPath } = getIdentityPaths(DATA_DIR);

    // Verify identity exists
    try {
        loadServerIdentity(DATA_DIR);
    } catch (err: any) {
        console.error(`[REVOKE] Failed to load server identity: ${err.message}`);
        process.exit(1);
    }

    // Verify revocation hash exists
    if (!fs.existsSync(revocationHashPath)) {
        console.error('[REVOKE] No revocation hash found. Was this server initialized with PKI?');
        process.exit(1);
    }

    const storedHash = fs.readFileSync(revocationHashPath, 'utf-8').trim();
    const identity = loadServerIdentity(DATA_DIR);
    const publicKeyPem = fs.readFileSync(publicKeyPath, 'utf-8');

    try {
        const signedRevocation = createRevocationPayload(
            identity.privateKey,
            publicKeyPem,
            revocationCode,
            storedHash
        );

        // Write the signed revocation to disk
        const outputPath = path.join(DATA_DIR, 'revocation_signal.json');
        fs.writeFileSync(outputPath, JSON.stringify(signedRevocation, null, 2));

        console.log('[REVOKE] ✅ Revocation signal generated successfully.');
        console.log(`[REVOKE] Written to: ${outputPath}`);
        console.log('');
        console.log('--- REVOCATION PAYLOAD ---');
        console.log(JSON.stringify(signedRevocation, null, 2));
        console.log('--- END PAYLOAD ---');
        console.log('');
        console.log('Broadcast this payload to all federated nodes to invalidate this identity.');

        process.exit(0);
    } catch (err: any) {
        console.error(`[REVOKE] ❌ Revocation failed: ${err.message}`);
        process.exit(1);
    }
}

main();
