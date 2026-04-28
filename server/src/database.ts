import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { generateGuildIdentity, loadGuildPublicIdentity } from './crypto/guild_identity';

// ---------------------------------------------------------------------------
// Interfaces for node-level registry tables
// ---------------------------------------------------------------------------

export interface GuildRegistryEntry {
    id: string;
    name: string;
    icon: string;
    description: string;
    owner_account_id: string;
    fingerprint: string;
    status: 'active' | 'suspended' | 'stopped';
    provision_code: string | null;
    max_members: number;
    created_at: number;
}

export interface ProvisionCodeEntry {
    code: string;
    label: string;
    created_by: string;
    created_at: number;
    expires_at: number | null;
    max_members: number;
    used_by: string | null;
    used_at: number | null;
    resulting_guild_id: string | null;
}

const portArgIndex = process.argv.indexOf('--port');
const portArgValue = portArgIndex !== -1 ? process.argv[portArgIndex + 1] : null;
const portEqualsArg = process.argv.find(arg => arg.startsWith('--port='));
const portEqualsValue = portEqualsArg ? portEqualsArg.split('=')[1] : null;
const isNumberArg = process.argv.slice(2).find(arg => !isNaN(Number(arg)) && arg.length >= 4);

const isMock = process.argv.indexOf('--mock') !== -1;
const mockDataDir = path.resolve(process.cwd(), 'data_mock');
const defaultDataDir = path.resolve(process.cwd(), 'data');

// Base data directory
export let DATA_DIR = process.env.HARMONY_DATA_DIR || (isMock ? mockDataDir : defaultDataDir);

const PORT = portEqualsValue || portArgValue || isNumberArg || process.env.PORT || 3001;

export const GUILDS_DIR = path.join(DATA_DIR, 'guilds');
/** @deprecated Use GUILDS_DIR instead */
export const SERVERS_DIR = GUILDS_DIR;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Migration: rename data/servers/ → data/guilds/
const legacyServersDir = path.join(DATA_DIR, 'servers');
if (fs.existsSync(legacyServersDir) && !fs.existsSync(GUILDS_DIR)) {
  fs.renameSync(legacyServersDir, GUILDS_DIR);
  console.log('[MIGRATION] Renamed data/servers/ → data/guilds/');
}
if (!fs.existsSync(GUILDS_DIR)) fs.mkdirSync(GUILDS_DIR, { recursive: true });

// Determine node DB filename based on port to allow multiple testing nodes locally
const nodeDbFileName = (PORT === 3001 || PORT === '3001') ? 'node.db' : `node_${PORT}.db`;
export const nodeDbPath = path.join(DATA_DIR, nodeDbFileName);

const dmsDbFileName = (PORT === 3001 || PORT === '3001') ? 'dms.db' : `dms_${PORT}.db`;
export const dmsDbPath = path.join(DATA_DIR, dmsDbFileName);

// Wrapping SQLite methods in Promises
export const executeRun = (dbObj: sqlite3.Database, sql: string, params: any[] = []): Promise<void> => {
  return new Promise((resolve, reject) => {
    dbObj.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
};

export const executeGet = <T>(dbObj: sqlite3.Database, sql: string, params: any[] = []): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    dbObj.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T);
    });
  });
};

export const executeAll = <T>(dbObj: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    dbObj.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
};

class DatabaseManager {
  public nodeDb: sqlite3.Database;
  public dmsDb: sqlite3.Database;
  private guildDbs: Map<string, sqlite3.Database> = new Map();
  public channelToGuildId: Map<string, string> = new Map();

  /** @deprecated Use guildDbs instead */
  public get serverDbs(): Map<string, sqlite3.Database> { return this.guildDbs; }
  /** @deprecated Use channelToGuildId instead */
  public get channelToServerId(): Map<string, string> { return this.channelToGuildId; }

  constructor() {
    this.nodeDb = new sqlite3.Database(nodeDbPath, (err) => {
      if (err) console.error('Error opening Node database', err);
      else {
        console.log('Connected to Node database at', nodeDbPath);
        this.nodeDb.run('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;', (pragmaErr) => {
            if (pragmaErr) console.error('Failed to enable PRAGMAs on Node DB', pragmaErr);
            this.initNodeDb();
            // NOTE: scanAndLoadGuilds() is called at the end of initNodeDb()
            // to avoid a race condition with CREATE TABLE statements.
        });
      }
    });

    this.dmsDb = new sqlite3.Database(dmsDbPath, (err) => {
      if (err) console.error('Error opening DMs database', err);
      else {
        console.log('Connected to DMs database at', dmsDbPath);
        this.dmsDb.run('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;', (pragmaErr) => {
            if (pragmaErr) console.error('Failed to enable PRAGMAs on DMs DB', pragmaErr);
            this.initDmsDb();
        });
      }
    });
  }

  public initNodeDb(dbObj: sqlite3.Database = this.nodeDb) {
    dbObj.serialize(() => {
      dbObj.run(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          auth_verifier TEXT NOT NULL,
          public_key TEXT NOT NULL,
          encrypted_private_key TEXT NOT NULL,
          key_salt TEXT NOT NULL,
          key_iv TEXT NOT NULL,
          auth_salt TEXT DEFAULT '',
          is_creator BOOLEAN DEFAULT 0,
          is_admin BOOLEAN DEFAULT 0,
          -- TODO [VISION:Beta] authority_role defaults to 'primary', which means independent
          -- signups on different servers create multiple primaries with no delegation chain.
          -- Beta must either enforce single-primary or formally design multi-primary resolution.
          -- See HARMONY_VISION.md "Note on multi-primary" for context.
          authority_role TEXT DEFAULT 'primary',
          primary_server_url TEXT,
          delegation_cert TEXT DEFAULT '',
          updated_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER))
        )
      `);

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS imported_discord_users (
          id TEXT PRIMARY KEY,
          global_name TEXT,
          avatar TEXT,
          account_id TEXT DEFAULT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
        )
      `);

      // TODO [VISION:V1] The account_servers table stores server URLs only. The vision
      // (HARMONY_VISION.md) requires TOFU fingerprint pinning: add a `fingerprint TEXT`
      // column to store the server's Ed25519 public key fingerprint on first contact,
      // and verify it on every subsequent connection. Without this, DNS hijacking can
      // impersonate a trusted server.
      // This is a V1 feature — do NOT attempt during alpha/beta stabilization work.
      dbObj.run(`
        CREATE TABLE IF NOT EXISTS account_servers (
          account_id TEXT NOT NULL,
          server_url TEXT NOT NULL,
          trust_level TEXT NOT NULL DEFAULT 'untrusted',
          status TEXT NOT NULL DEFAULT 'active',
          joined_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
          left_at INTEGER,
          PRIMARY KEY (account_id, server_url),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
      `);

      dbObj.run("ALTER TABLE accounts ADD COLUMN is_admin BOOLEAN DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });

      dbObj.run("ALTER TABLE accounts ADD COLUMN auth_salt TEXT DEFAULT ''", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });

      dbObj.run("ALTER TABLE accounts ADD COLUMN dismissed_global_claim BOOLEAN DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });

      // Phase 2 Federation Identites
      dbObj.run("ALTER TABLE accounts ADD COLUMN authority_role TEXT DEFAULT 'primary'", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE accounts ADD COLUMN primary_server_url TEXT", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE accounts ADD COLUMN delegation_cert TEXT DEFAULT ''", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });

      dbObj.run("ALTER TABLE accounts ADD COLUMN is_deactivated BOOLEAN DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });


      dbObj.run(`
        CREATE TABLE IF NOT EXISTS read_states (
          account_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          last_message_id TEXT,
          last_read_timestamp INTEGER,
          PRIMARY KEY (account_id, channel_id)
        )
      `);

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS global_profiles (
          account_id TEXT PRIMARY KEY,
          display_name TEXT DEFAULT '',
          bio TEXT DEFAULT '',
          status_message TEXT DEFAULT '',
          avatar_url TEXT DEFAULT '',
          banner_url TEXT DEFAULT '',
          version INTEGER DEFAULT 0,
          signature TEXT DEFAULT '',
          FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
      `);

      dbObj.run("ALTER TABLE global_profiles ADD COLUMN version INTEGER DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE global_profiles ADD COLUMN signature TEXT DEFAULT ''", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE global_profiles ADD COLUMN display_name TEXT DEFAULT ''", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS account_settings (
          account_id TEXT PRIMARY KEY,
          settings TEXT DEFAULT '{}',
          updated_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
          FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
      `);

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS relationships (
          account_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          status TEXT NOT NULL,
          timestamp INTEGER,
          PRIMARY KEY (account_id, target_id),
          FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY(target_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
      `);

      this.nodeDb.run(`
        CREATE TABLE IF NOT EXISTS imported_discord_users (
          id TEXT PRIMARY KEY,
          account_id TEXT,
          global_name TEXT NOT NULL,
          avatar TEXT,
          bio TEXT,
          updated_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER))
        )
      `);

      dbObj.run("ALTER TABLE imported_discord_users ADD COLUMN account_id TEXT", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE imported_discord_users ADD COLUMN bio TEXT", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });

      // Phase 3: Cryptographic Mitigations & Pass-The-Hash
      // Migrate legacy plaintext verifiers to salt:hash format
      dbObj.all("SELECT id, auth_verifier FROM accounts", [], (err, rows: any[]) => {
        if (err || !rows) return;
        rows.forEach(row => {
          // If verifier doesn't look like salt:hash, it's legacy
          if (row.auth_verifier && !row.auth_verifier.includes(':')) {
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = crypto.scryptSync(row.auth_verifier, salt, 64).toString('hex');
            dbObj.run("UPDATE accounts SET auth_verifier = ? WHERE id = ?", [`${salt}:${hash}`, row.id]);
          }
        });
      });

      // Phase 4: Atomic Federation Invites
      dbObj.run(`
        CREATE TABLE IF NOT EXISTS invites (
          token TEXT PRIMARY KEY,
          host_uri TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          max_uses INTEGER NOT NULL,
          current_uses INTEGER DEFAULT 0,
          expires_at INTEGER NOT NULL
        )
      `);

      // Phase 5: Guild Registry — tracks all guilds hosted on this node
      dbObj.run(`
        CREATE TABLE IF NOT EXISTS guilds (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT DEFAULT '',
          description TEXT DEFAULT '',
          owner_account_id TEXT NOT NULL,
          fingerprint TEXT DEFAULT '',
          status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'stopped')),
          provision_code TEXT,
          max_members INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
          FOREIGN KEY (owner_account_id) REFERENCES accounts(id)
        )
      `);

      // Phase 5: Provision Codes — one-time-use codes for non-operators to create guilds
      dbObj.run(`
        CREATE TABLE IF NOT EXISTS guild_provision_codes (
          code TEXT PRIMARY KEY,
          label TEXT DEFAULT '',
          created_by TEXT NOT NULL,
          created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
          expires_at INTEGER,
          max_members INTEGER DEFAULT 0,
          used_by TEXT,
          used_at INTEGER,
          resulting_guild_id TEXT,
          FOREIGN KEY (created_by) REFERENCES accounts(id),
          FOREIGN KEY (used_by) REFERENCES accounts(id),
          FOREIGN KEY (resulting_guild_id) REFERENCES guilds(id)
        )
      `);

      // Phase 5: Node Settings — key-value store for node-level configuration
      dbObj.run(`
        CREATE TABLE IF NOT EXISTS node_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      // Seed default node settings
      const defaultNodeSettings = [
        ['allow_open_guild_creation', 'false'],
        ['default_max_members', '0'],
        ['max_guilds', '0'],  // 0 = unlimited
      ];
      for (const [k, v] of defaultNodeSettings) {
        dbObj.run(`INSERT OR IGNORE INTO node_settings (key, value) VALUES (?, ?)`, [k, v]);
      }

      // After all tables are created, scan and load guild instances.
      // This MUST be inside serialize() to guarantee the guilds table exists
      // before auto-registration is attempted.
      dbObj.run('SELECT 1', () => {
        this.scanAndLoadGuilds();
      });
    });
  }

  private initDmsDb() {
    this.dmsDb.serialize(() => {
      this.dmsDb.run(`
        CREATE TABLE IF NOT EXISTS dm_channels (
          id TEXT PRIMARY KEY,
          is_group BOOLEAN DEFAULT 0,
          name TEXT,
          owner_id TEXT
        )
      `);

      this.dmsDb.run(`
        CREATE TABLE IF NOT EXISTS dm_participants (
          channel_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          PRIMARY KEY (channel_id, account_id),
          FOREIGN KEY (channel_id) REFERENCES dm_channels(id) ON DELETE CASCADE
        )
      `);

      this.dmsDb.run(`
        CREATE TABLE IF NOT EXISTS dm_messages (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          author_id TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          is_pinned BOOLEAN DEFAULT 0,
          edited_at INTEGER,
          attachments TEXT DEFAULT '[]',
          is_encrypted INTEGER DEFAULT 0,
          FOREIGN KEY (channel_id) REFERENCES dm_channels(id) ON DELETE CASCADE
        )
      `);
      this.dmsDb.run("ALTER TABLE dm_messages ADD COLUMN is_encrypted INTEGER DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
    });
  }

  public async scanAndLoadGuilds() {
    if (!fs.existsSync(GUILDS_DIR)) return;
    const entries = fs.readdirSync(GUILDS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const guildId = entry.name;
        const guildDir = path.join(GUILDS_DIR, guildId);
        const guildDbPath = path.join(guildDir, 'guild.db');
        const legacyDbPath = path.join(guildDir, 'server.db');

        // Migration: rename server.db → guild.db
        if (!fs.existsSync(guildDbPath) && fs.existsSync(legacyDbPath)) {
          fs.renameSync(legacyDbPath, guildDbPath);
          console.log(`[MIGRATION] Renamed ${guildId}/server.db → guild.db`);
        }

        if (fs.existsSync(guildDbPath)) {
          this.loadGuildInstance(guildId, guildDbPath);

          // Auto-register orphaned guilds — guilds on disk but not in the registry.
          // This covers guilds created before the registry existed, or guilds
          // added to the filesystem manually (e.g. test data scripts).
          try {
            const existing = await this.getGuildRegistryEntry(guildId);
            if (!existing) {
              // Wait briefly for the guild DB to finish initializing
              await new Promise(resolve => setTimeout(resolve, 100));

              // Read guild name from guild_info (or fallback to 'servers' for legacy)
              let guildName = guildId;
              let ownerId = 'ORPHANED';
              try {
                const info: any = await this.getGuildQuery(guildId,
                  'SELECT name, owner_id FROM guild_info WHERE id = ?', [guildId]);
                if (info) {
                  guildName = info.name || guildId;
                  if (info.owner_id) ownerId = info.owner_id;
                } else {
                  // Try legacy 'servers' table
                  const legacy: any = await this.getGuildQuery(guildId,
                    'SELECT name, owner_id FROM servers WHERE id = ?', [guildId]);
                  if (legacy) {
                    guildName = legacy.name || guildId;
                    if (legacy.owner_id) ownerId = legacy.owner_id;
                  }
                }
              } catch { /* guild DB may not have these tables yet */ }

              // Read fingerprint from identity file
              let fingerprint = '';
              try {
                const identity = loadGuildPublicIdentity(guildDir);
                if (identity) fingerprint = identity.fingerprint;
              } catch { /* non-fatal */ }

              // Check if the owner from guild_info actually exists in accounts.
              // Imported guilds often have Discord snowflake IDs as owner_id,
              // which won't exist in the accounts table and would violate the FK constraint.
              let ownerExists = false;
              if (ownerId !== 'ORPHANED') {
                const ownerAcct: any = await this.getNodeQuery('SELECT id FROM accounts WHERE id = ?', [ownerId]);
                ownerExists = !!ownerAcct;
              }

              if (!ownerExists) {
                // Temporarily disable FK checks for this insert — the owner_account_id
                // will be updated to a real account when the first user claims the guild.
                await new Promise<void>((resolve, reject) => {
                  this.nodeDb.run('PRAGMA foreign_keys = OFF', () => {
                    this.nodeDb.run(
                      `INSERT OR IGNORE INTO guilds (id, name, owner_account_id, fingerprint, status) VALUES (?, ?, ?, ?, 'active')`,
                      [guildId, guildName, ownerId, fingerprint],
                      (err) => {
                        this.nodeDb.run('PRAGMA foreign_keys = ON', () => {
                          if (err) reject(err);
                          else resolve();
                        });
                      }
                    );
                  });
                });
              } else {
                await this.runNodeQuery(
                  `INSERT OR IGNORE INTO guilds (id, name, owner_account_id, fingerprint, status)
                   VALUES (?, ?, ?, ?, 'active')`,
                  [guildId, guildName, ownerId, fingerprint]
                );
              }
              console.log(`[REGISTRY] Auto-registered orphaned guild: "${guildName}" (${guildId})`);
            }
          } catch (regErr) {
            console.warn(`[REGISTRY] Failed to auto-register guild ${guildId}:`, regErr);
          }
        }
      }
    }
  }

  /** @deprecated Use scanAndLoadGuilds() instead */
  public async scanAndLoadServers() { return this.scanAndLoadGuilds(); }

  public loadGuildInstance(guildId: string, dbPath: string) {
    if (this.guildDbs.has(guildId)) return;

    const guildDb = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error(`Error opening Guild DB for ${guildId}`, err);
      } else {
        console.log(`Loaded Guild DB for ${guildId}`);
        guildDb.run('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
        this.initGuildDb(guildDb);
        this.guildDbs.set(guildId, guildDb);

        guildDb.all('SELECT id FROM channels', [], (chErr, rows: any[]) => {
            if (!chErr && rows) {
                rows.forEach(r => this.channelToGuildId.set(r.id, guildId));
            }
        });

        // Verify guild identity fingerprint against registry
        this.verifyGuildIdentityOnLoad(guildId);
      }
    });
  }

  /** @deprecated Use loadGuildInstance() instead */
  public loadServerInstance(serverId: string, dbPath: string) { return this.loadGuildInstance(serverId, dbPath); }

  /**
   * Verifies a guild's identity fingerprint against the registry entry
   * in node.db. Logs a security warning on mismatch but does NOT crash.
   * Called automatically during loadGuildInstance.
   */
  private async verifyGuildIdentityOnLoad(guildId: string): Promise<void> {
    try {
      const guildDir = path.join(GUILDS_DIR, guildId);
      const identity = loadGuildPublicIdentity(guildDir);

      if (!identity) {
        // No identity file — this is a legacy guild or one created without an owner key.
        // Not an error; guild identity is optional for backward compatibility.
        return;
      }

      const registryEntry = await this.getGuildRegistryEntry(guildId);
      if (!registryEntry) {
        // Guild not in registry (e.g., legacy guild loaded from disk).
        return;
      }

      if (registryEntry.fingerprint && registryEntry.fingerprint !== identity.fingerprint) {
        console.warn(
          `[SECURITY WARNING] Guild ${guildId} identity fingerprint mismatch!` +
          `\n  Registry fingerprint: ${registryEntry.fingerprint}` +
          `\n  Identity file fingerprint: ${identity.fingerprint}` +
          `\n  This could indicate tampering with the guild identity file.`
        );
      }
    } catch (err) {
      // Don't crash on verification errors — log and continue
      console.error(`[GuildIdentity] Error verifying identity for guild ${guildId}:`, err);
    }
  }

  public unloadGuildInstance(guildId: string) {
      const dbObj = this.guildDbs.get(guildId);
      if (dbObj) {
          dbObj.close();
          this.guildDbs.delete(guildId);
          for (const [chanId, gId] of this.channelToGuildId.entries()) {
              if (gId === guildId) this.channelToGuildId.delete(chanId);
          }
      }
  }

  /** @deprecated Use unloadGuildInstance() instead */
  public unloadServerInstance(serverId: string) { return this.unloadGuildInstance(serverId); }

  public initGuildDb(dbObj: sqlite3.Database) {
    dbObj.serialize(() => {
      dbObj.run(`
        CREATE TABLE IF NOT EXISTS guild_info (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT,
          owner_id TEXT,
          description TEXT,
          audit_interval_hours INTEGER DEFAULT 24
        )
      `);

      // Migration: rename legacy servers table → guild_info
      dbObj.run("ALTER TABLE servers RENAME TO guild_info", (err) => {
        // Ignore "no such table" errors (fresh DB) and "already exists" errors (already migrated)
        if (err && !err.message.includes('no such table') && !err.message.includes('already exists') && !err.message.includes('another table or index with this name')) {
          console.error('Migration error renaming servers → guild_info:', err);
        }
      });

      dbObj.run("ALTER TABLE guild_info ADD COLUMN owner_id TEXT", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE guild_info ADD COLUMN description TEXT", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE guild_info ADD COLUMN audit_interval_hours INTEGER DEFAULT 24", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS server_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS integrity_audits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hash TEXT NOT NULL,
          target_date INTEGER NOT NULL,
          created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER))
        )
      `);

      // Profiles relies on accounts.id, but since they are in separate DBs we can't use FOREIGN KEY for account_id
      dbObj.run(`
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT NOT NULL,
          server_id TEXT NOT NULL,
          account_id TEXT,
          original_username TEXT NOT NULL,
          nickname TEXT,
          avatar TEXT,
          role TEXT DEFAULT 'USER',
          aliases TEXT DEFAULT '',
          PRIMARY KEY (id, server_id),
          FOREIGN KEY (server_id) REFERENCES guild_info(id) ON DELETE CASCADE
        )
      `);

      dbObj.run("ALTER TABLE profiles ADD COLUMN membership_status TEXT DEFAULT 'active'", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE profiles ADD COLUMN joined_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER))", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE profiles ADD COLUMN left_at INTEGER", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });


      dbObj.run(`
        CREATE TABLE IF NOT EXISTS channel_categories (
          id TEXT PRIMARY KEY,
          server_id TEXT NOT NULL,
          name TEXT NOT NULL,
          position INTEGER DEFAULT 0,
          FOREIGN KEY (server_id) REFERENCES guild_info(id) ON DELETE CASCADE
        )
      `);

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS channels (
          id TEXT PRIMARY KEY,
          server_id TEXT NOT NULL,
          category_id TEXT,
          name TEXT NOT NULL,
          type TEXT DEFAULT 'text',
          position INTEGER DEFAULT 0,
          public_key TEXT,
          topic TEXT,
          nsfw BOOLEAN DEFAULT 0,
          FOREIGN KEY (server_id) REFERENCES guild_info(id) ON DELETE CASCADE,
          FOREIGN KEY (category_id) REFERENCES channel_categories(id) ON DELETE SET NULL
        )
      `);
      dbObj.run("ALTER TABLE channels ADD COLUMN topic TEXT", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE channels ADD COLUMN nsfw BOOLEAN DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE channels ADD COLUMN type TEXT DEFAULT 'text'", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE channels ADD COLUMN topic TEXT", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE channels ADD COLUMN nsfw BOOLEAN DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE channels ADD COLUMN public_key TEXT", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          author_id TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          is_pinned BOOLEAN DEFAULT 0,
          signature TEXT NOT NULL DEFAULT '',
          edited_at INTEGER,
          attachments TEXT DEFAULT '[]',
          reply_to TEXT DEFAULT NULL,
          is_encrypted BOOLEAN DEFAULT 0,
          embeds TEXT DEFAULT '[]',
          FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
        )
      `);

      dbObj.run("ALTER TABLE messages ADD COLUMN embeds TEXT DEFAULT '[]'", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });

      dbObj.run("ALTER TABLE messages ADD COLUMN reply_to TEXT DEFAULT NULL", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE messages ADD COLUMN is_encrypted BOOLEAN DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });
      dbObj.run("ALTER TABLE messages ADD COLUMN embeds TEXT DEFAULT '[]'", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS message_reactions (
          message_id TEXT NOT NULL,
          author_id TEXT NOT NULL,
          emoji TEXT NOT NULL,
          PRIMARY KEY (message_id, author_id, emoji),
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )
      `);

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS server_emojis (
          id TEXT PRIMARY KEY,
          server_id TEXT NOT NULL,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          animated BOOLEAN DEFAULT 0,
          FOREIGN KEY (server_id) REFERENCES guild_info(id) ON DELETE CASCADE
        )
      `);

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS roles (
          id TEXT PRIMARY KEY,
          server_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT DEFAULT '#FFFFFF',
          permissions INTEGER DEFAULT 0,
          position INTEGER DEFAULT 0,
          FOREIGN KEY (server_id) REFERENCES guild_info(id) ON DELETE CASCADE
        )
      `);

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS profile_roles (
          profile_id TEXT NOT NULL,
          server_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          PRIMARY KEY (profile_id, server_id, role_id),
          FOREIGN KEY (profile_id, server_id) REFERENCES profiles(id, server_id) ON DELETE CASCADE,
          FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
        )
      `);

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS channel_overrides (
          channel_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_type TEXT NOT NULL,
          allow INTEGER DEFAULT 0,
          deny INTEGER DEFAULT 0,
          PRIMARY KEY (channel_id, target_id),
          FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
        )
      `);

      dbObj.run(`
        CREATE TABLE IF NOT EXISTS server_emojis (
          id TEXT PRIMARY KEY,
          server_id TEXT NOT NULL,
          name TEXT NOT NULL,
          url TEXT,
          animated BOOLEAN DEFAULT 0,
          FOREIGN KEY (server_id) REFERENCES guild_info(id) ON DELETE CASCADE
        )
      `);
    });
  }

  /** @deprecated Use initGuildDb() instead */
  public initServerDb(dbObj: sqlite3.Database) { return this.initGuildDb(dbObj); }

  // Helper APIs for the app
  public runNodeQuery(sql: string, params: any[] = []): Promise<void> {
    return executeRun(this.nodeDb, sql, params);
  }

  public getNodeQuery<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return executeGet<T>(this.nodeDb, sql, params);
  }

  public allNodeQuery<T>(sql: string, params: any[] = []): Promise<T[]> {
    return executeAll<T>(this.nodeDb, sql, params);
  }

  public runDmsQuery(sql: string, params: any[] = []): Promise<void> {
    return executeRun(this.dmsDb, sql, params);
  }

  public getDmsQuery<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return executeGet<T>(this.dmsDb, sql, params);
  }

  public allDmsQuery<T>(sql: string, params: any[] = []): Promise<T[]> {
    return executeAll<T>(this.dmsDb, sql, params);
  }

  public getGuildDb(guildId: string): sqlite3.Database {
    const gdb = this.guildDbs.get(guildId);
    if (!gdb) throw new Error(`Guild DB for ${guildId} not loaded or does not exist`);
    return gdb;
  }

  /** @deprecated Use getGuildDb() instead */
  public getServerDb(serverId: string): sqlite3.Database {
    return this.getGuildDb(serverId);
  }

  public runGuildQuery(guildId: string, sql: string, params: any[] = []): Promise<void> {
    return executeRun(this.getGuildDb(guildId), sql, params);
  }

  /** @deprecated Use runGuildQuery() instead */
  public runServerQuery(serverId: string, sql: string, params: any[] = []): Promise<void> {
    return this.runGuildQuery(serverId, sql, params);
  }

  public getGuildQuery<T>(guildId: string, sql: string, params: any[] = []): Promise<T | undefined> {
    return executeGet<T>(this.getGuildDb(guildId), sql, params);
  }

  /** @deprecated Use getGuildQuery() instead */
  public getServerQuery<T>(serverId: string, sql: string, params: any[] = []): Promise<T | undefined> {
    return this.getGuildQuery<T>(serverId, sql, params);
  }

  public allGuildQuery<T>(guildId: string, sql: string, params: any[] = []): Promise<T[]> {
    return executeAll<T>(this.getGuildDb(guildId), sql, params);
  }

  /** @deprecated Use allGuildQuery() instead */
  public allServerQuery<T>(serverId: string, sql: string, params: any[] = []): Promise<T[]> {
    return this.allGuildQuery<T>(serverId, sql, params);
  }

  public async getAllLoadedGuilds(): Promise<any[]> {
    const guilds = [];
    for (const [guildId, gdb] of this.guildDbs.entries()) {
      try {
        // Try guild_info first (new schema), fall back to servers (legacy)
        let info = await executeGet<any>(gdb, 'SELECT * FROM guild_info WHERE id = ?', [guildId]);
        if (!info) {
          info = await executeGet<any>(gdb, 'SELECT * FROM servers WHERE id = ?', [guildId]).catch(() => undefined);
        }
        if (info) {
          guilds.push(info);
        }
      } catch (e) {
        console.error(`Failed to fetch guild info for ${guildId}`);
      }
    }
    return guilds;
  }

  /** @deprecated Use getAllLoadedGuilds() instead */
  public async getAllLoadedServers(): Promise<any[]> {
    return this.getAllLoadedGuilds();
  }

  public async initializeGuildBundle(
      guildId: string,
      name: string,
      icon: string = '',
      ownerId: string = '',
      description: string = '',
      ownerPublicKey: string = ''
  ): Promise<void> {
      const guildDir = path.join(GUILDS_DIR, guildId);
      const uploadsDir = path.join(guildDir, 'uploads');
      if (!fs.existsSync(guildDir)) fs.mkdirSync(guildDir, { recursive: true });
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      
      const dbPath = path.join(guildDir, 'guild.db');
      this.loadGuildInstance(guildId, dbPath);
      
      await new Promise(resolve => setTimeout(resolve, 50)); // let serialize migrations finish
      await executeRun(this.getGuildDb(guildId), `INSERT OR IGNORE INTO guild_info (id, name, icon, owner_id, description) VALUES (?, ?, ?, ?, ?)`, [guildId, name, icon, ownerId, description]);
      
      // Seed default rate limits and sizes
      const defaultSettings = [
        ['rate_limit_owner', '30'],
        ['rate_limit_admin', '20'],
        ['rate_limit_user', '5'],
        ['max_message_length', '10000'],
        ['max_upload_size_mb', '50']
      ];
      for (const [k, v] of defaultSettings) {
        await executeRun(this.getGuildDb(guildId), `INSERT OR IGNORE INTO server_settings (key, value) VALUES (?, ?)`, [k, v]);
      }

      // Generate guild identity keypair if owner public key is provided
      let fingerprint = '';
      if (ownerPublicKey) {
        try {
          const identity = generateGuildIdentity(guildDir, ownerPublicKey);
          fingerprint = identity.fingerprint;
        } catch (err) {
          console.error(`[GuildBundle] Failed to generate guild identity for ${guildId}:`, err);
        }
      }

      // Register in guild registry (node.db)
      if (ownerId) {
        await this.registerGuild(guildId, name, ownerId, fingerprint);
      }
  }

  /** @deprecated Use initializeGuildBundle() instead */
  public async initializeServerBundle(serverId: string, name: string, icon: string = '', ownerId: string = '', description: string = '', ownerPublicKey: string = '') {
    return this.initializeGuildBundle(serverId, name, icon, ownerId, description, ownerPublicKey);
  }

  // Transaction Helpers
  public beginTransaction(serverId: string): Promise<void> {
    return this.runGuildQuery(serverId, 'BEGIN TRANSACTION');
  }

  public commit(serverId: string): Promise<void> {
    return this.runGuildQuery(serverId, 'COMMIT');
  }

  public rollback(serverId: string): Promise<void> {
    return this.runGuildQuery(serverId, 'ROLLBACK').catch(() => {}); // silence if no transaction
  }

  /**
   * Efficiently executes multiple sets of parameters against a single prepared SQL statement.
   */
  public async runBatch(serverId: string, sql: string, paramsArray: any[][]): Promise<void> {
    const db = this.getGuildDb(serverId);
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(sql, (err) => {
        if (err) return reject(err);
        
        let firstBatchError: any = null;
        db.serialize(() => {
          for (const params of paramsArray) {
            stmt.run(params, (runErr) => {
              if (runErr && !firstBatchError) {
                  firstBatchError = runErr;
              }
            });
          }
          stmt.finalize((finalErr) => {
            if (firstBatchError) reject(firstBatchError);
            else if (finalErr) reject(finalErr);
            else resolve();
          });
        });
      });
    });
  }

  // =========================================================================
  // Guild Registry helpers (node.db)
  // =========================================================================

  public async registerGuild(
      guildId: string,
      name: string,
      ownerAccountId: string,
      fingerprint: string,
      provisionCode?: string,
      maxMembers?: number
  ): Promise<void> {
    await this.runNodeQuery(
      `INSERT OR IGNORE INTO guilds (id, name, owner_account_id, fingerprint, provision_code, max_members)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [guildId, name, ownerAccountId, fingerprint, provisionCode ?? null, maxMembers ?? 0]
    );
  }

  public async getGuildRegistryEntry(guildId: string): Promise<GuildRegistryEntry | undefined> {
    return this.getNodeQuery<GuildRegistryEntry>(
      `SELECT * FROM guilds WHERE id = ?`, [guildId]
    );
  }

  public async getAllRegisteredGuilds(): Promise<GuildRegistryEntry[]> {
    return this.allNodeQuery<GuildRegistryEntry>(
      `SELECT * FROM guilds`
    );
  }

  public async updateGuildStatus(guildId: string, status: 'active' | 'suspended' | 'stopped'): Promise<void> {
    await this.runNodeQuery(
      `UPDATE guilds SET status = ? WHERE id = ?`, [status, guildId]
    );
  }

  public async deleteGuildRegistryEntry(guildId: string): Promise<void> {
    await this.runNodeQuery(
      `DELETE FROM guilds WHERE id = ?`, [guildId]
    );
  }

  // =========================================================================
  // Provision Code helpers (node.db)
  // =========================================================================

  public async createProvisionCode(
      createdBy: string,
      expiresAt?: number,
      maxMembers?: number,
      label?: string
  ): Promise<string> {
    const code = crypto.randomBytes(16).toString('hex');
    await this.runNodeQuery(
      `INSERT INTO guild_provision_codes (code, label, created_by, expires_at, max_members)
       VALUES (?, ?, ?, ?, ?)`,
      [code, label ?? '', createdBy, expiresAt ?? null, maxMembers ?? 0]
    );
    return code;
  }

  public async validateProvisionCode(code: string): Promise<{ valid: boolean; code?: ProvisionCodeEntry; error?: string }> {
    const entry = await this.getNodeQuery<ProvisionCodeEntry>(
      `SELECT * FROM guild_provision_codes WHERE code = ?`, [code]
    );

    if (!entry) {
      return { valid: false, error: 'Code not found' };
    }

    if (entry.used_by) {
      return { valid: false, code: entry, error: 'Code already consumed' };
    }

    if (entry.expires_at && entry.expires_at < Math.floor(Date.now() / 1000)) {
      return { valid: false, code: entry, error: 'Code expired' };
    }

    return { valid: true, code: entry };
  }

  public async consumeProvisionCode(code: string, usedBy: string, resultingGuildId: string): Promise<void> {
    await this.runNodeQuery(
      `UPDATE guild_provision_codes SET used_by = ?, used_at = CAST(strftime('%s','now') AS INTEGER), resulting_guild_id = ? WHERE code = ?`,
      [usedBy, resultingGuildId, code]
    );
  }

  public async getProvisionCodes(createdBy?: string): Promise<ProvisionCodeEntry[]> {
    if (createdBy) {
      return this.allNodeQuery<ProvisionCodeEntry>(
        `SELECT * FROM guild_provision_codes WHERE created_by = ?`, [createdBy]
      );
    }
    return this.allNodeQuery<ProvisionCodeEntry>(
      `SELECT * FROM guild_provision_codes`
    );
  }

  public async revokeProvisionCode(code: string): Promise<void> {
    await this.runNodeQuery(
      `DELETE FROM guild_provision_codes WHERE code = ?`, [code]
    );
  }

  // =========================================================================
  // Node Settings helpers (node.db)
  // =========================================================================

  public async getNodeSetting(key: string): Promise<string | undefined> {
    const row = await this.getNodeQuery<{ key: string; value: string }>(
      `SELECT value FROM node_settings WHERE key = ?`, [key]
    );
    return row?.value;
  }

  public async setNodeSetting(key: string, value: string): Promise<void> {
    await this.runNodeQuery(
      `INSERT OR REPLACE INTO node_settings (key, value) VALUES (?, ?)`, [key, value]
    );
  }

  public async getAllNodeSettings(): Promise<Record<string, string>> {
    const rows = await this.allNodeQuery<{ key: string; value: string }>(
      `SELECT * FROM node_settings`
    );
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  // =========================================================================
  // Guild Membership queries (used by WebSocket scoping)
  // =========================================================================

  /**
   * Returns all guilds where the given account has an active profile.
   * Iterates over every loaded guild DB — acceptable for the connection
   * handshake (runs once per WS connect, not per message).
   */
  public async getAccountGuildMemberships(accountId: string): Promise<Array<{ id: string; name: string }>> {
    const memberships: Array<{ id: string; name: string }> = [];
    for (const [guildId] of this.guildDbs) {
      try {
        const profile = await this.getGuildQuery<{ id: string }>(guildId,
          'SELECT id FROM profiles WHERE account_id = ? AND membership_status = ?',
          [accountId, 'active']
        );
        if (profile) {
          const guildInfo = await this.getNodeQuery<{ name: string }>('SELECT name FROM guilds WHERE id = ?', [guildId]);
          memberships.push({ id: guildId, name: guildInfo?.name || '' });
        }
      } catch {
        // Guild DB may have been unloaded between iteration start and query — skip
      }
    }
    return memberships;
  }

}


const dbManager = new DatabaseManager();
export default dbManager;
