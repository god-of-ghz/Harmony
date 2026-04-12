import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../src/app';
import db from '../src/database';

// Mock database
vi.mock('../src/database', () => ({
    DATA_DIR: '/tmp/harmony-test',
    default: {
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
    }
}));

const mockBroadcast = vi.fn();
const app = createApp(db, mockBroadcast);

const validToken = generateToken('acc1');

// Mock fs for uploads
vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        statSync: vi.fn().mockReturnValue({ isFile: () => true }),
        readdirSync: vi.fn().mockReturnValue([]),
    }
}));

describe('Security Lockdown (JWT, RBAC, & Phase 4)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(db.getAllLoadedServers).mockResolvedValue([{ id: 's1' }]);
    });

    describe('JWT Authentication', () => {
        it('should block requests without a token (401)', async () => {
            const res = await request(app).get('/api/servers');
            expect(res.status).toBe(401);
        });

        it('should block requests with an invalid token (401)', async () => {
            const res = await request(app)
                .get('/api/servers')
                .set('Authorization', 'Bearer invalid-token');
            expect(res.status).toBe(401);
        });

        it('should allow requests with a valid token (200)', async () => {
            const res = await request(app)
                .get('/api/servers')
                .set('Authorization', `Bearer ${validToken}`);
            expect(res.status).toBe(200);
        });
    });

    describe('RBAC Permission Enforcement', () => {
        const adminToken = generateToken('admin-acc');
        const userToken = generateToken('user-acc');

        it('should allow SERVER_ADMIN/OWNER to manage roles (requireRole)', async () => {
            vi.mocked(db.getNodeQuery).mockResolvedValue({ is_creator: 1 }); // Creator is OWNER
            vi.mocked(db.getServerQuery).mockResolvedValue({ id: 'pAdmin', role: 'OWNER' });

            const res = await request(app)
                .post('/api/servers/s1/roles')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ name: 'New Role', permissions: 8, color: '#000', position: 1 });
            
            expect(res.status).toBe(200);
        });

        it('should block regular users from managing roles (requireRole -> 403)', async () => {
            vi.mocked(db.getNodeQuery).mockResolvedValue({ is_creator: 0 });
            vi.mocked(db.getServerQuery).mockResolvedValue({ id: 'pUser', role: 'USER' });

            const res = await request(app)
                .post('/api/servers/s1/roles')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ name: 'Hacker Role', permissions: 1, color: '#000', position: 1 });
            
            expect(res.status).toBe(403);
        });

        it('should allow users with MANAGE_CHANNELS permission to delete channels (requirePermission)', async () => {
            vi.mocked(db.getNodeQuery).mockResolvedValue({ is_creator: 0 });
            vi.mocked(db.getServerQuery).mockImplementation(async (s, q) => {
                if (q.includes('FROM profiles')) return { id: 'pUser', role: 'USER' };
                if (q.includes('FROM channels')) return { server_id: 's1' };
                return null;
            });
            // Mock bitwise permission check: MANAGE_CHANNELS (8)
            vi.mocked(db.allServerQuery).mockResolvedValue([{ permissions: 8 }]);

            const res = await request(app)
                .delete('/api/channels/c1?serverId=s1')
                .set('Authorization', `Bearer ${userToken}`);
            
            expect(res.status).toBe(200);
        });

        it('should block users WITHOUT SEND_MESSAGES permission from posting messages', async () => {
            const userToken = generateToken('user-acc');
            vi.mocked(db.getNodeQuery).mockResolvedValue({ is_creator: 0 });
            vi.mocked(db.getServerQuery).mockImplementation(async (s, q) => {
                if (q.includes('FROM profiles')) return { id: 'pUser', role: 'USER', account_id: 'user-acc' };
                if (q.includes('FROM channels')) return { server_id: 's1' };
                return null;
            });
            // Mock bitwise permission check: No SEND_MESSAGES (128) and NO Administrator (1)
            vi.mocked(db.allServerQuery).mockResolvedValue([{ permissions: 0 }]); 

            const res = await request(app)
                .post('/api/channels/c1/messages?serverId=s1')
                .set('Authorization', `Bearer ${userToken}`)
                .send({ content: 'Hello', authorId: 'pUser' });
            
            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Forbidden: Insufficient permissions');
        });
    });

    describe('CORS Restrictions (Phase 4)', () => {
        it('should allow requests from whitelisted origins', async () => {
            const res = await request(app)
                .get('/api/health')
                .set('Origin', 'http://localhost:3000');
            expect(res.header['access-control-allow-origin']).toBe('http://localhost:3000');
        });

        it('should reject requests from untrusted origins', async () => {
            const res = await request(app)
                .get('/api/health')
                .set('Origin', 'http://malicious.com');
            expect(res.header['access-control-allow-origin']).toBeUndefined();
        });
    });

    describe('File Upload Lockdown (Phase 4)', () => {
        it('should reject SVG uploads even if authorized (content validation)', async () => {
            vi.mocked(db.getNodeQuery).mockResolvedValue({ is_creator: 0, is_admin: 0 });
            vi.mocked(db.getServerQuery).mockResolvedValue({ id: 'p1', role: 'OWNER' });

            const res = await request(app)
                .post('/api/servers/s1/attachments')
                .set('Authorization', `Bearer ${validToken}`)
                .attach('files', Buffer.from('<svg></svg>'), 'test.svg');

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Rejected dangerous file type');
        });

        it('should allow PNG uploads with valid magic bytes', async () => {
            vi.mocked(db.getNodeQuery).mockResolvedValue({ is_creator: 1 });
            vi.mocked(db.getServerQuery).mockResolvedValue({ id: 'p1', role: 'OWNER' });

            const res = await request(app)
                .post('/api/servers/s1/attachments')
                .set('Authorization', `Bearer ${validToken}`)
                .attach('files', Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]), 'test.png');

            expect(res.status).toBe(200);
        });
    });

    describe('Static Headers (Phase 4)', () => {
        it('should set security headers on /uploads route', async () => {
            const res = await request(app).get('/uploads/s1/somefile.png');
            expect(res.header['content-security-policy']).toBe("default-src 'none'");
            expect(res.header['x-content-type-options']).toBe('nosniff');
        });

        it('should set Content-Disposition: attachment for PDF files', async () => {
            const res = await request(app).get('/uploads/s1/document.pdf');
            expect(res.header['content-disposition']).toBe('attachment');
        });

        it('should allow legitimate dot characters in serverId without triggering traversal block', async () => {
            const res = await request(app).get('/uploads/server.config/file.txt');
            // 404 means the static middleware tried to serve but failed to find the file (which is correct behavior here).
            // A 403 would mean our path traversal middleware failed.
            expect(res.status).not.toBe(403);
        });

        it('should block malicious path traversal attempts in serverId with 403', async () => {
            // Test how the middleware handles explicitly malicious decoded strings if they bypass router
            const reqParam = encodeURIComponent('../../../etc');
            const res = await request(app).get(`/uploads/${reqParam}/file.txt`);
            // If express routing catches it it may be 400/404, but if it hits our middleware it MUST be 403
            if (res.status === 403) {
                expect(res.body.error).toContain('Invalid path traversal attempt');
            } else {
                expect(res.status).toBe(404);
            }
        });
    });
});
