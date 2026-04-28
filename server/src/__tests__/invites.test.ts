import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import dbManager from '../database';

describe('Phase 4: Atomic Federation Invites', () => {
    let testTokenRace = 'race_token_' + Date.now();
    let testTokenExpired = 'expired_token_' + Date.now();

    beforeAll(async () => {
        // Initialize DB schema to ensure 'invites' exists
        // Wait, DatabaseManager does it via initNodeDb() which is async but finishes locally.
        // We ensure tables exist by running a safe query and waiting.
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        // Populate test tokens directly via SQL
        await dbManager.runNodeQuery(`
            INSERT INTO invites (token, host_uri, guild_id, max_uses, current_uses, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            testTokenRace,
            'http://localhost:3002',
            'test_guild_race',
            1, // Only 1 use allowed
            0,
            Date.now() + 10000 // expires in 10s
        ]);

        await dbManager.runNodeQuery(`
            INSERT INTO invites (token, host_uri, guild_id, max_uses, current_uses, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            testTokenExpired,
            'http://localhost:3002',
            'test_guild_expired',
            5, 
            0,
            Date.now() - 1000 // Expired 1 second ago
        ]);
    });

    afterAll(async () => {
        await dbManager.runNodeQuery(`DELETE FROM invites WHERE token = ? OR token = ?`, [testTokenRace, testTokenExpired]);
    });

    test('The Concurrency Test: Atomic rate-limiting prevents 1-time limit bypass', async () => {
        // We will simulate 5 concurrent requests hitting the DB using the exact SQL
        // used by the /api/invites/consume endpoint
        const consumeAttempt = async () => {
            const now = Date.now();
            const sql = `UPDATE invites SET current_uses = current_uses + 1 WHERE token = ? AND current_uses < max_uses AND expires_at > ? RETURNING *`;
            try {
                const row = await dbManager.getNodeQuery(sql, [testTokenRace, now]);
                if (!row) return { success: false };
                return { success: true };
            } catch (err) {
                return { success: false };
            }
        };

        // Fire 5 asynchronous Promise.all requests against the consumption query at exactly same ms
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(consumeAttempt());
        }
        const results = await Promise.all(promises);

        const successes = results.filter(r => r.success).length;
        const failures = results.filter(r => !r.success).length;

        // Exactly 1 should succeed, and 4 should fail due to atomic locking on the SQLite DB
        expect(successes).toBe(1);
        expect(failures).toBe(4);

        // Verify the database state correctly reflects 1 use
        const finalRow: any = await dbManager.getNodeQuery(`SELECT current_uses FROM invites WHERE token = ?`, [testTokenRace]);
        expect(finalRow.current_uses).toBe(1);
    });

    test('Consumption fails if expires_at was 1 second in the past', async () => {
        const now = Date.now();
        const sql = `UPDATE invites SET current_uses = current_uses + 1 WHERE token = ? AND current_uses < max_uses AND expires_at > ? RETURNING *`;
        const row = await dbManager.getNodeQuery(sql, [testTokenExpired, now]);

        expect(row).toBeUndefined(); // It should return undefined / 0 rows

        const state: any = await dbManager.getNodeQuery(`SELECT current_uses FROM invites WHERE token = ?`, [testTokenExpired]);
        expect(state.current_uses).toBe(0); // Uses should not increment
    });
});
