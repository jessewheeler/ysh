const path = require('path');
const fs = require('fs');
const { translateParams, translateSql, addReturningId } = require('./pg-translate');

let db;
const dialect = process.env.DATABASE_URL ? 'pg' : 'sqlite';

if (dialect === 'pg') {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  db = {
    dialect: 'pg',
    async get(sql, ...params) {
      const res = await pool.query(translateParams(translateSql(sql)), params);
      return res.rows[0];
    },
    async all(sql, ...params) {
      const res = await pool.query(translateParams(translateSql(sql)), params);
      return res.rows;
    },
    async run(sql, ...params) {
      let pgSql = translateSql(sql);
      const isInsert = /^\s*INSERT INTO/i.test(pgSql);
      if (isInsert) {
        pgSql = addReturningId(pgSql);
      }
      const res = await pool.query(translateParams(pgSql), params);
      return {
        lastInsertRowid: isInsert && res.rows[0] ? res.rows[0].id : null,
        changes: res.rowCount
      };
    },
    async exec(sql) {
      await pool.query(translateSql(sql));
    },
    async transaction(fn) {
      if (dialect === 'pg') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(client);
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      } else {
        // SQLite: better-sqlite3 transactions are synchronous and cannot handle async functions.
        // But for consistency in our unified API, we allow passing an async function.
        // If it's a sync function, we use better-sqlite3's transaction.
        // If it's an async function, we have to handle it manually with BEGIN/COMMIT to allow awaits.
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
      }
    },
    async close() {
      await pool.end();
    }
  };
} else {
  const Database = require('better-sqlite3');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = process.env.NODE_ENV === 'test' ? ':memory:' : path.join(dataDir, 'ysh.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  db = {
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
      // SQLite: better-sqlite3 transactions are synchronous and cannot handle async functions.
      // But for consistency in our unified API, we allow passing an async function.
      // If it's a sync function, we use better-sqlite3's transaction.
      // If it's an async function, we have to handle it manually with BEGIN/COMMIT to allow awaits.
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
    // Expose prepare for test helpers that still need it
    prepare(sql) {
      return sqlite.prepare(sql);
    }
  };
}

module.exports = db;
