import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../app';
import dbManager from '../database';

// Mock the whole dbManager module to focus on API logic and cross-server routing
vi.mock('../database', () => {
    return {
        default: {
            runNodeQuery: vi.fn(),
            getNodeQuery: vi.fn(),
            allNodeQuery: vi.fn(),
            runServerQuery: vi.fn(),
            getServerQuery: vi.fn(),
            allServerQuery: vi.fn(),
            getAllLoadedServers: vi.fn(),
        },
        DATA_DIR: '/mock-data',
        SERVERS_DIR: '/mock-data/servers',
    };
});

describe('API: Harmony Identity & Discord Claiming', () => {
    const mockBroadcast = vi.fn();
    let app: any;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp(dbManager, mockBroadcast);
    });

    describe('POST /api/accounts/link-discord', () => {
        it('should link discord ID to Harmony account across multiple loaded servers', async () => {
            const accountId = 'harmony-acc-1';
            const discordId = 'discord-user-123';
            const token = generateToken(accountId);

            // Mock Data setup
            (dbManager.getNodeQuery as any).mockResolvedValue({
                id: discordId,
                global_name: 'DiscordDisplay',
                avatar: 'http://cdn/av.png',
                bio: 'Discord Bio'
            });

            (dbManager.getAllLoadedServers as any).mockResolvedValue([
                { id: 'server-alpha', name: 'Alpha' },
                { id: 'server-beta', name: 'Beta' }
            ]);

            // Mock profile return for broadcast check
            (dbManager.getServerQuery as any).mockResolvedValue({ 
                id: discordId, 
                server_id: 'any', 
                account_id: accountId, 
                nickname: 'ImportedNick' 
            });

            const response = await request(app)
                .post('/api/accounts/link-discord')
                .set('Authorization', `Bearer ${token}`)
                .send({ discord_id: discordId });

            expect(response.status).toBe(200);

            // 1. Verify Node DB update (linking imported user to account and dismissing global claim)
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE imported_discord_users SET account_id = ? WHERE id = ?'),
                [accountId, discordId]
            );
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE accounts SET dismissed_global_claim = 1 WHERE id = ?'),
                [accountId]
            );

            // 2. Verify global_profiles update (mapping discord metadata to harmony global profile)
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO global_profiles'),
                expect.arrayContaining([accountId, 'http://cdn/av.png', 'Discord Bio'])
            );

            // 3. Verify cross-server updates (crucial: verify it hits BOTH loaded servers)
            expect(dbManager.runServerQuery).toHaveBeenCalledWith(
                'server-alpha',
                expect.stringContaining('UPDATE profiles SET account_id = ? WHERE id = ?'),
                [accountId, discordId]
            );
            expect(dbManager.runServerQuery).toHaveBeenCalledWith(
                'server-beta',
                expect.stringContaining('UPDATE profiles SET account_id = ? WHERE id = ?'),
                [accountId, discordId]
            );

            // 4. Verify broadcast was triggered for the new profile states
            expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
                type: 'PROFILE_UPDATE',
                data: expect.objectContaining({ account_id: accountId })
            }));
        });
    });

    describe('GET /api/accounts/unclaimed-imports', () => {
        it('should return unclaimed imports if not dismissed', async () => {
            const accountId = 'acc-1';
            const token = generateToken(accountId);

            (dbManager.getNodeQuery as any).mockResolvedValue({ dismissed_global_claim: 0 });
            (dbManager.allNodeQuery as any).mockResolvedValue([{ id: 'd1', global_name: 'User' }]);

            const response = await request(app)
                .get('/api/accounts/unclaimed-imports')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
        });

        it('should return empty array if claim is dismissed', async () => {
            const accountId = 'acc-1';
            const token = generateToken(accountId);

            (dbManager.getNodeQuery as any).mockResolvedValue({ dismissed_global_claim: 1 });

            const response = await request(app)
                .get('/api/accounts/unclaimed-imports')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body).toEqual([]);
            expect(dbManager.allNodeQuery).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/accounts/dismiss-claim', () => {
        it('should update account table to dismiss claim', async () => {
            const accountId = 'acc-1';
            const token = generateToken(accountId);

            const response = await request(app)
                .post('/api/accounts/dismiss-claim')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE accounts SET dismissed_global_claim = 1 WHERE id = ?'),
                [accountId]
            );
        });
    });
});
