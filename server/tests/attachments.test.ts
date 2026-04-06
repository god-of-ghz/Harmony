import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock DB
const localMockDb = vi.hoisted(() => ({
    allQuery: vi.fn(),
    getQuery: vi.fn(),
    runQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([{ id: 's1' }]),
    getServerQuery: vi.fn(),
    allNodeQuery: vi.fn(),
    allServerQuery: vi.fn().mockResolvedValue([]),
    getNodeQuery: vi.fn(),
    runNodeQuery: vi.fn(),
    runServerQuery: vi.fn(),
}));

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        unlinkSync: vi.fn(),
        writeFileSync: vi.fn(),
        promises: {
            unlink: vi.fn().mockResolvedValue(undefined)
        }
    }
}));

const mockDir = vi.hoisted(() => require('os').tmpdir());

vi.mock('../src/database', () => ({
    allQuery: (...args: any) => localMockDb.allQuery(...args),
    getQuery: (...args: any) => localMockDb.getQuery(...args),
    runQuery: (...args: any) => localMockDb.runQuery(...args),
    getAllLoadedServers: () => localMockDb.getAllLoadedServers(),
    getServerQuery: (...args: any) => localMockDb.getServerQuery(...args),
    allNodeQuery: (...args: any) => localMockDb.allNodeQuery(...args),
    allServerQuery: (...args: any) => localMockDb.allServerQuery(...args),
    getNodeQuery: (...args: any) => localMockDb.getNodeQuery(...args),
    runNodeQuery: (...args: any) => localMockDb.runNodeQuery(...args),
    runServerQuery: (...args: any) => localMockDb.runServerQuery(...args),
    executeGet: vi.fn(),
    executeRun: vi.fn(),
    executeAll: vi.fn(),
    SERVERS_DIR: mockDir,
    DATA_DIR: mockDir,
    nodeDbPath: mockDir + '/node.db',
    default: localMockDb
}));

// We removed vi.mock('file-type') to securely test the real file-type parsing using actual magic bytes!

const mockBroadcast = vi.fn();
const app = createApp(localMockDb as any, mockBroadcast);

describe('Attachments & Messages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('POST /api/servers/:serverId/attachments should reject file without permissions', async () => {
        localMockDb.getNodeQuery.mockResolvedValue(null);
        localMockDb.getServerQuery.mockResolvedValue(null); // No profile
        
        const res = await request(app)
            .post('/api/servers/s1/attachments')
            .set('x-account-id', 'acc1')
            .attach('files', Buffer.from('test'), 'test.png');
            
        expect(res.status).toBe(403);
    });

    it('POST /api/servers/:serverId/attachments should allow image upload if authorized', async () => {
        // authorized mocks
        localMockDb.getNodeQuery.mockResolvedValue({ is_creator: 0 });
        localMockDb.getServerQuery.mockResolvedValue({ id: 'p1', role: 'OWNER' }); // Owner bypasses perm check
        
        const res = await request(app)
            .post('/api/servers/s1/attachments')
            .set('x-account-id', 'acc1')
            // Real PNG Magic Bytes
            .attach('files', Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]), 'image.png');
            
        expect(res.status).toBe(200);
        expect(res.body.urls).toHaveLength(1);
        expect(res.body.urls[0]).toContain('/uploads/s1/');
    });

    it('POST /api/servers/:serverId/attachments should reject dangerous files', async () => {
        // authorized mocks
        localMockDb.getNodeQuery.mockResolvedValue({ is_creator: 0 });
        localMockDb.getServerQuery.mockResolvedValue({ id: 'p1', role: 'OWNER' }); 
        
        const res = await request(app)
            .post('/api/servers/s1/attachments')
            .set('x-account-id', 'acc1')
            // Real EXE Magic Bytes (MZ)
            .attach('files', Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), 'bad.exe');
            
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('dangerous file type');
    });

    it('POST /api/channels/:channelId/messages should accept attachments array and insert it', async () => {
        localMockDb.getAllLoadedServers.mockResolvedValue([{ id: 's1' }]);
        localMockDb.getServerQuery.mockImplementation(async (s, query, params) => {
            if (query.includes('channels')) return { server_id: 's1' }; // findServerId check
            if (query.includes('profiles')) return { username: 'testuser' };
            return null; // For get() on serverId
        });
        
        localMockDb.runServerQuery.mockResolvedValue(undefined);

        const payload = { content: 'hello with attachments', authorId: 'u1', attachments: JSON.stringify(['/uploads/s1/test.png']) };
        const res = await request(app)
            .post('/api/channels/ch1/messages')
            .send(payload);

        expect(res.status).toBe(200);
        expect(res.body.attachments).toEqual('["/uploads/s1/test.png"]');
        expect(localMockDb.runServerQuery).toHaveBeenCalledWith(
            's1',
            expect.stringContaining('attachments'),
            expect.arrayContaining(['["/uploads/s1/test.png"]'])
        );
        expect(mockBroadcast).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'NEW_MESSAGE',
                data: expect.objectContaining({ attachments: '["/uploads/s1/test.png"]' })
            })
        );
    });
});
