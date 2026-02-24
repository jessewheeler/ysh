const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const { translateParams, translateSql, addReturningId } = require('./pg-translate');

let db;
const dialect = process.env.DATABASE_URL ? 'pg' : 'sqlite';

if (dialect === 'pg') {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  // AsyncLocalStorage lets db.get/all/run automatically use the transaction
  // client when called inside db.transaction(), instead of going through the pool.
  const txnStore = new AsyncLocalStorage();

  function getQueryable() {
    return txnStore.getStore() || pool;
  }

  db = {
    dialect: 'pg',
    async get(sql, ...params) {
      const sanitizedParams = params.map(p => p === undefined ? null : p);
      const res = await getQueryable().query(translateParams(translateSql(sql)), sanitizedParams.length ? sanitizedParams : undefined);
      return res.rows[0];
    },
    async all(sql, ...params) {
      const sanitizedParams = params.map(p => p === undefined ? null : p);
      const res = await getQueryable().query(translateParams(translateSql(sql)), sanitizedParams.length ? sanitizedParams : undefined);
      return res.rows;
    },
    async run(sql, ...params) {
      const sanitizedParams = params.map(p => p === undefined ? null : p);
      let pgSql = translateSql(sql);
      const isInsert = /^\s*INSERT INTO/i.test(pgSql);
      if (isInsert) {
        pgSql = addReturningId(pgSql);
      }
      const res = await getQueryable().query(translateParams(pgSql), sanitizedParams.length ? sanitizedParams : undefined);
      return {
        lastInsertRowid: isInsert && res.rows[0] ? res.rows[0].id : null,
        changes: res.rowCount
      };
    },
    async exec(sql) {
      await getQueryable().query(translateSql(sql));
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await txnStore.run(client, () => fn());
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
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

    const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'ysh.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  db = {
    dialect: 'sqlite',
    async get(sql, ...params) {
      const sanitized = params.map(p => p === undefined ? null : p);
      return sqlite.prepare(sql).get(...sanitized);
    },
    async all(sql, ...params) {
      const sanitized = params.map(p => p === undefined ? null : p);
      return sqlite.prepare(sql).all(...sanitized);
    },
    async run(sql, ...params) {
      const sanitized = params.map(p => p === undefined ? null : p);
      const result = sqlite.prepare(sql).run(...sanitized);
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
}

module.exports = db;
