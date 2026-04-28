import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
    initializeServerIdentity,
    loadServerIdentity,
    generateServerIdentity,
    identityExists,
    getServerIdentity,
    getIdentityPaths,
    computePublicKeyFingerprint,
    _resetCachedIdentity,
} from '../src/crypto/pki';

describe('PKI Engine — Server Identity Management', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harmony-pki-test-'));
        _resetCachedIdentity();
    });

    afterEach(() => {
        _resetCachedIdentity();
        // Clean up temp directory
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
        } catch { /* ignore cleanup failures */ }
    });

    describe('generateServerIdentity()', () => {
        it('should generate a valid Ed25519 keypair and write files to disk', () => {
            const identity = generateServerIdentity(testDir);
            const { privateKeyPath, publicKeyPath } = getIdentityPaths(testDir);

            // Files should exist
            expect(fs.existsSync(privateKeyPath)).toBe(true);
            expect(fs.existsSync(publicKeyPath)).toBe(true);

            // Keys should be valid Ed25519
            expect(identity.privateKey.type).toBe('private');
            expect(identity.publicKey.type).toBe('public');
            expect(identity.privateKey.asymmetricKeyType).toBe('ed25519');
            expect(identity.publicKey.asymmetricKeyType).toBe('ed25519');

            // PEM format check
            const privPem = fs.readFileSync(privateKeyPath, 'utf-8');
            const pubPem = fs.readFileSync(publicKeyPath, 'utf-8');
            expect(privPem).toContain('BEGIN PRIVATE KEY');
            expect(pubPem).toContain('BEGIN PUBLIC KEY');
        });

        it('should generate and store the revocation hash (not the raw code)', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            generateServerIdentity(testDir);
            const { revocationHashPath } = getIdentityPaths(testDir);

            // Hash file should exist
            expect(fs.existsSync(revocationHashPath)).toBe(true);

            // Hash should be a 64-char hex string (SHA-256)
            const storedHash = fs.readFileSync(revocationHashPath, 'utf-8');
            expect(storedHash).toMatch(/^[0-9a-f]{64}$/);

            // The raw revocation code should have been logged
            const logCalls = consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
            expect(logCalls).toContain('REVOCATION CODE:');

            consoleSpy.mockRestore();
        });

        it('should create the data directory if it does not exist', () => {
            const nestedDir = path.join(testDir, 'deep', 'nested', 'dir');
            expect(fs.existsSync(nestedDir)).toBe(false);

            generateServerIdentity(nestedDir);

            expect(fs.existsSync(nestedDir)).toBe(true);
            expect(identityExists(nestedDir)).toBe(true);
        });
    });

    describe('loadServerIdentity()', () => {
        it('should load an existing keypair from disk', () => {
            // First generate
            const original = generateServerIdentity(testDir);

            // Then load
            _resetCachedIdentity();
            const loaded = loadServerIdentity(testDir);

            // Loaded keys should produce the same public key PEM
            const origPub = original.publicKey.export({ type: 'spki', format: 'pem' });
            const loadedPub = loaded.publicKey.export({ type: 'spki', format: 'pem' });
            expect(loadedPub).toBe(origPub);
        });

        it('should throw when keyfile permissions are restricted', () => {
            generateServerIdentity(testDir);
            const { privateKeyPath } = getIdentityPaths(testDir);

            // Make the private key unreadable
            try {
                fs.chmodSync(privateKeyPath, 0o000);
                // On Windows, chmod doesn't actually restrict access — verify it worked
                try {
                    fs.accessSync(privateKeyPath, fs.constants.R_OK);
                    // If we can still read the file after chmod, skip this test (Windows)
                    fs.chmodSync(privateKeyPath, 0o600);
                    return;
                } catch {
                    // Good — the chmod actually worked (Unix)
                }
            } catch {
                // chmod itself failed, skip
                return;
            }

            _resetCachedIdentity();
            expect(() => loadServerIdentity(testDir)).toThrow('Cannot read private key');

            // Restore permissions for cleanup
            fs.chmodSync(privateKeyPath, 0o600);
        });

        it('should throw when key files are missing', () => {
            expect(() => loadServerIdentity(testDir)).toThrow();
        });
    });

    describe('initializeServerIdentity()', () => {
        it('should generate keys on first call when none exist', () => {
            expect(identityExists(testDir)).toBe(false);

            const identity = initializeServerIdentity(testDir);

            expect(identityExists(testDir)).toBe(true);
            expect(identity.publicKey.asymmetricKeyType).toBe('ed25519');
        });

        it('should load existing keys on subsequent calls', () => {
            const first = initializeServerIdentity(testDir);
            const firstPub = first.publicKey.export({ type: 'spki', format: 'pem' });

            _resetCachedIdentity();
            const second = initializeServerIdentity(testDir);
            const secondPub = second.publicKey.export({ type: 'spki', format: 'pem' });

            // Same key should be loaded
            expect(secondPub).toBe(firstPub);
        });

        it('should populate the in-memory singleton', () => {
            expect(() => getServerIdentity()).toThrow('not initialized');

            initializeServerIdentity(testDir);

            const cached = getServerIdentity();
            expect(cached.publicKey.asymmetricKeyType).toBe('ed25519');
        });
    });

    describe('computePublicKeyFingerprint()', () => {
        it('should return a 16-char uppercase hex string', () => {
            const identity = generateServerIdentity(testDir);
            const fingerprint = computePublicKeyFingerprint(identity.publicKey);

            expect(fingerprint).toMatch(/^[0-9A-F]{16}$/);
        });

        it('should produce deterministic output for the same key', () => {
            const identity = generateServerIdentity(testDir);
            const fp1 = computePublicKeyFingerprint(identity.publicKey);
            const fp2 = computePublicKeyFingerprint(identity.publicKey);

            expect(fp1).toBe(fp2);
        });
    });

    describe('identityExists()', () => {
        it('should return false when no keys exist', () => {
            expect(identityExists(testDir)).toBe(false);
        });

        it('should return true after key generation', () => {
            generateServerIdentity(testDir);
            expect(identityExists(testDir)).toBe(true);
        });

        it('should return false if only one key file exists', () => {
            generateServerIdentity(testDir);
            const { privateKeyPath } = getIdentityPaths(testDir);
            fs.unlinkSync(privateKeyPath);
            expect(identityExists(testDir)).toBe(false);
        });
    });
});
