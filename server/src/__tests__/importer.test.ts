import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { importDirectory } from '../importer';
import dbManager from '../database';
import * as downloader from '../media/downloader';

vi.mock('fs');
vi.mock('../database', () => ({
    default: {
        initializeServerBundle: vi.fn(),
        runBatch: vi.fn(),
        runNodeQuery: vi.fn(),
        runServerQuery: vi.fn(),
        beginTransaction: vi.fn(),
        commit: vi.fn(),
        rollback: vi.fn(),
        getServerDb: vi.fn()
    },
    DATA_DIR: 'C:/harmony-data',
    SERVERS_DIR: 'C:/harmony-data/servers'
}));
vi.mock('../media/downloader');

describe('Importer V2 - Member Metadata & Avatars', () => {
    const mockServerId = '123456789';
    const mockDir = 'C:/mock-export';

    beforeEach(() => {
        vi.clearAllMocks();
        (dbManager.initializeServerBundle as any).mockResolvedValue(undefined);
        (dbManager.runBatch as any).mockResolvedValue(undefined);
        (dbManager.runNodeQuery as any).mockResolvedValue(undefined);
        (dbManager.runServerQuery as any).mockResolvedValue(undefined);
    });

    it('should correctly separate metadata and handle avatar downloads/fallbacks', async () => {
        const guildMetadata = {
            id: mockServerId,
            name: 'Test Server',
            owner_id: 'owner123',
            description: 'A test server',
            roles: [],
            members: [
                {
                    id: 'member1',
                    name: 'user1',
                    global_name: 'User One',
                    nickname: 'The First One',
                    avatar_url: 'http://cdn.discord.com/avatars/member1/abc.png',
                    server_avatar_url: 'http://cdn.discord.com/servatars/member1/xyz.png',
                    bot: false,
                    roles: []
                },
                {
                    id: 'member2',
                    name: 'user2',
                    global_name: null,
                    nickname: null,
                    avatar_url: 'http://cdn.discord.com/avatars/member2/def.png',
                    server_avatar_url: null, // Should fallback to global
                    bot: false,
                    roles: []
                }
            ],
            emojis: [],
            categories: []
        };

        const metadataJson = JSON.stringify(guildMetadata);
        
        // Mock fs operations
        (fs.existsSync as any).mockImplementation((p: string) => {
            const normalizedPath = p.replace(/\\/g, '/');
            if (normalizedPath.includes('guild_metadata.json')) return true;
            if (normalizedPath.includes('avatars/member2.png')) return true; 
            return false;
        });
        (fs.readFileSync as any).mockReturnValue(metadataJson);
        (fs.readdirSync as any).mockReturnValue([]);
        (fs.mkdirSync as any).mockImplementation(() => {});
        (fs.copyFileSync as any).mockImplementation(() => {});

        // Mock downloader
        (downloader.downloadAvatar as any).mockImplementation(async (url: string, type: string, id: string) => {
            if (type === 'global') return `/avatars/${id}.png`;
            if (type === 'server') return `/servers/${mockServerId}/avatars/${id}.png`;
            return null;
        });

        // Run importer
        await importDirectory(mockDir, 'Test Server');

        // 1. Verify Node Query (Global Identities)
        expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
            expect.stringContaining('INSERT OR IGNORE INTO imported_discord_users'),
            ['member1', 'User One', '/avatars/member1.png']
        );
        expect(dbManager.runNodeQuery).toHaveBeenCalledWith(
            expect.stringContaining('INSERT OR IGNORE INTO imported_discord_users'),
            ['member2', 'user2', '/avatars/member2.png']
        );

        // 2. Verify Server Query (Profiles)
        expect(dbManager.runBatch).toHaveBeenCalledWith(
            mockServerId,
            expect.stringContaining('INSERT OR REPLACE INTO profiles'),
            expect.arrayContaining([
                expect.arrayContaining(['member1', mockServerId, 'user1', 'The First One', '/servers/123456789/avatars/member1.png']),
                expect.arrayContaining(['member2', mockServerId, 'user2', 'user2', '/servers/123456789/avatars/member2.png'])
            ])
        );
        
        console.log('✅ Importer V2 unit test passed validation of field separation and avatar fallback.');
    });
});
