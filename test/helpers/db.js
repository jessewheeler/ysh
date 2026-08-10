const Database = require('better-sqlite3');
const { SCHEMA } = require('../../db/schema');

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(SCHEMA);

  // members.campaign_id can't live in SCHEMA: members is created before campaigns, and
  // campaigns.created_by points back at members, so one of the two FKs has to be added after
  // the fact. db/migrate.js does this for real databases (both dialects) — mirror it here so
  // tests see the same shape.
  sqlite.exec('ALTER TABLE members ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_members_campaign ON members (campaign_id)');

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
