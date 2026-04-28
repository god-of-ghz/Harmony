import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import crypto from 'crypto';
import jwt from '../src/crypto/jwt';
import fetch from 'node-fetch'; // the global fetch is typically available in Node 18+, but we use global fetch here.
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';

const TEST_DATA_DIR = path.resolve(process.cwd(), 'federated_system_test_data');

describe('Federated Authentication System (E2E Loopback)', () => {
    let serverA: http.Server;
    let serverB: http.Server;
    
    let serverAUrl: string;
    let serverBUrl: string;
    
    let dbManager: any;
    
    let serverAIdentity: { publicKey: crypto.KeyObject, privateKey: crypto.KeyObject };

    beforeAll(async () => {
        // --- 1. Prepare Storage for Server B (The Receiver) ---
        if (fs.existsSync(TEST_DATA_DIR)) {
            fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
        }
        fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
        process.env.HARMONY_DATA_DIR = TEST_DATA_DIR;

        const dbModule = await import('../src/database');
        dbManager = dbModule.default;
        
        const pkiModule = await import('../src/crypto/pki');
        // Initialize Server B's identity into the singleton
        pkiModule.initializeServerIdentity(TEST_DATA_DIR);
        
        // --- 2. Spin UP Server A (The Lightweight Fetch Proxy/Mock) ---
        // Generate an isolated Ed25519 PKI keypair for Server A
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        serverAIdentity = { publicKey, privateKey };
        
        serverA = http.createServer((req, res) => {
            // Serve the public key strictly conforming to Server B's auth fetch
            if (req.url === '/api/federation/key' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                const pubSpkiDer = serverAIdentity.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
                res.end(JSON.stringify({ public_key: pubSpkiDer.toString('base64') }));
                return;
            }
            res.writeHead(404);
            res.end();
        });
        
        await new Promise<void>(resolve => {
            serverA.listen(0, '127.0.0.1', () => resolve());
        });
        const addrA = serverA.address() as AddressInfo;
        serverAUrl = `http://127.0.0.1:${addrA.port}`;
        
        // --- 3. Spin UP Server B (The Actual Harmony App) ---
        const { createApp } = await import('../src/app');
        const appB = createApp(dbManager, () => {});
        
        serverB = http.createServer(appB);
        await new Promise<void>(resolve => {
            serverB.listen(0, '127.0.0.1', () => resolve());
        });
        const addrB = serverB.address() as AddressInfo;
        serverBUrl = `http://127.0.0.1:${addrB.port}`;

        // Give SQLite a moment
        await new Promise(resolve => setTimeout(resolve, 800));
    });

    afterAll(async () => {
        // Shutdown sequence - release TCP ports
        if (serverA) {
            await new Promise<void>(resolve => serverA.close(() => resolve()));
        }
        if (serverB) {
            await new Promise<void>(resolve => serverB.close(() => resolve()));
        }

        if (dbManager) {
            if (dbManager.nodeDb) dbManager.nodeDb.close();
            if (dbManager.dmsDb) dbManager.dmsDb.close();
            const servers = await dbManager.getAllLoadedServers();
            for (const s of servers) {
                dbManager.unloadServerInstance(s.id);
            }
        }
        
        // Give OS time to close file handles
        await new Promise(resolve => setTimeout(resolve, 300));
        
        try {
            fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
        } catch (e) {
            console.warn("Could not clean up test data director:", e);
        }
    });

    it('Federated Native Token successfully authenticates against an independent server over HTTP', async () => {
        // 1. Generate Token natively tied to Server A
        const userA_ID = 'remote-fed-user-' + crypto.randomUUID();
        
        const privateKeyPem = serverAIdentity.privateKey.export({ type: 'pkcs8', format: 'pem' });
        // The critically important issuer claim points to Server A
        const token = jwt.sign(
            { accountId: userA_ID }, 
            privateKeyPem, 
            { algorithm: 'EdDSA', expiresIn: '1h', issuer: serverAUrl }
        );

        // 2. Perform mock target action on Server B using Server A's Token payload
        // Easiest unauthenticated endpoint that requires auth is /api/accounts/unclaimed-imports
        const response = await fetch(`${serverBUrl}/api/accounts/unclaimed-imports`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        // 3. Assertion: Server B correctly pinged Server A's key endpoint, fetched it, validated it, 
        //    and accepted the token, granting 200 OK access to a protected route!
        const responseText = await response.text();
        expect(response.status).toBe(200);
        
        // Validate it's an empty array since it's a fresh DB
        const responseBody = JSON.parse(responseText);
        expect(Array.isArray(responseBody)).toBe(true);
    });
});
