import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../database';

/**
 * Downloads a file from a URL and saves it to the specified path.
 * Returns the final local path if successful.
 */
export async function downloadFile(url: string, destPath: string): Promise<string> {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);
    return destPath;
}

/**
 * Ensures an avatar is downloaded and saved to Harmony storage.
 * @param avatarUrl Remote URL
 * @param type 'global' or 'server'
 * @param id User ID
 * @param serverId Server ID (required if type is 'server')
 */
export async function downloadAvatar(avatarUrl: string, type: 'global' | 'server', id: string, serverId?: string): Promise<string | null> {
    if (!avatarUrl) return null;

    let destPath: string;
    let relativePath: string;

    let ext = '.png';
    try {
        const urlObj = new URL(avatarUrl);
        ext = path.extname(urlObj.pathname) || '.png';
    } catch (e) {
        // Fallback for weird URLs
    }
    
    if (type === 'global') {
        const avatarsDir = path.join(DATA_DIR, 'avatars');
        destPath = path.join(avatarsDir, `${id}${ext}`);
        relativePath = `/avatars/${id}${ext}`;
    } else {
        if (!serverId) throw new Error('serverId is required for server avatars');
        // P18 FIX: was 'servers' — data dir is now 'guilds'
        const serverAvatarsDir = path.join(DATA_DIR, 'guilds', serverId, 'avatars');
        destPath = path.join(serverAvatarsDir, `${id}${ext}`);
        relativePath = `/guilds/${serverId}/avatars/${id}${ext}`;
    }

    try {
        await downloadFile(avatarUrl, destPath);
        return relativePath;
    } catch (err) {
        console.error(`Failed to download avatar from ${avatarUrl}:`, err);
        return null;
    }
}
