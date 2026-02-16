# Add PostgreSQL Support for Render Deployment

## Context

The app currently uses better-sqlite3 exclusively. For Render deployment, we need PostgreSQL support while keeping SQLite for local development. The presence of `DATABASE_URL` env var (provided by Render) determines which backend to use.

**Core challenge**: better-sqlite3 is synchronous (`db.prepare(sql).get(params)`) while node-postgres (`pg`) is async. All ~89 `db.prepare()` call sites across 9 source files must be converted to use a unified async adapter API with `await`.

---

## Phase 1: Database adapter (`db/database.js`)

Replace the current raw better-sqlite3 export with a unified adapter that exposes the same API for both backends.

**New API** (all methods work with both SQLite and PostgreSQL):
- `db.get(sql, ...params)` — single row (SQLite: sync return, PG: Promise)
- `db.all(sql, ...params)` — array of rows
- `db.run(sql, ...params)` — returns `{ lastInsertRowid, changes }`
- `db.exec(sql)` — raw DDL execution
- `db.transaction(fn)` — wraps `fn` in a transaction
- `db.close()` — cleanup
- `db.dialect` — `'sqlite'` or `'pg'`

**SQLite adapter**: Wraps better-sqlite3 methods. Since `await` on a non-Promise returns the value immediately, callers can uniformly use `await` and it works for both.

**PostgreSQL adapter**: Uses `pg.Pool`. Translates SQL on the fly via `db/pg-translate.js`:
- `?` positional params → `$1, $2, ...`
- `datetime('now')` → `NOW()`
- `INSERT OR IGNORE INTO ... VALUES` → `INSERT INTO ... VALUES ... ON CONFLICT DO NOTHING`
- `INSERT INTO ... VALUES (...)` → append `RETURNING id` for `run()` to capture `lastInsertRowid`

**File**: `db/database.js` (~100 lines, complete rewrite)

---

## Phase 2: SQL translation helper (`db/pg-translate.js`)

New file. Pure functions:
- `translateParams(sql)` — replaces `?` with `$1`, `$2`, etc.
- `translateSql(sql)` — handles `datetime('now')` → `NOW()`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`
- `addReturningId(sql)` — for INSERT statements, appends `RETURNING id`

**File**: `db/pg-translate.js` (new, ~40 lines)
**Test**: `test/db/pg-translate.test.js` (new)

---

## Phase 3: PostgreSQL migration (`db/migrate.js`)

The current `migrate()` uses `db.exec()` for DDL and `sqlite_master` introspection for incremental migrations. Need to:

1. Make `migrate()` async
2. Branch on `db.dialect`:
   - **SQLite**: Keep existing logic unchanged (sync `db.exec()` still works with await)
   - **PostgreSQL**: Run clean schema creation with PG-compatible DDL:
     - `SERIAL PRIMARY KEY` instead of `INTEGER PRIMARY KEY AUTOINCREMENT`
     - `TIMESTAMP DEFAULT NOW()` instead of `TEXT DEFAULT (datetime('now'))`
     - `BOOLEAN DEFAULT TRUE` instead of `INTEGER NOT NULL DEFAULT 1`
     - Standard CHECK constraints (same syntax)
     - Skip the `sqlite_master` introspection and ALTER TABLE migrations (PG starts fresh)

3. Make `seed()` async (calls `await migrate()`, then uses `await db.run()`)

**Files**: `db/migrate.js`, `db/seed.js` (modified)

---

## Phase 4: Convert all call sites to async adapter API

Every `db.prepare(sql).get/all/run(params)` becomes `await db.get/all/run(sql, params)`.

| File | db.prepare calls | Key changes |
|------|-----------------|-------------|
| `routes/admin.js` | 64 | Add `async` to any remaining sync handlers; `db.transaction()` for settings |
| `routes/index.js` | 6 | `result.lastInsertRowid` stays (adapter returns it) |
| `routes/stripe.js` | 1 | Already async |
| `services/members.js` | 4 | All functions become `async` |
| `services/stripe.js` | 1 | Already async |
| `services/card.js` | 6 | Already async |
| `services/email.js` | 3 | `getContactEmail()` and `logEmail()` become async |
| `middleware/locals.js` | 1 | `injectLocals` becomes async with try/catch |
| `scripts/create-admin.js` | 3 | Wrap in async IIFE |

**Conversion pattern**:
```js
// Before
const row = db.prepare('SELECT * FROM members WHERE id = ?').get(id);

// After
const row = await db.get('SELECT * FROM members WHERE id = ?', id);
```

**Special cases**:
- `db.transaction()` in `routes/admin.js` (settings upsert) → adapter's `db.transaction(async fn)` wraps in BEGIN/COMMIT for PG, uses `db.transaction()` for SQLite
- `e.message.includes('UNIQUE')` error checks → also check `e.code === '23505'` for PG
- `result.lastInsertRowid` in `routes/index.js` → PG adapter returns this from `RETURNING id`

---

## Phase 5: Session store (`server.js`)

Switch session store based on `DATABASE_URL`:

```js
// Before
const SQLiteStore = require('connect-sqlite3')(session);
// store: new SQLiteStore({ dir: ..., db: 'sessions.db' })

// After
let store;
if (process.env.DATABASE_URL) {
  const pgSession = require('connect-pg-simple')(session);
  store = new pgSession({ conString: process.env.DATABASE_URL, createTableIfMissing: true });
} else {
  const SQLiteStore = require('connect-sqlite3')(session);
  store = new SQLiteStore({ dir: path.join(__dirname, 'data'), db: 'sessions.db' });
}
```

Startup also needs async wrapper since `seed()` becomes async:
```js
async function start() {
  await seed();
  // ... rest of setup
  app.listen(PORT, ...);
}
start();
```

**File**: `server.js` (modified)

---

## Phase 6: Dependencies & test infrastructure

### New dependencies
- `pg` — PostgreSQL client
- `connect-pg-simple` — PostgreSQL session store

### Test infrastructure
Tests continue using SQLite in-memory (no `DATABASE_URL` set). The test proxy in `test/helpers/setupDb.js` needs to expose the new adapter API methods (`get`, `all`, `run`, `exec`, `transaction`, `dialect`) alongside the existing `prepare()` for fixture helpers.

**Files**: `package.json`, `test/helpers/setupDb.js` (modified)

---

## Files summary

**New files**:
- `db/pg-translate.js` — SQL dialect translation
- `test/db/pg-translate.test.js` — translation unit tests

**Modified files**:
- `db/database.js` — dual adapter (SQLite/PG)
- `db/migrate.js` — async, PG-compatible DDL branch
- `db/seed.js` — async
- `server.js` — session store switching, async startup
- `routes/admin.js` — 64 call sites converted
- `routes/index.js` — 6 call sites converted
- `routes/stripe.js` — 1 call site converted
- `services/members.js` — 4 call sites converted
- `services/stripe.js` — 1 call site converted
- `services/card.js` — 6 call sites converted
- `services/email.js` — 3 call sites converted
- `middleware/locals.js` — 1 call site converted
- `scripts/create-admin.js` — 3 call sites converted
- `test/helpers/setupDb.js` — expose adapter API
- `package.json` — add `pg`, `connect-pg-simple`

---

## Verification

1. `npm test` — all existing tests pass (still using SQLite in-memory)
2. `npm run lint` — clean
3. `grep -r "db\.prepare" routes/ services/ middleware/` — zero matches (all converted)
4. Local dev: `npm run dev` — starts with SQLite, full smoke test
5. PG test: set `DATABASE_URL` to a local PostgreSQL instance, start server, verify migration/seed/signup flow
