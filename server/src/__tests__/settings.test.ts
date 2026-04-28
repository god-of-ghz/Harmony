import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, generateToken } from '../app';
import dbManager from '../database';

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

describe('API: Account Settings', () => {
    let app: any;
    const accountId = 'test-account-1';
    let token: string;

    beforeEach(() => {
        vi.clearAllMocks();
        app = createApp(dbManager, () => {});
        token = generateToken(accountId);
    });

    it('should return empty object for new account', async () => {
        (dbManager.getNodeQuery as any).mockResolvedValue(null);

        const res = await request(app)
            .get('/api/accounts/settings')
            .set('Authorization', `Bearer ${token}`);
            
        expect(res.status).toBe(200);
        expect(res.body).toEqual({});
        expect(dbManager.getNodeQuery).toHaveBeenCalledWith(
            expect.stringContaining('SELECT settings FROM account_settings'),
            [accountId]
        );
    });

    it('should allow setting account settings', async () => {
        (dbManager.getNodeQuery as any).mockResolvedValue(null);

        const res = await request(app)
            .put('/api/accounts/settings')
            .set('Authorization', `Bearer ${token}`)
            .send({
                theme: 'dark',
                notifications: {
                    muteAll: true
                }
            });
            
        expect(res.status).toBe(200);
        expect(res.body.theme).toBe('dark');
        expect(res.body.notifications.muteAll).toBe(true);

        expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO account_settings'),
            expect.arrayContaining([accountId, expect.stringContaining('"theme":"dark"')])
        );
    });

    it('should return parsed existing settings', async () => {
        (dbManager.getNodeQuery as any).mockResolvedValue({
            settings: JSON.stringify({ theme: 'dark', notifications: { muteAll: true } })
        });

        const res = await request(app)
            .get('/api/accounts/settings')
            .set('Authorization', `Bearer ${token}`);
            
        expect(res.status).toBe(200);
        expect(res.body.theme).toBe('dark');
        expect(res.body.notifications.muteAll).toBe(true);
    });

    it('should merge new settings with existing settings', async () => {
        (dbManager.getNodeQuery as any).mockResolvedValue({
            settings: JSON.stringify({ notifications: { muteAll: true } })
        });

        const res = await request(app)
            .put('/api/accounts/settings')
            .set('Authorization', `Bearer ${token}`)
            .send({
                theme: 'light'
            });
            
        expect(res.status).toBe(200);
        expect(res.body.theme).toBe('light'); // updated
        expect(res.body.notifications.muteAll).toBe(true); // preserved

        expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO account_settings'),
            expect.arrayContaining([accountId, expect.stringContaining('"muteAll":true')])
        );
    });
});
