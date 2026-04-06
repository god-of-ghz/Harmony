import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

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

export const SERVERS_DIR = path.join(DATA_DIR, 'servers');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SERVERS_DIR)) fs.mkdirSync(SERVERS_DIR, { recursive: true });

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
  private serverDbs: Map<string, sqlite3.Database> = new Map();

  constructor() {
    this.nodeDb = new sqlite3.Database(nodeDbPath, (err) => {
      if (err) console.error('Error opening Node database', err);
      else {
        console.log('Connected to Node database at', nodeDbPath);
        this.nodeDb.run('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;', (pragmaErr) => {
            if (pragmaErr) console.error('Failed to enable PRAGMAs on Node DB', pragmaErr);
            this.initNodeDb();
            this.scanAndLoadServers();
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

  private initNodeDb() {
    this.nodeDb.serialize(() => {
      this.nodeDb.run(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          auth_verifier TEXT NOT NULL,
          public_key TEXT NOT NULL,
          encrypted_private_key TEXT NOT NULL,
          key_salt TEXT NOT NULL,
          key_iv TEXT NOT NULL,
          is_creator BOOLEAN DEFAULT 0,
          is_admin BOOLEAN DEFAULT 0,
          updated_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER))
        )
      `);

      this.nodeDb.run(`
        CREATE TABLE IF NOT EXISTS trusted_servers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL,
          server_url TEXT NOT NULL,
          position INTEGER DEFAULT 0,
          UNIQUE(account_id, server_url)
        )
      `);

      this.nodeDb.run("ALTER TABLE accounts ADD COLUMN is_admin BOOLEAN DEFAULT 0", (err) => {
        if (err && !err.message.includes('duplicate column name')) {}
      });

      // Workaround: Elevate all current accounts to admins
      this.nodeDb.run("UPDATE accounts SET is_admin = 1");


      this.nodeDb.run(`
        CREATE TABLE IF NOT EXISTS read_states (
          account_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          last_message_id TEXT,
          last_read_timestamp INTEGER,
          PRIMARY KEY (account_id, channel_id)
        )
      `);

      this.nodeDb.run(`
        CREATE TABLE IF NOT EXISTS global_profiles (
          account_id TEXT PRIMARY KEY,
          bio TEXT DEFAULT '',
          status_message TEXT DEFAULT '',
          avatar_url TEXT DEFAULT '',
          banner_url TEXT DEFAULT '',
          FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
      `);

      this.nodeDb.run(`
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
          FOREIGN KEY (channel_id) REFERENCES dm_channels(id) ON DELETE CASCADE
        )
      `);
    });
  }

  public async scanAndLoadServers() {
    if (!fs.existsSync(SERVERS_DIR)) return;
    const entries = fs.readdirSync(SERVERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const serverId = entry.name;
        const dbPath = path.join(SERVERS_DIR, serverId, 'server.db');
        if (fs.existsSync(dbPath)) {
          this.loadServerInstance(serverId, dbPath);
        }
      }
    }
  }

  public loadServerInstance(serverId: string, dbPath: string) {
    if (this.serverDbs.has(serverId)) return;

    const serverDb = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error(`Error opening Server DB for ${serverId}`, err);
      } else {
        console.log(`Loaded Server DB for ${serverId}`);
        serverDb.run('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
        this.initServerDb(serverDb);
        this.serverDbs.set(serverId, serverDb);
      }
    });
  }

  public unloadServerInstance(serverId: string) {
      const dbObj = this.serverDbs.get(serverId);
      if (dbObj) {
          dbObj.close();
          this.serverDbs.delete(serverId);
      }
  }

  public initServerDb(dbObj: sqlite3.Database) {
    dbObj.serialize(() => {
      dbObj.run(`
        CREATE TABLE IF NOT EXISTS servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT
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
          role TEXT DEFAULT 'ADMIN',
          aliases TEXT DEFAULT '',
          PRIMARY KEY (id, server_id),
          FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
        )
      `);

      // Workaround: Elevate all existing users to ADMIN (keep OWNER distinct)
      dbObj.run("UPDATE profiles SET role = 'ADMIN' WHERE role != 'OWNER'");


      dbObj.run(`
        CREATE TABLE IF NOT EXISTS channel_categories (
          id TEXT PRIMARY KEY,
          server_id TEXT NOT NULL,
          name TEXT NOT NULL,
          position INTEGER DEFAULT 0,
          FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
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
          FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
          FOREIGN KEY (category_id) REFERENCES channel_categories(id) ON DELETE SET NULL
        )
      `);
      dbObj.run("ALTER TABLE channels ADD COLUMN type TEXT DEFAULT 'text'", (err) => {
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
          FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
        )
      `);

      dbObj.run("ALTER TABLE messages ADD COLUMN reply_to TEXT DEFAULT NULL", (err) => {
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
        CREATE TABLE IF NOT EXISTS roles (
          id TEXT PRIMARY KEY,
          server_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT DEFAULT '#99aab5',
          permissions INTEGER DEFAULT 0,
          position INTEGER DEFAULT 0,
          FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
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
    });
  }

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

  public getServerDb(serverId: string): sqlite3.Database {
    const sdb = this.serverDbs.get(serverId);
    if (!sdb) throw new Error(`Server DB for ${serverId} not loaded or does not exist`);
    return sdb;
  }

  public runServerQuery(serverId: string, sql: string, params: any[] = []): Promise<void> {
    return executeRun(this.getServerDb(serverId), sql, params);
  }

  public getServerQuery<T>(serverId: string, sql: string, params: any[] = []): Promise<T | undefined> {
    return executeGet<T>(this.getServerDb(serverId), sql, params);
  }

  public allServerQuery<T>(serverId: string, sql: string, params: any[] = []): Promise<T[]> {
    return executeAll<T>(this.getServerDb(serverId), sql, params);
  }

  public async getAllLoadedServers(): Promise<any[]> {
    const servers = [];
    for (const [serverId, sdb] of this.serverDbs.entries()) {
      try {
        const info = await executeGet<any>(sdb, 'SELECT * FROM servers WHERE id = ?', [serverId]);
        if (info) {
          servers.push(info);
        }
      } catch (e) {
        console.error(`Failed to fetch server info for ${serverId}`);
      }
    }
    return servers;
  }

  public async initializeServerBundle(serverId: string, name: string, icon: string = '') {
      const serverDir = path.join(SERVERS_DIR, serverId);
      const uploadsDir = path.join(serverDir, 'uploads');
      if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      
      const dbPath = path.join(serverDir, 'server.db');
      this.loadServerInstance(serverId, dbPath);
      
      await new Promise(resolve => setTimeout(resolve, 50)); // let serialize migrations finish
      await executeRun(this.getServerDb(serverId), `INSERT OR IGNORE INTO servers (id, name, icon) VALUES (?, ?, ?)`, [serverId, name, icon]);
  }

  // Transaction Helpers
  public beginTransaction(serverId: string): Promise<void> {
    return this.runServerQuery(serverId, 'BEGIN TRANSACTION');
  }

  public commit(serverId: string): Promise<void> {
    return this.runServerQuery(serverId, 'COMMIT');
  }

  public rollback(serverId: string): Promise<void> {
    return this.runServerQuery(serverId, 'ROLLBACK').catch(() => {}); // silence if no transaction
  }

  /**
   * Efficiently executes multiple sets of parameters against a single prepared SQL statement.
   */
  public async runBatch(serverId: string, sql: string, paramsArray: any[][]): Promise<void> {
    const db = this.getServerDb(serverId);
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

}

const dbManager = new DatabaseManager();
export default dbManager;
