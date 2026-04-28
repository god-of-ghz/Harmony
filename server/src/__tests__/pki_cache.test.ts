/**
 * PublicKeyCache.clearUrl — Unit Tests
 *
 * Validates the new clearUrl method on PublicKeyCache used to invalidate
 * stale cached public keys during federation promote/demote transitions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { _remoteKeyCache } from '../crypto/pki';

describe('PublicKeyCache.clearUrl', () => {
    const { publicKey: key1 } = crypto.generateKeyPairSync('ed25519');
    const { publicKey: key2 } = crypto.generateKeyPairSync('ed25519');

    beforeEach(() => {
        _remoteKeyCache._clear();
    });

    it('1. clearUrl removes a specific cached entry', () => {
        _remoteKeyCache.set('http://localhost:3001', key1);
        _remoteKeyCache.set('http://localhost:3002', key2);

        // Both should be cached
        expect(_remoteKeyCache.get('http://localhost:3001')).not.toBeNull();
        expect(_remoteKeyCache.get('http://localhost:3002')).not.toBeNull();

        // Clear only 3001
        _remoteKeyCache.clearUrl('http://localhost:3001');

        // 3001 should be gone, 3002 should remain
        expect(_remoteKeyCache.get('http://localhost:3001')).toBeNull();
        expect(_remoteKeyCache.get('http://localhost:3002')).not.toBeNull();
    });

    it('2. clearUrl is a no-op for non-existent URLs', () => {
        _remoteKeyCache.set('http://localhost:3001', key1);

        // Should not throw
        _remoteKeyCache.clearUrl('http://nonexistent:9999');

        // Original entry should be unaffected
        expect(_remoteKeyCache.get('http://localhost:3001')).not.toBeNull();
    });

    it('3. cache returns null after clearUrl, forcing a re-fetch', () => {
        _remoteKeyCache.set('http://localhost:3001', key1);

        // Verify it's cached
        const cached = _remoteKeyCache.get('http://localhost:3001');
        expect(cached).not.toBeNull();

        // Clear it
        _remoteKeyCache.clearUrl('http://localhost:3001');

        // Now get should return null (forcing fetchRemotePublicKey to re-fetch)
        const afterClear = _remoteKeyCache.get('http://localhost:3001');
        expect(afterClear).toBeNull();
    });

    it('4. re-adding a URL after clearUrl works correctly', () => {
        _remoteKeyCache.set('http://localhost:3001', key1);
        _remoteKeyCache.clearUrl('http://localhost:3001');

        // Re-add with a different key
        _remoteKeyCache.set('http://localhost:3001', key2);

        const recached = _remoteKeyCache.get('http://localhost:3001');
        expect(recached).not.toBeNull();

        // Verify it's the new key (key2), not the old one (key1)
        const pem1 = key1.export({ type: 'spki', format: 'pem' }) as string;
        const pem2 = key2.export({ type: 'spki', format: 'pem' }) as string;
        const cachedPem = recached!.export({ type: 'spki', format: 'pem' }) as string;

        expect(cachedPem).toBe(pem2);
        expect(cachedPem).not.toBe(pem1);
    });
});
