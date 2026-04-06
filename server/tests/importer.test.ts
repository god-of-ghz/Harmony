import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { importDiscordJson, importDirectory } from '../src/importer';
import dbManager from '../src/database';

vi.mock('../src/database', () => ({
    default: {
        runServerQuery: vi.fn().mockResolvedValue(undefined),
        beginTransaction: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
        runBatch: vi.fn().mockResolvedValue(undefined),
        initializeServerBundle: vi.fn().mockResolvedValue(undefined),
    }
}));

describe('Discord Importer', () => {
    const tempDir = path.resolve(process.cwd(), 'temp_test_import');
    const sampleServerId = 'test-server';

    beforeEach(() => {
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        vi.clearAllMocks();
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should import a Discord JSON correctly with streaming', async () => {
        const filePath = path.join(tempDir, 'History-general-123.json');
        const messages = [
            { id: "1001", author_id: "2001", author_name: "Alice", content: "Hello", timestamp: "2023-01-01T00:00:00Z", is_pinned: false },
            { id: "1002", author_id: "2002", author_name: "Bob", content: "World", timestamp: "2023-01-01T00:00:01Z", is_pinned: true }
        ];
        fs.writeFileSync(filePath, JSON.stringify(messages));

        const profileCache = new Set<string>();
        await importDiscordJson(filePath, sampleServerId, profileCache);

        // Verify channel creation
        expect(dbManager.runServerQuery).toHaveBeenCalledWith(
            sampleServerId,
            expect.stringContaining('INSERT OR IGNORE INTO channels'),
            expect.arrayContaining(['123', sampleServerId, 'general'])
        );

        // Verify transactions
        expect(dbManager.beginTransaction).toHaveBeenCalled();
        expect(dbManager.commit).toHaveBeenCalled();

        // Verify batches
        expect(dbManager.runBatch).toHaveBeenCalledWith(
            sampleServerId,
            expect.stringContaining('INSERT OR IGNORE INTO profiles'),
            expect.arrayContaining([
                expect.arrayContaining(["2001", sampleServerId, "Alice", "Alice", "", "USER", "2001"]),
                expect.arrayContaining(["2002", sampleServerId, "Bob", "Bob", "", "USER", "2002"])
            ])
        );

        expect(dbManager.runBatch).toHaveBeenCalledWith(
            sampleServerId,
            expect.stringContaining('INSERT OR IGNORE INTO messages'),
            expect.arrayContaining([
                expect.arrayContaining(["1001", "123", "2001", "Hello", "2023-01-01T00:00:00Z", 0]),
                expect.arrayContaining(["1002", "123", "2002", "World", "2023-01-01T00:00:01Z", 1])
            ])
        );
    });

    it('should handle BigInt IDs correctly without precision loss', async () => {
        const filePath = path.join(tempDir, 'bigint.json');
        // Large IDs that would lose precision if parsed as Numbers
        const rawJson = `[{"id": 999999999999999999, "author_id": 888888888888888888, "author_name": "Big", "content": "Big ID", "timestamp": "2023", "is_pinned": false}]`;
        fs.writeFileSync(filePath, rawJson);

        await importDiscordJson(filePath, sampleServerId);

        expect(dbManager.runBatch).toHaveBeenCalledWith(
            sampleServerId,
            expect.stringContaining('INSERT OR IGNORE INTO messages'),
            expect.arrayContaining([
                expect.arrayContaining(["999999999999999999", expect.any(String), "888888888888888888", "Big ID", "2023", 0])
            ])
        );
    });

    it('should rollback on batch failure', async () => {
        const filePath = path.join(tempDir, 'fail.json');
        fs.writeFileSync(filePath, JSON.stringify([{ id: "1", author_id: "1", author_name: "x", content: "x", timestamp: "x" }]));

        (dbManager.runBatch as any).mockRejectedValueOnce(new Error("DB Error"));

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await importDiscordJson(filePath, sampleServerId);

        expect(dbManager.rollback).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('should process directory and deduplicate profiles', async () => {
        const file1 = path.join(tempDir, 'History-chan1-1.json');
        const file2 = path.join(tempDir, 'History-chan2-2.json');
        
        const messages = [
            { id: "1", author_id: "user1", author_name: "User One", content: "msg1", timestamp: "t1" }
        ];
        
        fs.writeFileSync(file1, JSON.stringify(messages));
        fs.writeFileSync(file2, JSON.stringify(messages)); // Same author

        await importDirectory(tempDir, "Test Server");

        // initializeServerBundle should be called
        expect(dbManager.initializeServerBundle).toHaveBeenCalled();

        // Profiles batch should only be called once for "user1" because of profileCache
        const profileBatchCalls = (dbManager.runBatch as any).mock.calls.filter((call: any[]) => 
            call[1].includes('INSERT OR IGNORE INTO profiles')
        );
        
        expect(profileBatchCalls.length).toBe(1);
    });

    it('should handle concurrent imports to the same server without transaction conflicts', async () => {
        const file1 = path.join(tempDir, 'Concurrent-1.json');
        const file2 = path.join(tempDir, 'Concurrent-2.json');
        
        fs.writeFileSync(file1, JSON.stringify([{ id: "c1", author_id: "u1", author_name: "U", content: "m1", timestamp: "t1" }]));
        fs.writeFileSync(file2, JSON.stringify([{ id: "c2", author_id: "u2", author_name: "U", content: "m2", timestamp: "t2" }]));

        // Run two imports in parallel
        await Promise.all([
            importDiscordJson(file1, sampleServerId),
            importDiscordJson(file2, sampleServerId)
        ]);

        // Handled by withServerLock, so they should both succeed
        expect(dbManager.commit).toHaveBeenCalledTimes(2);
        expect(dbManager.beginTransaction).toHaveBeenCalledTimes(2);
    });
});

