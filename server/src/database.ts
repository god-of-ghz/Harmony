import sqlite3 from 'sqlite3';
import path from 'path';

const portArgIndex = process.argv.indexOf('--port');
const portArgValue = portArgIndex !== -1 ? process.argv[portArgIndex + 1] : null;
const portEqualsArg = process.argv.find(arg => arg.startsWith('--port='));
const portEqualsValue = portEqualsArg ? portEqualsArg.split('=')[1] : null;

const PORT = portEqualsValue || portArgValue || process.env.PORT || 3001;
const dbFileName = (PORT === 3001 || PORT === '3001') ? 'harmony.db' : `harmony_${PORT}.db`;

// Use a local database file bounded to the host execution directory (supports pkg standalone wrapper)
const dbPath = path.resolve(process.cwd(), dbFileName);
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('Connected to SQLite database at', dbPath);
    db.run('PRAGMA foreign_keys = ON', (pragmaErr) => {
      if (pragmaErr) console.error('Failed to enable foreign keys', pragmaErr);
      initDB();
    });
  }
});

function initDB() {
  db.serialize(() => {
    // Accounts table
    db.run(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_creator BOOLEAN DEFAULT 0,
        updated_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER))
      )
    `);

    // Profiles table (replaces users)
    db.run(`
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
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
      )
    `);

    // Servers table
    db.run(`
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT
      )
    `);

    // Channel Categories table
    db.run(`
      CREATE TABLE IF NOT EXISTS channel_categories (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
      )
    `);

    // Channels table
    db.run(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        category_id TEXT,
        name TEXT NOT NULL,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES channel_categories(id) ON DELETE SET NULL
      )
    `);

    // Messages table
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        is_pinned BOOLEAN DEFAULT 0,
        FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
      )
    `);

    // Trusted Servers table
    db.run(`
      CREATE TABLE IF NOT EXISTS trusted_servers (
        account_id TEXT NOT NULL,
        server_url TEXT NOT NULL,
        PRIMARY KEY (account_id, server_url),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      )
    `);

    console.log('Database tables initialized.');

    // Migration: Add updated_at to accounts if it doesn't exist
    db.run("ALTER TABLE accounts ADD COLUMN updated_at INTEGER DEFAULT 0", (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding updated_at to accounts:', err);
      }
    });

    // Migration: Add position to channels if it doesn't exist
    db.run("ALTER TABLE channels ADD COLUMN position INTEGER DEFAULT 0", (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding position to channels:', err);
      }
    });

    // Migration: Add category_id to channels if it doesn't exist
    db.run("ALTER TABLE channels ADD COLUMN category_id TEXT REFERENCES channel_categories(id) ON DELETE SET NULL", (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding category_id to channels:', err);
      }
    });

    // Migration: Add aliases to profiles if it doesn't exist
    db.run("ALTER TABLE profiles ADD COLUMN aliases TEXT DEFAULT ''", (err) => {
      if (err && !err.message.includes('duplicate column name')) {
        console.error('Error adding aliases to profiles:', err);
      }
    });
  });
}

// Wrapping SQLite methods in Promises for async/await usage
export const runQuery = (sql: string, params: any[] = []): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
};

export const getQuery = <T>(sql: string, params: any[] = []): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T);
    });
  });
};

export const allQuery = <T>(sql: string, params: any[] = []): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
};

export default db;
