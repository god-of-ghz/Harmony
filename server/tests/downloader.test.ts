import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadFile, downloadAvatar } from '../src/media/downloader';
import fs from 'fs';
import path from 'path';

vi.mock('fs', () => ({
    default: {
        rmSync: vi.fn(),
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        readFileSync: vi.fn(),
        accessSync: vi.fn(),
    }
}));

vi.mock('../src/database', () => ({
    DATA_DIR: 'mock_data_dir',
    SERVERS_DIR: 'mock_servers_dir',
    GUILDS_DIR: 'mock_servers_dir'
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Downloader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('downloadFile should write fetched content to disk', async () => {
        const mockArrayBuffer = new ArrayBuffer(8);
        mockFetch.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: () => Promise.resolve(mockArrayBuffer)
        });
        vi.mocked(fs.existsSync).mockReturnValue(true);

        await downloadFile('http://example.com/test.png', 'mock_data_dir/test.png');

        expect(mockFetch).toHaveBeenCalledWith('http://example.com/test.png');
        // It writes Buffer.from(arrayBuffer)
        expect(fs.writeFileSync).toHaveBeenCalledWith('mock_data_dir/test.png', expect.any(Buffer));
    });

    it('downloadFile should create directory if it does not exist', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
        });
        vi.mocked(fs.existsSync).mockReturnValue(false); // dir does not exist

        await downloadFile('http://example.com/test.png', 'mock_data_dir/some/dir/test.png');

        expect(fs.mkdirSync).toHaveBeenCalledWith('mock_data_dir/some/dir', { recursive: true });
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('downloadFile should throw on non-200 response', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 404
        });

        await expect(downloadFile('http://example.com/missing.png', 'path.png')).rejects.toThrow('Failed to download');
    });

    it('downloadAvatar global should save to DATA_DIR/avatars', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
        });
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const result = await downloadAvatar('http://example.com/avatar.png', 'global', 'acc1');
        
        expect(result).toBe('/avatars/acc1.png');
        expect(fs.writeFileSync).toHaveBeenCalledWith(path.join('mock_data_dir', 'avatars', 'acc1.png'), expect.any(Buffer));
    });

    it('downloadAvatar server should save to DATA_DIR/guilds/{id}/avatars', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
        });
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const result = await downloadAvatar('http://example.com/avatar.png', 'server', 'acc1', 'sv1');
        
        // P18 FIX: was 'servers' — data dir is now 'guilds'
        expect(result).toBe('/guilds/sv1/avatars/acc1.png');
        expect(fs.writeFileSync).toHaveBeenCalledWith(path.join('mock_data_dir', 'guilds', 'sv1', 'avatars', 'acc1.png'), expect.any(Buffer));
    });

    it('downloadAvatar returns null on empty URL', async () => {
        const result = await downloadAvatar('', 'global', 'acc1');
        expect(result).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('downloadAvatar returns null on fetch failure (does not throw)', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network disconnected'));

        const result = await downloadAvatar('http://example.com/err.png', 'global', 'acc1');
        
        expect(result).toBeNull();
    });

    it('downloadAvatar throws if type=server without serverId', async () => {
        await expect(downloadAvatar('http://example.com/img.png', 'server', 'acc1')).rejects.toThrow('serverId is required');
    });
});
