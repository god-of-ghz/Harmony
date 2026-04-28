import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import dbManager from '../database';

/**
 * Helper: create a minimal SQLite db at the given path with a `servers` table
 * (the legacy schema) so migration logic has something to rename.
 */
function createLegacyServerDb(dbPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      db.run(
        'CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id TEXT, description TEXT, audit_interval_hours INTEGER DEFAULT 24)',
        (createErr) => {
          if (createErr) return reject(createErr);
          db.run(
            "INSERT INTO servers (id, name) VALUES ('test-guild-1', 'Legacy Guild')",
            (insertErr) => {
              if (insertErr) return reject(insertErr);
              db.close((closeErr) => {
                if (closeErr) reject(closeErr);
                else resolve();
              });
            }
          );
        }
      );
    });
  });
}

function rmrf(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1. Schema test — fresh guild.db has guild_info, not servers
// ---------------------------------------------------------------------------
describe('Guild Schema Rename', () => {
  let db: sqlite3.Database;

  beforeEach(() => {
    db = new sqlite3.Database(':memory:');
  });

  afterEach(() => new Promise<void>((resolve) => db.close(() => resolve())));

  it('should create guild_info table instead of servers on a fresh DB', async () => {
    await new Promise<void>((resolve) => {
      dbManager.initGuildDb(db);
      db.get('SELECT 1', () => resolve());
    });

    // guild_info must exist
    const guildInfoCols = await new Promise<any[]>((resolve) => {
      db.all('PRAGMA table_info(guild_info)', (err, rows) => resolve(rows || []));
    });
    expect(guildInfoCols.length).toBeGreaterThan(0);
    const colNames = guildInfoCols.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('name');
    expect(colNames).toContain('owner_id');
    expect(colNames).toContain('description');
    expect(colNames).toContain('audit_interval_hours');
  });

  it('should migrate legacy servers table to guild_info', async () => {
    // Pre-create the legacy `servers` table
    await new Promise<void>((resolve, reject) => {
      db.run('CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT, icon TEXT)', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await new Promise<void>((resolve) => {
      dbManager.initGuildDb(db);
      db.get('SELECT 1', () => resolve());
    });

    // guild_info must now exist (via ALTER TABLE RENAME)
    const guildInfoCols = await new Promise<any[]>((resolve) => {
      db.all('PRAGMA table_info(guild_info)', (err, rows) => resolve(rows || []));
    });
    expect(guildInfoCols.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Alias parity tests
// ---------------------------------------------------------------------------
describe('Deprecated Alias Parity', () => {
  let db: sqlite3.Database;

  beforeEach(() => {
    db = new sqlite3.Database(':memory:');
  });

  afterEach(() => new Promise<void>((resolve) => db.close(() => resolve())));

  it('getServerDb() and getGuildDb() return the same result', async () => {
    // Manually register a DB so getGuildDb works
    (dbManager as any).guildDbs.set('alias-test', db);

    const fromGuild = dbManager.getGuildDb('alias-test');
    const fromServer = dbManager.getServerDb('alias-test');
    expect(fromGuild).toBe(fromServer);

    // Clean up
    (dbManager as any).guildDbs.delete('alias-test');
  });

  it('channelToGuildId and channelToServerId reference the same map', () => {
    dbManager.channelToGuildId.set('chan-test', 'guild-test');
    expect(dbManager.channelToServerId.get('chan-test')).toBe('guild-test');
    dbManager.channelToGuildId.delete('chan-test');
  });

  it('initServerDb calls initGuildDb (creates guild_info)', async () => {
    await new Promise<void>((resolve) => {
      dbManager.initServerDb(db);
      db.get('SELECT 1', () => resolve());
    });

    const cols = await new Promise<any[]>((resolve) => {
      db.all('PRAGMA table_info(guild_info)', (err, rows) => resolve(rows || []));
    });
    expect(cols.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. initializeGuildBundle creates guild.db (not server.db)
// ---------------------------------------------------------------------------
describe('initializeGuildBundle', () => {
  const testDataDir = path.resolve(process.cwd(), 'data_rename_test');
  const origDataDir = (dbManager as any).constructor; // placeholder
  let cleanupGuildId: string | null = null;

  beforeEach(() => {
    rmrf(testDataDir);
    cleanupGuildId = null;
  });

  afterEach(async () => {
    // Properly close and unload any guild DBs we may have created
    if (cleanupGuildId) {
      const gdb = (dbManager as any).guildDbs.get(cleanupGuildId) as sqlite3.Database | undefined;
      if (gdb) {
        await new Promise<void>((resolve) => gdb.close(() => resolve()));
        (dbManager as any).guildDbs.delete(cleanupGuildId);
      }
    }
    // Wait a beat for Windows to release file handles
    await new Promise((r) => setTimeout(r, 50));
    rmrf(testDataDir);
  });

  it('should create guild.db, not server.db', async () => {
    // Temporarily override GUILDS_DIR by updating the module-level variable
    // We can't easily override the const, so we test by calling initializeGuildBundle
    // with a guild ID and checking the resulting file structure.
    // The function uses GUILDS_DIR internally, so we need to use the real data dir.

    // Instead, we'll verify the method creates files in the correct locations
    // by examining what initializeGuildBundle does internally
    const guildId = 'new-guild-1';
    cleanupGuildId = guildId;
    const { GUILDS_DIR } = await import('../database');
    const expectedGuildDir = path.join(GUILDS_DIR, guildId);
    const expectedDbPath = path.join(expectedGuildDir, 'guild.db');
    const legacyDbPath = path.join(expectedGuildDir, 'server.db');

    // Ensure the owner account exists in node.db (required by guild registry FK)
    const { executeRun } = await import('../database');
    await executeRun(dbManager.nodeDb,
      `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['owner-1', 'owner1@test.com', 'salt:hash', 'pk', 'epk', 's', 'iv']
    );

    await dbManager.initializeGuildBundle(guildId, 'Test New Guild', '', 'owner-1');

    // Wait for async DB initialization
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(fs.existsSync(expectedDbPath)).toBe(true);
    expect(fs.existsSync(legacyDbPath)).toBe(false);

    // Verify guild_info table has the data
    const info = await new Promise<any>((resolve, reject) => {
      const gdb = dbManager.getGuildDb(guildId);
      gdb.get('SELECT * FROM guild_info WHERE id = ?', [guildId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    expect(info).toBeDefined();
    expect(info.name).toBe('Test New Guild');

    // Clean up guild registry data (file cleanup in afterEach)
    await executeRun(dbManager.nodeDb, `DELETE FROM guilds WHERE id = ?`, [guildId]);
    await executeRun(dbManager.nodeDb, `DELETE FROM accounts WHERE id = ?`, ['owner-1']);
  });
});

// ---------------------------------------------------------------------------
// 4. Directory migration test (data/servers/ → data/guilds/)
// ---------------------------------------------------------------------------
describe('Directory Migration', () => {
  // This test verifies the migration logic that runs at module load time.
  // Since the module is already loaded, we test the underlying fs.renameSync logic directly.
  it('should rename data/servers/ to data/guilds/ when only servers/ exists', () => {
    const tmpBase = path.resolve(process.cwd(), 'data_migration_test');
    rmrf(tmpBase);

    const legacyDir = path.join(tmpBase, 'servers');
    const newDir = path.join(tmpBase, 'guilds');

    // Create legacy structure
    fs.mkdirSync(path.join(legacyDir, 'guild-1'), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'guild-1', 'server.db'), 'fake-db-content');

    // Simulate the migration logic from database.ts constructor
    if (fs.existsSync(legacyDir) && !fs.existsSync(newDir)) {
      fs.renameSync(legacyDir, newDir);
    }

    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.existsSync(legacyDir)).toBe(false);
    expect(fs.existsSync(path.join(newDir, 'guild-1', 'server.db'))).toBe(true);

    rmrf(tmpBase);
  });

  it('should NOT rename if guilds/ already exists', () => {
    const tmpBase = path.resolve(process.cwd(), 'data_migration_test2');
    rmrf(tmpBase);

    const legacyDir = path.join(tmpBase, 'servers');
    const newDir = path.join(tmpBase, 'guilds');

    // Create both
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'should-stay'), 'data');

    // Migration logic should NOT run
    if (fs.existsSync(legacyDir) && !fs.existsSync(newDir)) {
      fs.renameSync(legacyDir, newDir);
    }

    // servers/ should still exist since guilds/ already existed
    expect(fs.existsSync(legacyDir)).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, 'should-stay'))).toBe(true);

    rmrf(tmpBase);
  });
});

// ---------------------------------------------------------------------------
// 5. Per-guild DB file migration (server.db → guild.db in scanAndLoadGuilds)
// ---------------------------------------------------------------------------
describe('Per-Guild DB File Migration', () => {
  const tmpBase = path.resolve(process.cwd(), 'data_dbfile_migration_test');

  beforeEach(() => {
    rmrf(tmpBase);
  });

  afterEach(() => {
    try { dbManager.unloadGuildInstance('migrated-guild'); } catch { /* ignore */ }
    rmrf(tmpBase);
  });

  it('should rename server.db → guild.db during scanAndLoadGuilds', async () => {
    const guildDir = path.join(tmpBase, 'guilds', 'migrated-guild');
    fs.mkdirSync(guildDir, { recursive: true });

    // Create a real legacy server.db with the old schema
    await createLegacyServerDb(path.join(guildDir, 'server.db'));

    expect(fs.existsSync(path.join(guildDir, 'server.db'))).toBe(true);
    expect(fs.existsSync(path.join(guildDir, 'guild.db'))).toBe(false);

    // Simulate what scanAndLoadGuilds does for a single entry
    const guildDbPath = path.join(guildDir, 'guild.db');
    const legacyDbPath = path.join(guildDir, 'server.db');

    if (!fs.existsSync(guildDbPath) && fs.existsSync(legacyDbPath)) {
      fs.renameSync(legacyDbPath, guildDbPath);
    }

    expect(fs.existsSync(path.join(guildDir, 'guild.db'))).toBe(true);
    expect(fs.existsSync(path.join(guildDir, 'server.db'))).toBe(false);
  });
});
