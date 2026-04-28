import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { fetchRemotePublicKey, _remoteKeyCache, getServerIdentity, _resetCachedIdentity, initializeServerIdentity } from '../pki';
import path from 'path';
import fs from 'fs';

global.fetch = vi.fn();

describe('Dynamic Remote Key Fetching (Phase 1)', () => {
    let mockDataDir: string;

    beforeEach(() => {
        mockDataDir = path.join(__dirname, 'mock_data_' + Date.now());
        if (!fs.existsSync(mockDataDir)) {
            fs.mkdirSync(mockDataDir, { recursive: true });
        }
        _remoteKeyCache._clear();
        vi.clearAllMocks();
        _resetCachedIdentity();
        initializeServerIdentity(mockDataDir);
    });

    afterEach(() => {
        if (fs.existsSync(mockDataDir)) {
            fs.rmSync(mockDataDir, { recursive: true, force: true });
        }
    });

    it('should successfully fetch, parse, and cache a valid remote public key', async () => {
        const identity = getServerIdentity();
        const base64Der = identity.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
        
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ public_key: base64Der })
        });

        const issuerUrl = 'http://remote-server.test';
        const fetchedKey = await fetchRemotePublicKey(issuerUrl);

        expect(fetchedKey).toBeDefined();
        
        const fetchedKeyPem = fetchedKey.export({ type: 'spki', format: 'pem' });
        const localKeyPem = identity.publicKey.export({ type: 'spki', format: 'pem' });
        expect(fetchedKeyPem).toEqual(localKeyPem);

        // Fetching again should hit the cache, not `fetch`
        const cachedKey = await fetchRemotePublicKey(issuerUrl);
        expect(cachedKey).toBeDefined();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw an error if the remote server response is an error', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 404
        });
        
        await expect(fetchRemotePublicKey('http://error-server.test')).rejects.toThrow('HTTP error fetching public key from http://error-server.test: 404');
    });

    it('should throw an error if JSON response misses public_key field', async () => {
        (global.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ wrong_field: '123' })
        });
        
        await expect(fetchRemotePublicKey('http://bad-server.test')).rejects.toThrow('Invalid response missing public_key from http://bad-server.test');
    });
});
