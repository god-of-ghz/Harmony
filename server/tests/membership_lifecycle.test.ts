/**
 * membership_lifecycle.test.ts
 *
 * Validates the complete membership lifecycle:
 *   1. Create profile on server (membership_status=active)
 *   2. Access requireServerAccess-protected endpoint → 200
 *   3. Leave server → membership_status=left
 *   4. Try requireServerAccess-protected endpoint → 403
 *   5. Rejoin server → membership_status=active
 *   6. Access requireServerAccess-protected endpoint → 200
 *   7. Leave/rejoin broadcasts correct WebSocket events
 *
 * Note: All three middleware (requirePermission, requireRole, requireServerAccess)
 * now check membership_status='active' and reject deactivated accounts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../src/app';

const mockDbManager = vi.hoisted(() => ({
    channelToServerId: { get: () => 'sv1', set: vi.fn(), delete: vi.fn() },
    channelToGuildId: { get: (id) => String(id).includes('Unknown') ? null : 'sv1', set:()=>{}, delete:()=>{} },
    allNodeQuery: vi.fn(),
    getNodeQuery: vi.fn(),
    runNodeQuery: vi.fn(),
    allServerQuery: vi.fn().mockResolvedValue([]),
    allGuildQuery: vi.fn().mockResolvedValue([]),
    getServerQuery: vi.fn(),
    getGuildQuery: vi.fn(),
    runServerQuery: vi.fn(),
    runGuildQuery: vi.fn(),
    getAllLoadedServers: vi.fn().mockResolvedValue([{ id: 'sv1' ,
    getAllLoadedGuilds: vi.fn().mockResolvedValue([])}]),
    initializeServerBundle: vi.fn(),
    initializeGuildBundle: vi.fn(),
    unloadServerInstance: vi.fn(),
    unloadGuildInstance: vi.fn(),
}));

vi.mock('../src/database', () => ({
    SERVERS_DIR: 'mock_servers_dir',
    GUILDS_DIR: 'mock_servers_dir',
    DATA_DIR: 'mock_data_dir',
    nodeDbPath: 'mock_data_dir/node.db',
    default: mockDbManager
}));

// P18 FIX: Wire guild methods as aliases of server methods
if (typeof mockDbManager !== "undefined") {
    mockDbManager.allGuildQuery = mockDbManager.allServerQuery;
    mockDbManager.getGuildQuery = mockDbManager.getServerQuery;
    mockDbManager.runGuildQuery = mockDbManager.runServerQuery;
    mockDbManager.getAllLoadedGuilds = mockDbManager.getAllLoadedServers;
    mockDbManager.initializeGuildBundle = mockDbManager.initializeServerBundle;
    mockDbManager.unloadGuildInstance = mockDbManager.unloadServerInstance;
    mockDbManager.channelToGuildId = mockDbManager.channelToServerId;
}

vi.mock('fs', () => ({
    default: {
        rmSync: vi.fn(),
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        readFileSync: vi.fn(),
        accessSync: vi.fn(),
    }
}));

const mockBroadcast = vi.fn();
const app = createApp(mockDbManager, mockBroadcast);
const testToken = generateToken('acc-lifecycle');

describe('Membership Lifecycle — Full Cycle', () => {
    /**
     * Mutable state to simulate membership transitions across the mock DB.
     */
    let membershipStatus: 'active' | 'left' | 'none';

    beforeEach(() => {
        vi.clearAllMocks();
        membershipStatus = 'none';
        mockDbManager.getAllLoadedServers.mockResolvedValue([{ id: 'sv1', name: 'Lifecycle Server' }]);
    });

    /**
     * Configure mock DB for requireServerAccess queries.
     * requireServerAccess checks:
     *   1. getNodeQuery: is_creator, is_deactivated
     *   2. getServerQuery: SELECT id FROM profiles WHERE account_id=? AND server_id=? AND membership_status=?
     */
    function setupStatefulMocks() {
        mockDbManager.getNodeQuery.mockResolvedValue({ is_creator: 0, is_deactivated: 0 });

        mockDbManager.getServerQuery.mockImplementation(async (_svr: string, query: string, params?: any[]) => {
            // requireServerAccess: active profile check
            if (query.includes('FROM profiles') && query.includes('membership_status')) {
                if (params?.includes('active') && membershipStatus === 'active') {
                    return { id: 'p-lifecycle' };
                }
                if (params?.includes('left') && membershipStatus === 'left') {
                    return { id: 'p-lifecycle', membership_status: 'left', server_id: 'sv1', account_id: 'acc-lifecycle', nickname: 'TestUser' };
                }
                return null;
            }
            // Rejoin: fetch left profile
            if (query.includes('FROM profiles') && query.includes('WHERE id = ?')) {
                return { id: 'p-lifecycle', server_id: 'sv1', account_id: 'acc-lifecycle', membership_status: membershipStatus, nickname: 'TestUser', left_at: null };
            }
            return null;
        });

        mockDbManager.allServerQuery.mockResolvedValue([]);

        mockDbManager.runServerQuery.mockImplementation(async (_svr: string, query: string, params?: any[]) => {
            if (query.includes('membership_status') && params?.includes('left')) {
                membershipStatus = 'left';
            }
            if (query.includes('membership_status') && params?.includes('active')) {
                membershipStatus = 'active';
            }
            return undefined;
        });
    }

    it('should complete the full lifecycle: active → access → leave → denied → rejoin → access', async () => {
        setupStatefulMocks();
        membershipStatus = 'active';

        // Step 1: Active member can access requireServerAccess endpoints
        const emojisOk = await request(app)
            .get('/api/servers/sv1/emojis')
            .set('Authorization', `Bearer ${testToken}`);
        expect(emojisOk.status).toBe(200);

        // Step 2: Leave server
        const leaveRes = await request(app)
            .post('/api/servers/sv1/leave')
            .set('Authorization', `Bearer ${testToken}`);
        expect(leaveRes.status).toBe(200);
        expect(leaveRes.body.success).toBe(true);
        expect(membershipStatus).toBe('left');

        // Step 3: Left member CANNOT access requireServerAccess endpoints → 403
        const emojisDenied = await request(app)
            .get('/api/servers/sv1/emojis')
            .set('Authorization', `Bearer ${testToken}`);
        expect(emojisDenied.status).toBe(403);
        expect(emojisDenied.body.error).toContain('do not have access');

        // Step 4: Rejoin server
        const rejoinRes = await request(app)
            .post('/api/servers/sv1/rejoin')
            .set('Authorization', `Bearer ${testToken}`);
        expect(rejoinRes.status).toBe(200);
        expect(membershipStatus).toBe('active');

        // Step 5: Can access requireServerAccess endpoints again
        const emojisAfterRejoin = await request(app)
            .get('/api/servers/sv1/emojis')
            .set('Authorization', `Bearer ${testToken}`);
        expect(emojisAfterRejoin.status).toBe(200);
    });

    it('should broadcast MEMBER_LEAVE event on leave', async () => {
        setupStatefulMocks();
        membershipStatus = 'active';

        await request(app)
            .post('/api/servers/sv1/leave')
            .set('Authorization', `Bearer ${testToken}`);

        expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
            type: 'MEMBER_LEAVE',
            data: expect.objectContaining({ profileId: 'p-lifecycle', serverId: 'sv1' })
        }));
    });

    it('should broadcast MEMBER_JOIN event on rejoin', async () => {
        setupStatefulMocks();
        membershipStatus = 'left';

        await request(app)
            .post('/api/servers/sv1/rejoin')
            .set('Authorization', `Bearer ${testToken}`);

        expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
            type: 'MEMBER_JOIN',
        }));
    });

    it('should return 404 when leaving a server with no active membership', async () => {
        setupStatefulMocks();
        membershipStatus = 'left'; // Already left

        const leaveRes = await request(app)
            .post('/api/servers/sv1/leave')
            .set('Authorization', `Bearer ${testToken}`);

        expect(leaveRes.status).toBe(404);
        expect(leaveRes.body.error).toContain('No active membership');
    });

    it('should return 409 when rejoining a server where already active', async () => {
        setupStatefulMocks();
        membershipStatus = 'active';

        const rejoinRes = await request(app)
            .post('/api/servers/sv1/rejoin')
            .set('Authorization', `Bearer ${testToken}`);

        expect(rejoinRes.status).toBe(409);
        expect(rejoinRes.body.error).toContain('Already an active member');
    });
});
