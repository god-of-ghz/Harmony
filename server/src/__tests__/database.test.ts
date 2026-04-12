import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import dbManager from '../database';

describe('Database Schema Updates', () => {
    let db: sqlite3.Database;

    beforeEach(() => {
        db = new sqlite3.Database(':memory:');
    });

    afterEach(() => {
        return new Promise<void>((resolve) => {
            db.close(() => resolve());
        });
    });

    it('should initialize the server database with new fields', async () => {
        // Run initialization
        await new Promise<void>((resolve) => {
            dbManager.initServerDb(db);
            // initServerDb uses db.serialize and db.run which are asynchronous
            // We need to wait for them to finish. 
            // Since there's no easy callback for the whole thing, we'll run a dummy query to wait.
            db.get('SELECT 1', () => resolve());
        });

        // Check servers table
        const serverCols = await new Promise<any[]>((resolve) => {
            db.all('PRAGMA table_info(servers)', (err, rows) => resolve(rows));
        });
        const serverColNames = serverCols.map(c => c.name);
        expect(serverColNames).toContain('owner_id');
        expect(serverColNames).toContain('description');

        // Check channels table
        const channelCols = await new Promise<any[]>((resolve) => {
            db.all('PRAGMA table_info(channels)', (err, rows) => resolve(rows));
        });
        const channelColNames = channelCols.map(c => c.name);
        expect(channelColNames).toContain('topic');
        expect(channelColNames).toContain('nsfw');

        // Check messages table
        const messageCols = await new Promise<any[]>((resolve) => {
            db.all('PRAGMA table_info(messages)', (err, rows) => resolve(rows));
        });
        const messageColNames = messageCols.map(c => c.name);
        expect(messageColNames).toContain('embeds');

        // Check server_emojis table
        const emojiCols = await new Promise<any[]>((resolve) => {
            db.all('PRAGMA table_info(server_emojis)', (err, rows) => resolve(rows));
        });
        expect(emojiCols.length).toBeGreaterThan(0);
        const emojiColNames = emojiCols.map(c => c.name);
        expect(emojiColNames).toContain('id');
        expect(emojiColNames).toContain('server_id');
        expect(emojiColNames).toContain('name');
        expect(emojiColNames).toContain('url');
        expect(emojiColNames).toContain('animated');
    });

    it('should handle backward compatibility (ALTER TABLE)', async () => {
        // Create old schema
        await new Promise<void>((resolve) => {
            db.serialize(() => {
                db.run('CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT, icon TEXT)');
                db.run('CREATE TABLE channels (id TEXT PRIMARY KEY, server_id TEXT, name TEXT)');
                db.run('CREATE TABLE messages (id TEXT PRIMARY KEY, channel_id TEXT, author_id TEXT, content TEXT, timestamp TEXT)');
                resolve();
            });
        });

        // Run initialization (should trigger ALTER TABLE)
        await new Promise<void>((resolve) => {
            dbManager.initServerDb(db);
            db.get('SELECT 1', () => resolve());
        });

        // Check new columns exist
        const serverCols = await new Promise<any[]>((resolve) => {
            db.all('PRAGMA table_info(servers)', (err, rows) => resolve(rows));
        });
        expect(serverCols.map(c => c.name)).toContain('owner_id');

        const channelCols = await new Promise<any[]>((resolve) => {
            db.all('PRAGMA table_info(channels)', (err, rows) => resolve(rows));
        });
        expect(channelCols.map(c => c.name)).toContain('topic');

        const messageCols = await new Promise<any[]>((resolve) => {
            db.all('PRAGMA table_info(messages)', (err, rows) => resolve(rows));
        });
        expect(messageCols.map(c => c.name)).toContain('embeds');
    });

    it('should successfully write and retrieve emoji data', async () => {
        await new Promise<void>((resolve) => {
            dbManager.initServerDb(db);
            db.get('SELECT 1', () => resolve());
        });

        // Insert a server first (for foreign key)
        await new Promise<void>((resolve, reject) => {
            db.run('INSERT INTO servers (id, name) VALUES (?, ?)', ['srv1', 'Test Server'], (err) => {
                if (err) reject(err); else resolve();
            });
        });

        // Insert emoji
        const emoji = {
            id: 'emoji1',
            server_id: 'srv1',
            name: 'thnk',
            url: 'http://example.com/think.png',
            animated: 1
        };

        await new Promise<void>((resolve, reject) => {
            db.run('INSERT INTO server_emojis (id, server_id, name, url, animated) VALUES (?, ?, ?, ?, ?)',
                [emoji.id, emoji.server_id, emoji.name, emoji.url, emoji.animated], (err) => {
                    if (err) reject(err); else resolve();
                });
        });

        // Retrieve emoji
        const row = await new Promise<any>((resolve, reject) => {
            db.get('SELECT * FROM server_emojis WHERE id = ?', [emoji.id], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });

        expect(row).toBeDefined();
        expect(row.name).toBe(emoji.name);
        expect(row.animated).toBe(1);
    });
});

describe('Node Database Schema Updates', () => {
    let db: sqlite3.Database;

    beforeEach(() => {
        db = new sqlite3.Database(':memory:');
        // Enable foreign keys for in-memory DB
        return new Promise<void>((resolve) => {
            db.run('PRAGMA foreign_keys = ON', () => resolve());
        });
    });

    afterEach(() => {
        return new Promise<void>((resolve) => {
            db.close(() => resolve());
        });
    });

    it('should initialize the node database with new fields and tables', async () => {
        await new Promise<void>((resolve) => {
            dbManager.initNodeDb(db);
            // Wait for all serialize blocks to finish
            db.get('SELECT 1', () => resolve());
        });

        // Check imported_discord_users table
        const discordUserCols = await new Promise<any[]>((resolve) => {
            db.all('PRAGMA table_info(imported_discord_users)', (err, rows) => resolve(rows));
        });
        const discordUserColNames = discordUserCols.map(c => c.name);
        expect(discordUserColNames).toContain('id');
        expect(discordUserColNames).toContain('global_name');
        expect(discordUserColNames).toContain('avatar');
        expect(discordUserColNames).toContain('account_id');

        // Check accounts table for dismissed_global_claim
        const accountCols = await new Promise<any[]>((resolve) => {
            db.all('PRAGMA table_info(accounts)', (err, rows) => resolve(rows));
        });
        const accountColNames = accountCols.map(c => c.name);
        expect(accountColNames).toContain('dismissed_global_claim');
    });

    it('should test ON DELETE SET NULL for imported_discord_users', async () => {
        await new Promise<void>((resolve) => {
            dbManager.initNodeDb(db);
            db.get('SELECT 1', () => resolve());
        });

        const accountId = 'acc-123';
        const discordUserId = 'discord-456';

        // Insert account
        await new Promise<void>((resolve, reject) => {
            db.run(`INSERT INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                    [accountId, 'test@test.com', 'v', 'pk', 'epk', 's', 'iv'], (err) => {
                if (err) reject(err); else resolve();
            });
        });

        // Insert discord user linked to account
        await new Promise<void>((resolve, reject) => {
            db.run(`INSERT INTO imported_discord_users (id, global_name, avatar, account_id) 
                    VALUES (?, ?, ?, ?)`, 
                    [discordUserId, 'GlobalName', 'avatar_url', accountId], (err) => {
                if (err) reject(err); else resolve();
            });
        });

        // Verify insertion
        const initialRow = await new Promise<any>((resolve) => {
            db.get('SELECT account_id FROM imported_discord_users WHERE id = ?', [discordUserId], (err, row) => resolve(row));
        });
        expect(initialRow.account_id).toBe(accountId);

        // Delete account and check cascade
        await new Promise<void>((resolve, reject) => {
            db.run('DELETE FROM accounts WHERE id = ?', [accountId], (err) => {
                if (err) reject(err); else resolve();
            });
        });

        const finalRow = await new Promise<any>((resolve) => {
            db.get('SELECT account_id FROM imported_discord_users WHERE id = ?', [discordUserId], (err, row) => resolve(row));
        });
        expect(finalRow.account_id).toBeNull();
    });
});
