jest.mock('../../db/database', () => {
  const Database = require('better-sqlite3');
  let _db = new Database(':memory:');
  _db.pragma('foreign_keys = ON');

  const proxy = new Proxy({}, {
    get(_, prop) {
      if (prop === 'dialect') return 'sqlite';
      if (prop === '__resetBare') {
        return () => {
          try { _db.close(); } catch (_e) { /* ignore */ }
          _db = new Database(':memory:');
          _db.pragma('foreign_keys = ON');
        };
      }
      if (prop === 'get') {
        return async (sql, ...params) => {
          const sanitized = params.map(p => p === undefined ? null : p);
          return _db.prepare(sql).get(...sanitized);
        };
      }
      if (prop === 'all') {
        return async (sql, ...params) => {
          const sanitized = params.map(p => p === undefined ? null : p);
          return _db.prepare(sql).all(...sanitized);
        };
      }
      if (prop === 'run') {
        return async (sql, ...params) => {
          const sanitized = params.map(p => p === undefined ? null : p);
          return _db.prepare(sql).run(...sanitized);
        };
      }
      if (prop === 'exec') {
        return async (sql) => _db.exec(sql);
      }
      if (prop === 'transaction') {
        return async (fn) => {
          const isAsync = fn.constructor.name === 'AsyncFunction';
          if (!isAsync) {
            return _db.transaction(fn)();
          } else {
            _db.prepare('BEGIN').run();
            try {
              const result = await fn();
              _db.prepare('COMMIT').run();
              return result;
            } catch (e) {
              _db.prepare('ROLLBACK').run();
              throw e;
            }
          }
        };
      }
      const val = _db[prop];
      if (typeof val === 'function') return val.bind(_db);
      return val;
    },
  });
  return proxy;
});

const db = require('../../db/database');
const migrate = require('../../db/migrate');

const EXPECTED_TABLES = [
  'members', 'payments', 'announcements', 'gallery_images',
  'bios', 'site_settings', 'emails_log', 'membership_cards', 'audit_log',
];

beforeEach(() => {
  db.__resetBare();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
});

describe('migrate()', () => {
  test('creates all 9 tables', async () => {
    await migrate();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all().map(r => r.name);

    for (const t of EXPECTED_TABLES) {
      expect(tables).toContain(t);
    }
  });

  test('is idempotent — calling twice does not throw', async () => {
    await migrate();
    await expect(migrate()).resolves.not.toThrow();
  });

  test('members table has correct status CHECK constraint', async () => {
    await migrate();
    db.prepare(
      "INSERT INTO members (first_name, last_name, email, status) VALUES ('A','B','a@b.com','pending')"
    ).run();
    expect(() =>
      db.prepare(
        "INSERT INTO members (first_name, last_name, email, status) VALUES ('C','D','c@d.com','invalid')"
      ).run()
    ).toThrow();
  });

  test('payments table has correct status CHECK constraint', async () => {
    await migrate();
    db.prepare(
      "INSERT INTO members (first_name, last_name, email) VALUES ('A','B','x@y.com')"
    ).run();
    const memberId = db.prepare('SELECT id FROM members LIMIT 1').get().id;
    db.prepare(
      "INSERT INTO payments (member_id, amount_cents, status) VALUES (?, 100, 'pending')"
    ).run(memberId);
    expect(() =>
      db.prepare(
        "INSERT INTO payments (member_id, amount_cents, status) VALUES (?, 100, 'bogus')"
      ).run(memberId)
    ).toThrow();
  });

  test('members table allows duplicate emails for family sub-members', async () => {
    await migrate();
    const {lastInsertRowid: primaryId} = db.prepare(
        "INSERT INTO members (first_name, last_name, email, membership_type) VALUES ('A','B','shared@family.com','family')"
    ).run();
    // Sub-members (primary_member_id IS NOT NULL) can share the primary's email
    expect(() =>
        db.prepare("INSERT INTO members (first_name, last_name, email, membership_type, primary_member_id) VALUES ('C','D','shared@family.com','family',?)").run(primaryId)
    ).not.toThrow();
  });

  test('members table enforces unique emails among primary members', async () => {
    await migrate();
    db.prepare("INSERT INTO members (first_name, last_name, email) VALUES ('A','B','dup@test.com')").run();
    expect(() =>
        db.prepare("INSERT INTO members (first_name, last_name, email) VALUES ('C','D','dup@test.com')").run()
    ).toThrow();
  });

  test('members table has UNIQUE constraint on member_number', async () => {
    await migrate();
    db.prepare("INSERT INTO members (first_name, last_name, email, member_number) VALUES ('A','B','a@a.com','YSH-2025-0001')").run();
    expect(() =>
      db.prepare("INSERT INTO members (first_name, last_name, email, member_number) VALUES ('C','D','b@a.com','YSH-2025-0001')").run()
    ).toThrow();
  });

  test('site_settings uses key as PRIMARY KEY', async () => {
    await migrate();
    db.prepare("INSERT INTO site_settings (key, value) VALUES ('foo','bar')").run();
    expect(() =>
      db.prepare("INSERT INTO site_settings (key, value) VALUES ('foo','baz')").run()
    ).toThrow();
  });

  test('payments table has foreign key to members', async () => {
    await migrate();
    expect(() =>
      db.prepare("INSERT INTO payments (member_id, amount_cents) VALUES (999, 100)").run()
    ).toThrow();
  });

  test('emails_log table has email_type CHECK constraint', async () => {
    await migrate();
    db.prepare(
      "INSERT INTO emails_log (to_email, email_type) VALUES ('a@b.com','welcome')"
    ).run();
    expect(() =>
      db.prepare(
        "INSERT INTO emails_log (to_email, email_type) VALUES ('a@b.com','invalid_type')"
      ).run()
    ).toThrow();
  });

  test('emails_log table accepts otp email_type', async () => {
    await migrate();
    expect(() =>
      db.prepare(
        "INSERT INTO emails_log (to_email, email_type) VALUES ('a@b.com','otp')"
      ).run()
    ).not.toThrow();
  });

  test('emails_log table accepts renewal_reminder email_type', async () => {
    await migrate();
    expect(() =>
        db.prepare(
            "INSERT INTO emails_log (to_email, email_type) VALUES ('a@b.com','renewal_reminder')"
        ).run()
    ).not.toThrow();
  });

  test('members table has expiry_date column', async () => {
    await migrate();
    db.prepare("INSERT INTO members (first_name, last_name, email, expiry_date) VALUES ('A','B','exp@a.com','2026-08-01')").run();
    const member = db.prepare("SELECT expiry_date FROM members WHERE email = 'exp@a.com'").get();
    expect(member.expiry_date).toBe('2026-08-01');
  });

  test('members table has renewal_token column', async () => {
    await migrate();
    db.prepare("INSERT INTO members (first_name, last_name, email, renewal_token) VALUES ('A','B','tok@a.com','abc123')").run();
    const member = db.prepare("SELECT renewal_token FROM members WHERE email = 'tok@a.com'").get();
    expect(member.renewal_token).toBe('abc123');
  });

  test('members table has renewal_token_expires_at column', async () => {
    await migrate();
    db.prepare("INSERT INTO members (first_name, last_name, email, renewal_token_expires_at) VALUES ('A','B','exp2@a.com','2026-10-01T00:00:00.000Z')").run();
    const member = db.prepare("SELECT renewal_token_expires_at FROM members WHERE email = 'exp2@a.com'").get();
    expect(member.renewal_token_expires_at).toBe('2026-10-01T00:00:00.000Z');
  });

  test('members table has correct role CHECK constraint', async () => {
    await migrate();
    db.prepare(
      "INSERT INTO members (first_name, last_name, email, role) VALUES ('A', 'B', 'a@b.com', 'super_admin')"
    ).run();
    db.prepare(
      "INSERT INTO members (first_name, last_name, email, role) VALUES ('C', 'D', 'b@b.com', 'editor')"
    ).run();
    expect(() =>
      db.prepare(
        "INSERT INTO members (first_name, last_name, email, role) VALUES ('E', 'F', 'c@b.com', 'invalid')"
      ).run()
    ).toThrow();
  });

  test('members table allows NULL role for regular members', async () => {
    await migrate();
    db.prepare(
      "INSERT INTO members (first_name, last_name, email) VALUES ('A', 'B', 'reg@a.com')"
    ).run();
    const member = db.prepare("SELECT role FROM members WHERE email = 'reg@a.com'").get();
    expect(member.role).toBeNull();
  });

  test('creates tables with correct default values', async () => {
    await migrate();
    db.prepare("INSERT INTO members (first_name, last_name, email) VALUES ('A','B','def@a.com')").run();
    const member = db.prepare("SELECT status, created_at FROM members WHERE email = 'def@a.com'").get();
    expect(member.status).toBe('pending');
    expect(member.created_at).toBeTruthy();
  });
});

describe("payments status CHECK widened to 'voided' (issue #108)", () => {
  /**
   * Rebuilds payments the way a database from before #108 had it — no 'voided' in the
   * CHECK, no void columns — with a member, a payment and an enrollment citing it, so the
   * migration has a real foreign key to preserve.
   */
  async function seedOldPayments() {
    await migrate();
    db.prepare("INSERT INTO members (first_name, last_name, email) VALUES ('A','B','x@y.com')").run();
    const memberId = db.prepare('SELECT id FROM members LIMIT 1').get().id;
    db.prepare("INSERT INTO membership_periods (label, start_date, end_date, individual_dues_cents, family_dues_cents) VALUES ('2020', '2020-01-01', '2020-12-31', 1600, 2600)").run();
    const periodId = db.prepare('SELECT id FROM membership_periods LIMIT 1').get().id;

    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE payments_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
        stripe_session_id TEXT,
        stripe_payment_intent TEXT,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','refunded')),
        description TEXT,
        failure_reason TEXT,
        payment_method TEXT NOT NULL DEFAULT 'stripe',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
        updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL
      );
      DROP TABLE payments;
      ALTER TABLE payments_old RENAME TO payments;
    `);
    db.pragma('foreign_keys = ON');

    db.prepare("INSERT INTO payments (id, member_id, amount_cents, status, payment_method, description) VALUES (7, ?, 2600, 'completed', 'check', 'Dues')").run(memberId);
    db.prepare('INSERT INTO membership_years (member_id, membership_period_id, payment_id) VALUES (?, ?, 7)').run(memberId, periodId);
    return { memberId, periodId };
  }

  test('rebuilds the table, keeps the rows and the enrollment citation, and accepts voided', async () => {
    const { memberId } = await seedOldPayments();
    expect(() => db.prepare("UPDATE payments SET status = 'voided' WHERE id = 7").run()).toThrow();

    await migrate();

    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get().sql;
    expect(ddl).toContain("'voided'");
    expect(ddl).toContain('void_reason');

    const payment = db.prepare('SELECT * FROM payments WHERE id = 7').get();
    expect(payment.member_id).toBe(memberId);
    expect(payment.amount_cents).toBe(2600);
    expect(payment.payment_method).toBe('check');
    expect(payment.description).toBe('Dues');
    expect(payment.void_reason).toBeNull();

    const enrollment = db.prepare('SELECT * FROM membership_years WHERE payment_id = 7').get();
    expect(enrollment).toBeTruthy();
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

    expect(() => db.prepare("UPDATE payments SET status = 'voided', void_reason = 'duplicate' WHERE id = 7").run()).not.toThrow();
    expect(() => db.prepare("UPDATE payments SET void_reason = 'bogus' WHERE id = 7").run()).toThrow();
    expect(db.prepare('SELECT name FROM sqlite_master WHERE type=\'index\' AND name=\'idx_payments_member_status\'').get()).toBeTruthy();
  });

  test('tolerates foreign key violations that were already there', async () => {
    const { memberId } = await seedOldPayments();
    // An orphan from before ON DELETE CASCADE: a payment whose member is gone.
    db.pragma('foreign_keys = OFF');
    db.prepare("INSERT INTO payments (id, member_id, amount_cents, status) VALUES (8, 9999, 100, 'completed')").run();
    db.pragma('foreign_keys = ON');
    expect(db.pragma('foreign_key_check')).toHaveLength(1);

    await expect(migrate()).resolves.not.toThrow();

    expect(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get().sql).toContain("'voided'");
    expect(db.prepare('SELECT member_id FROM payments WHERE id = 8').get().member_id).toBe(9999);
    expect(db.prepare('SELECT member_id FROM payments WHERE id = 7').get().member_id).toBe(memberId);
    expect(db.pragma('foreign_key_check')).toHaveLength(1);
  });

  test('a fresh database already allows voided and the migration leaves it alone', async () => {
    await migrate();
    const before = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get().sql;
    await migrate();
    const after = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'").get().sql;
    expect(after).toBe(before);
    expect(after).toContain("'voided'");
  });
});
