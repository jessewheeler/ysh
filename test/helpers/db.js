const Database = require('better-sqlite3');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_number TEXT UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    address_street TEXT,
    address_city TEXT,
    address_state TEXT,
    address_zip TEXT,
    membership_year INTEGER,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','expired','cancelled')),
    notes TEXT,
    role TEXT CHECK(role IN ('super_admin','editor')),
    otp_hash TEXT,
    otp_expires_at TEXT,
    otp_attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','refunded')),
    description TEXT,
    payment_method TEXT NOT NULL DEFAULT 'stripe',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT,
    image_path TEXT,
    link_url TEXT,
    link_text TEXT,
    is_published INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gallery_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    alt_text TEXT,
    caption TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_visible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT,
    bio_text TEXT,
    photo_path TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_visible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS emails_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email TEXT NOT NULL,
    to_name TEXT,
    subject TEXT,
    body_html TEXT,
    email_type TEXT CHECK(email_type IN ('welcome','payment_confirmation','card_delivery','blast','contact','otp')),
    status TEXT NOT NULL DEFAULT 'sent',
    error TEXT,
    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS membership_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    pdf_path TEXT,
    png_path TEXT,
    year INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

`;

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(SCHEMA);

  const db = {
    dialect: 'sqlite',
    async get(sql, ...params) {
      return sqlite.prepare(sql).get(...params);
    },
    async all(sql, ...params) {
      return sqlite.prepare(sql).all(...params);
    },
    async run(sql, ...params) {
      const result = sqlite.prepare(sql).run(...params);
      return {
        lastInsertRowid: result.lastInsertRowid,
        changes: result.changes
      };
    },
    async exec(sql) {
      sqlite.exec(sql);
    },
    async transaction(fn) {
      const isAsync = fn.constructor.name === 'AsyncFunction';
      if (!isAsync) {
        return sqlite.transaction(fn)();
      } else {
        sqlite.prepare('BEGIN').run();
        try {
          const result = await fn();
          sqlite.prepare('COMMIT').run();
          return result;
        } catch (e) {
          sqlite.prepare('ROLLBACK').run();
          throw e;
        }
      }
    },
    async close() {
      sqlite.close();
    },
    prepare(sql) {
      return sqlite.prepare(sql);
    }
  };

  return db;
}

module.exports = { createTestDb, SCHEMA };
