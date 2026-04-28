import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performAuditForServer } from '../src/jobs/auditJob';
import dbManager from '../src/database';
import crypto from 'crypto';

vi.mock('../src/database', () => {
    return {
        default: {
            allServerQuery: vi.fn(),
    allGuildQuery: vi.fn().mockResolvedValue([]),
            runServerQuery: vi.fn(),
    runGuildQuery: vi.fn(),
            getAllLoadedServers: vi.fn()
        ,
    getAllLoadedGuilds: vi.fn().mockResolvedValue([])}
    };
});

// P18 FIX: Wire guild methods as aliases of server methods
if (typeof mockDbManager !== "undefined") {
    mockDbManager.allGuildQuery = mockDbManager.allServerQuery;
    mockDbManager.runGuildQuery = mockDbManager.runServerQuery;
    mockDbManager.getAllLoadedGuilds = mockDbManager.getAllLoadedServers;
}

describe('Audit Job', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(1700000000000); // stable time
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('performAuditForServer computes SHA-256 hash of messages and inserts it', async () => {
        const mockMessages = [
            { id: '1', content: 'hello', signature: 'sig1', timestamp: '2023-10-01T00:00:00.000Z' },
            { id: '2', content: 'world', signature: 'sig2', timestamp: '2023-10-01T00:01:00.000Z' }
        ];
        
        vi.mocked(dbManager.allServerQuery).mockResolvedValueOnce(mockMessages);
        vi.mocked(dbManager.runServerQuery).mockResolvedValueOnce(true);

        await performAuditForServer('sv1', 24);

        expect(dbManager.allServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('SELECT id, content, signature, timestamp FROM messages'), expect.any(Array));
        
        const expectedHashText = `1:2023-10-01T00:00:00.000Z:hello:sig12:2023-10-01T00:01:00.000Z:world:sig2`;
        const expectedDigest = crypto.createHash('sha256').update(expectedHashText).digest('hex');

        expect(dbManager.runServerQuery).toHaveBeenCalledWith('sv1', expect.stringContaining('INSERT INTO integrity_audits'), [expectedDigest, 1700000000000]);
    });

    it('performAuditForServer short circuits with empty messages', async () => {
        vi.mocked(dbManager.allServerQuery).mockResolvedValueOnce([]); // No messages

        await performAuditForServer('sv1', 24);

        expect(dbManager.runServerQuery).not.toHaveBeenCalled();
    });

    it('performAuditForServer hash is deterministic', async () => {
        const mockMessages = [
            { id: '5', content: 'same', signature: 'sig5', timestamp: '2023-10-01T00:00:00.000Z' }
        ];
        
        vi.mocked(dbManager.allServerQuery).mockResolvedValueOnce(mockMessages);
        await performAuditForServer('sv2', 24);
        const digest1 = vi.mocked(dbManager.runServerQuery).mock.calls[0][2][0];

        vi.clearAllMocks();

        vi.mocked(dbManager.allServerQuery).mockResolvedValueOnce(mockMessages);
        await performAuditForServer('sv3', 24);
        const digest2 = vi.mocked(dbManager.runServerQuery).mock.calls[0][2][0];

        expect(digest1).toBe(digest2);
    });

    it('performAuditForServer catches DB errors gracefully', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(dbManager.allServerQuery).mockRejectedValueOnce(new Error('DB is locked'));

        await performAuditForServer('sv1', 24);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Audit failed for sv1:'), expect.any(Error));
        consoleSpy.mockRestore();
    });
});
