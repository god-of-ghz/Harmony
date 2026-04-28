import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dbManager, { executeRun, executeGet, executeAll } from '../database';
import type { GuildRegistryEntry, ProvisionCodeEntry } from '../database';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an in-memory node DB with all P02 tables initialised. */
function initTestNodeDb(db: sqlite3.Database): Promise<void> {
  return new Promise((resolve) => {
    dbManager.initNodeDb(db);
    // serialize + callback-based API — run a dummy query to wait for completion
    db.get('SELECT 1', () => resolve());
  });
}

/** Insert a minimal account row so foreign-key constraints are satisfied. */
function insertAccount(db: sqlite3.Database, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, `${id}@test.com`, 'salt:hash', 'pk', 'epk', 's', 'iv'],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function rmrf(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1. Guild Registration
// ---------------------------------------------------------------------------
describe('Guild Registry', () => {
  let db: sqlite3.Database;

  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');
    await new Promise<void>((r) => db.run('PRAGMA foreign_keys = ON', () => r()));
    await initTestNodeDb(db);
  });

  afterEach(() => new Promise<void>((r) => db.close(() => r())));

  it('should register a guild and retrieve all fields', async () => {
    await insertAccount(db, 'owner-1');

    await executeRun(db,
      `INSERT INTO guilds (id, name, owner_account_id, fingerprint, provision_code, max_members)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['guild-1', 'Test Guild', 'owner-1', 'fp-abc', null, 50]
    );

    const entry = await executeGet<GuildRegistryEntry>(db, `SELECT * FROM guilds WHERE id = ?`, ['guild-1']);
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('guild-1');
    expect(entry!.name).toBe('Test Guild');
    expect(entry!.owner_account_id).toBe('owner-1');
    expect(entry!.fingerprint).toBe('fp-abc');
    expect(entry!.status).toBe('active');
    expect(entry!.provision_code).toBeNull();
    expect(entry!.max_members).toBe(50);
    expect(entry!.created_at).toBeGreaterThan(0);
    expect(entry!.icon).toBe('');
    expect(entry!.description).toBe('');
  });

  it('should update guild status to suspended', async () => {
    await insertAccount(db, 'owner-2');
    await executeRun(db,
      `INSERT INTO guilds (id, name, owner_account_id, fingerprint) VALUES (?, ?, ?, ?)`,
      ['guild-2', 'Guild 2', 'owner-2', '']
    );

    await executeRun(db, `UPDATE guilds SET status = ? WHERE id = ?`, ['suspended', 'guild-2']);

    const entry = await executeGet<GuildRegistryEntry>(db, `SELECT * FROM guilds WHERE id = ?`, ['guild-2']);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('suspended');
  });

  it('should reject invalid status values', async () => {
    await insertAccount(db, 'owner-3');
    await executeRun(db,
      `INSERT INTO guilds (id, name, owner_account_id, fingerprint) VALUES (?, ?, ?, ?)`,
      ['guild-3', 'Guild 3', 'owner-3', '']
    );

    await expect(
      executeRun(db, `UPDATE guilds SET status = ? WHERE id = ?`, ['invalid_status', 'guild-3'])
    ).rejects.toThrow();
  });

  it('should delete a guild registry entry', async () => {
    await insertAccount(db, 'owner-4');
    await executeRun(db,
      `INSERT INTO guilds (id, name, owner_account_id, fingerprint) VALUES (?, ?, ?, ?)`,
      ['guild-4', 'Guild 4', 'owner-4', '']
    );

    await executeRun(db, `DELETE FROM guilds WHERE id = ?`, ['guild-4']);

    const entry = await executeGet<GuildRegistryEntry>(db, `SELECT * FROM guilds WHERE id = ?`, ['guild-4']);
    expect(entry).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Provision Codes
// ---------------------------------------------------------------------------
describe('Provision Codes', () => {
  let db: sqlite3.Database;

  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');
    await new Promise<void>((r) => db.run('PRAGMA foreign_keys = ON', () => r()));
    await initTestNodeDb(db);
    await insertAccount(db, 'operator-1');
    await insertAccount(db, 'user-1');
  });

  afterEach(() => new Promise<void>((r) => db.close(() => r())));

  it('should create, validate, and consume a provision code', async () => {
    // Create
    const code = 'abcd1234abcd1234abcd1234abcd1234';
    await executeRun(db,
      `INSERT INTO guild_provision_codes (code, created_by, max_members) VALUES (?, ?, ?)`,
      [code, 'operator-1', 100]
    );

    // Validate (unused)
    const unused = await executeGet<ProvisionCodeEntry>(db,
      `SELECT * FROM guild_provision_codes WHERE code = ?`, [code]
    );
    expect(unused).toBeDefined();
    expect(unused!.used_by).toBeNull();
    expect(unused!.created_by).toBe('operator-1');
    expect(unused!.max_members).toBe(100);

    // Create a guild to reference
    await executeRun(db,
      `INSERT INTO guilds (id, name, owner_account_id, fingerprint) VALUES (?, ?, ?, ?)`,
      ['guild-from-code', 'Code Guild', 'user-1', '']
    );

    // Consume
    const now = Math.floor(Date.now() / 1000);
    await executeRun(db,
      `UPDATE guild_provision_codes SET used_by = ?, used_at = ?, resulting_guild_id = ? WHERE code = ?`,
      ['user-1', now, 'guild-from-code', code]
    );

    // Validate (consumed)
    const consumed = await executeGet<ProvisionCodeEntry>(db,
      `SELECT * FROM guild_provision_codes WHERE code = ?`, [code]
    );
    expect(consumed).toBeDefined();
    expect(consumed!.used_by).toBe('user-1');
    expect(consumed!.resulting_guild_id).toBe('guild-from-code');
  });

  it('should detect expired provision codes', async () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const code = 'expired0expired0expired0expired0';
    await executeRun(db,
      `INSERT INTO guild_provision_codes (code, created_by, expires_at) VALUES (?, ?, ?)`,
      [code, 'operator-1', pastTimestamp]
    );

    const entry = await executeGet<ProvisionCodeEntry>(db,
      `SELECT * FROM guild_provision_codes WHERE code = ?`, [code]
    );
    expect(entry).toBeDefined();
    expect(entry!.expires_at).toBeLessThan(Math.floor(Date.now() / 1000));
  });

  it('should revoke a provision code by deleting it', async () => {
    const code = 'revoked0revoked0revoked0revoked0';
    await executeRun(db,
      `INSERT INTO guild_provision_codes (code, created_by) VALUES (?, ?)`,
      [code, 'operator-1']
    );

    // Revoke
    await executeRun(db, `DELETE FROM guild_provision_codes WHERE code = ?`, [code]);

    const entry = await executeGet<ProvisionCodeEntry>(db,
      `SELECT * FROM guild_provision_codes WHERE code = ?`, [code]
    );
    expect(entry).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Node Settings
// ---------------------------------------------------------------------------
describe('Node Settings', () => {
  let db: sqlite3.Database;

  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');
    await new Promise<void>((r) => db.run('PRAGMA foreign_keys = ON', () => r()));
    await initTestNodeDb(db);
  });

  afterEach(() => new Promise<void>((r) => db.close(() => r())));

  it('should seed default settings', async () => {
    const rows = await executeAll<{ key: string; value: string }>(db, `SELECT * FROM node_settings`);
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    expect(settings['allow_open_guild_creation']).toBe('false');
    expect(settings['default_max_members']).toBe('0');
    expect(settings['max_guilds']).toBe('0');
  });

  it('should default allow_open_guild_creation to false', async () => {
    const row = await executeGet<{ value: string }>(db,
      `SELECT value FROM node_settings WHERE key = ?`, ['allow_open_guild_creation']
    );
    expect(row).toBeDefined();
    expect(row!.value).toBe('false');
  });

  it('should update a setting and persist the change', async () => {
    await executeRun(db,
      `INSERT OR REPLACE INTO node_settings (key, value) VALUES (?, ?)`,
      ['allow_open_guild_creation', 'true']
    );

    const row = await executeGet<{ value: string }>(db,
      `SELECT value FROM node_settings WHERE key = ?`, ['allow_open_guild_creation']
    );
    expect(row).toBeDefined();
    expect(row!.value).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// 4. DatabaseManager helper methods (using the real singleton)
// ---------------------------------------------------------------------------
describe('DatabaseManager Guild Registry helpers', () => {
  // These tests use the singleton's nodeDb, so we ensure the tables exist
  // by calling initNodeDb on it. The singleton's nodeDb is already open.

  beforeEach(async () => {
    // Ensure tables exist (idempotent)
    await new Promise<void>((resolve) => {
      dbManager.initNodeDb(dbManager.nodeDb);
      dbManager.nodeDb.get('SELECT 1', () => resolve());
    });

    // Insert a test account
    await dbManager.runNodeQuery(
      `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['helper-owner', 'helper@test.com', 'salt:hash', 'pk', 'epk', 's', 'iv']
    );
  });

  afterEach(async () => {
    // Clean up test data
    await dbManager.runNodeQuery(`DELETE FROM guilds WHERE owner_account_id = 'helper-owner'`);
    await dbManager.runNodeQuery(`DELETE FROM guild_provision_codes WHERE created_by = 'helper-owner'`);
    await dbManager.runNodeQuery(`DELETE FROM accounts WHERE id = 'helper-owner'`);
  });

  it('registerGuild + getGuildRegistryEntry', async () => {
    await dbManager.registerGuild('hg-1', 'Helper Guild', 'helper-owner', 'fp-123');
    const entry = await dbManager.getGuildRegistryEntry('hg-1');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Helper Guild');
    expect(entry!.owner_account_id).toBe('helper-owner');
    expect(entry!.fingerprint).toBe('fp-123');
    expect(entry!.status).toBe('active');
  });

  it('getAllRegisteredGuilds returns registered entries', async () => {
    await dbManager.registerGuild('hg-a', 'Guild A', 'helper-owner', '');
    await dbManager.registerGuild('hg-b', 'Guild B', 'helper-owner', '');
    const all = await dbManager.getAllRegisteredGuilds();
    const ids = all.map((g) => g.id);
    expect(ids).toContain('hg-a');
    expect(ids).toContain('hg-b');
  });

  it('updateGuildStatus changes status', async () => {
    await dbManager.registerGuild('hg-status', 'Status Guild', 'helper-owner', '');
    await dbManager.updateGuildStatus('hg-status', 'suspended');
    const entry = await dbManager.getGuildRegistryEntry('hg-status');
    expect(entry!.status).toBe('suspended');
  });

  it('deleteGuildRegistryEntry removes the row', async () => {
    await dbManager.registerGuild('hg-del', 'Del Guild', 'helper-owner', '');
    await dbManager.deleteGuildRegistryEntry('hg-del');
    const entry = await dbManager.getGuildRegistryEntry('hg-del');
    expect(entry).toBeUndefined();
  });
});

describe('DatabaseManager Provision Code helpers', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      dbManager.initNodeDb(dbManager.nodeDb);
      dbManager.nodeDb.get('SELECT 1', () => resolve());
    });

    await dbManager.runNodeQuery(
      `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['pc-operator', 'pcop@test.com', 'salt:hash', 'pk', 'epk', 's', 'iv']
    );
    await dbManager.runNodeQuery(
      `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['pc-user', 'pcuser@test.com', 'salt:hash', 'pk', 'epk', 's', 'iv']
    );
  });

  afterEach(async () => {
    await dbManager.runNodeQuery(`DELETE FROM guild_provision_codes WHERE created_by = 'pc-operator'`);
    await dbManager.runNodeQuery(`DELETE FROM guilds WHERE owner_account_id IN ('pc-operator', 'pc-user')`);
    await dbManager.runNodeQuery(`DELETE FROM accounts WHERE id IN ('pc-operator', 'pc-user')`);
  });

  it('createProvisionCode returns a 32-char hex code', async () => {
    const code = await dbManager.createProvisionCode('pc-operator');
    expect(code).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(code)).toBe(true);
  });

  it('full lifecycle: create → validate → consume → validate again', async () => {
    const code = await dbManager.createProvisionCode('pc-operator', undefined, 200, 'Test Label');

    // Validate (valid)
    const result1 = await dbManager.validateProvisionCode(code);
    expect(result1.valid).toBe(true);
    expect(result1.code!.label).toBe('Test Label');
    expect(result1.code!.max_members).toBe(200);

    // Register a guild to reference
    await dbManager.registerGuild('pc-guild', 'PC Guild', 'pc-user', '');

    // Consume
    await dbManager.consumeProvisionCode(code, 'pc-user', 'pc-guild');

    // Validate (consumed → invalid)
    const result2 = await dbManager.validateProvisionCode(code);
    expect(result2.valid).toBe(false);
    expect(result2.error).toBe('Code already consumed');
  });

  it('validates expired code correctly', async () => {
    const pastTs = Math.floor(Date.now() / 1000) - 3600;
    const code = await dbManager.createProvisionCode('pc-operator', pastTs);

    const result = await dbManager.validateProvisionCode(code);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Code expired');
  });

  it('validates non-existent code correctly', async () => {
    const result = await dbManager.validateProvisionCode('nonexistent_code_value_here_1234');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Code not found');
  });

  it('revokeProvisionCode removes the code', async () => {
    const code = await dbManager.createProvisionCode('pc-operator');
    await dbManager.revokeProvisionCode(code);

    const result = await dbManager.validateProvisionCode(code);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Code not found');
  });

  it('getProvisionCodes filters by creator', async () => {
    await dbManager.createProvisionCode('pc-operator', undefined, 0, 'A');
    await dbManager.createProvisionCode('pc-operator', undefined, 0, 'B');

    const byCreator = await dbManager.getProvisionCodes('pc-operator');
    expect(byCreator.length).toBeGreaterThanOrEqual(2);

    const all = await dbManager.getProvisionCodes();
    expect(all.length).toBeGreaterThanOrEqual(byCreator.length);
  });
});

describe('DatabaseManager Node Settings helpers', () => {
  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      dbManager.initNodeDb(dbManager.nodeDb);
      dbManager.nodeDb.get('SELECT 1', () => resolve());
    });
  });

  it('getNodeSetting returns seeded defaults', async () => {
    const val = await dbManager.getNodeSetting('allow_open_guild_creation');
    expect(val).toBe('false');
  });

  it('setNodeSetting updates and persists', async () => {
    await dbManager.setNodeSetting('allow_open_guild_creation', 'true');
    const val = await dbManager.getNodeSetting('allow_open_guild_creation');
    expect(val).toBe('true');

    // Reset for other tests
    await dbManager.setNodeSetting('allow_open_guild_creation', 'false');
  });

  it('getAllNodeSettings returns all settings as a record', async () => {
    const settings = await dbManager.getAllNodeSettings();
    expect(settings).toHaveProperty('allow_open_guild_creation');
    expect(settings).toHaveProperty('default_max_members');
    expect(settings).toHaveProperty('max_guilds');
  });

  it('getNodeSetting returns undefined for unknown keys', async () => {
    const val = await dbManager.getNodeSetting('totally_nonexistent_key');
    expect(val).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. initializeGuildBundle auto-registration
// ---------------------------------------------------------------------------
describe('initializeGuildBundle guild registry integration', () => {
  const guildId = 'bundle-reg-guild';

  // Generate a real Ed25519 keypair for the test owner
  const ownerKeypair = crypto.generateKeyPairSync('ed25519');
  const ownerPubKeyBase64 = ownerKeypair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      dbManager.initNodeDb(dbManager.nodeDb);
      dbManager.nodeDb.get('SELECT 1', () => resolve());
    });

    await dbManager.runNodeQuery(
      `INSERT OR IGNORE INTO accounts (id, email, auth_verifier, public_key, encrypted_private_key, key_salt, key_iv)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['bundle-owner', 'bundle@test.com', 'salt:hash', ownerPubKeyBase64, 'epk', 's', 'iv']
    );
  });

  afterEach(async () => {
    try { dbManager.unloadGuildInstance(guildId); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 100)); // Let SQLite release file locks
    await dbManager.runNodeQuery(`DELETE FROM guilds WHERE id = ?`, [guildId]);
    await dbManager.runNodeQuery(`DELETE FROM accounts WHERE id = 'bundle-owner'`);

    // Clean up the guild directory on disk
    const { GUILDS_DIR } = await import('../database');
    try { rmrf(path.join(GUILDS_DIR, guildId)); } catch { /* ignore EBUSY on Windows */ }
  });

  it('should register guild in node.db when ownerId is provided', async () => {
    await dbManager.initializeGuildBundle(guildId, 'Bundle Guild', '', 'bundle-owner', '', ownerPubKeyBase64);

    // Wait for async DB init
    await new Promise((r) => setTimeout(r, 200));

    const entry = await dbManager.getGuildRegistryEntry(guildId);
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Bundle Guild');
    expect(entry!.owner_account_id).toBe('bundle-owner');
    // Fingerprint is now auto-generated — just verify it's non-empty
    expect(entry!.fingerprint).toBeTruthy();
    expect(entry!.fingerprint.length).toBe(32);
    expect(entry!.status).toBe('active');
  });

  it('should NOT register guild in node.db when ownerId is empty', async () => {
    const noOwnerGuildId = 'bundle-no-owner';
    await dbManager.initializeGuildBundle(noOwnerGuildId, 'No Owner Guild');

    await new Promise((r) => setTimeout(r, 200));

    const entry = await dbManager.getGuildRegistryEntry(noOwnerGuildId);
    expect(entry).toBeUndefined();

    // Clean up
    try { dbManager.unloadGuildInstance(noOwnerGuildId); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 100));
    const { GUILDS_DIR } = await import('../database');
    try { rmrf(path.join(GUILDS_DIR, noOwnerGuildId)); } catch { /* ignore EBUSY on Windows */ }
  });
});

