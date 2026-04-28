import { beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { initializeServerIdentity, _resetCachedIdentity } from '../src/crypto/pki';

const testPkiId = crypto.randomUUID();
let testPkiDir = path.join(__dirname, '.tmp', `test_pki_${testPkiId}`);

if (!fs.existsSync(testPkiDir)) {
    fs.mkdirSync(testPkiDir, { recursive: true });
}

_resetCachedIdentity();
initializeServerIdentity(testPkiDir);

// Clean up after the test block to prevent disk space bloat
afterAll(() => {
    try {
        if (testPkiDir && fs.existsSync(testPkiDir)) {
            fs.rmSync(testPkiDir, { recursive: true, force: true });
        }
    } catch (e) {
        console.error('Failed to clean up test PKI dir', e);
    }
});
