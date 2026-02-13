jest.mock('../../db/database', () => {
  const Database = require('better-sqlite3');
  let _db = new Database(':memory:');
  _db.pragma('foreign_keys = ON');

  const proxy = new Proxy({}, {
    get(_, prop) {
      if (prop === '__resetBare') {
        return () => {
          try { _db.close(); } catch (_e) { /* ignore */ }
          _db = new Database(':memory:');
          _db.pragma('foreign_keys = ON');
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
  'bios', 'site_settings', 'emails_log', 'membership_cards',
];

beforeEach(() => {
  db.__resetBare();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
});

describe('migrate()', () => {
  test('creates all 8 tables', () => {
    migrate();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all().map(r => r.name);

    for (const t of EXPECTED_TABLES) {
      expect(tables).toContain(t);
    }
  });

  test('is idempotent — calling twice does not throw', () => {
    migrate();
    expect(() => migrate()).not.toThrow();
  });

  test('members table has correct status CHECK constraint', () => {
    migrate();
    db.prepare(
      "INSERT INTO members (first_name, last_name, email, status) VALUES ('A','B','a@b.com','pending')"
    ).run();
    expect(() =>
      db.prepare(
        "INSERT INTO members (first_name, last_name, email, status) VALUES ('C','D','c@d.com','invalid')"
      ).run()
    ).toThrow();
  });

  test('payments table has correct status CHECK constraint', () => {
    migrate();
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

  test('members table has UNIQUE constraint on email', () => {
    migrate();
    db.prepare("INSERT INTO members (first_name, last_name, email) VALUES ('A','B','dup@a.com')").run();
    expect(() =>
      db.prepare("INSERT INTO members (first_name, last_name, email) VALUES ('C','D','dup@a.com')").run()
    ).toThrow();
  });

  test('members table has UNIQUE constraint on member_number', () => {
    migrate();
    db.prepare("INSERT INTO members (first_name, last_name, email, member_number) VALUES ('A','B','a@a.com','YSH-2025-0001')").run();
    expect(() =>
      db.prepare("INSERT INTO members (first_name, last_name, email, member_number) VALUES ('C','D','b@a.com','YSH-2025-0001')").run()
    ).toThrow();
  });

  test('site_settings uses key as PRIMARY KEY', () => {
    migrate();
    db.prepare("INSERT INTO site_settings (key, value) VALUES ('foo','bar')").run();
    expect(() =>
      db.prepare("INSERT INTO site_settings (key, value) VALUES ('foo','baz')").run()
    ).toThrow();
  });

  test('payments table has foreign key to members', () => {
    migrate();
    expect(() =>
      db.prepare("INSERT INTO payments (member_id, amount_cents) VALUES (999, 100)").run()
    ).toThrow();
  });

  test('emails_log table has email_type CHECK constraint', () => {
    migrate();
    db.prepare(
      "INSERT INTO emails_log (to_email, email_type) VALUES ('a@b.com','welcome')"
    ).run();
    expect(() =>
      db.prepare(
        "INSERT INTO emails_log (to_email, email_type) VALUES ('a@b.com','invalid_type')"
      ).run()
    ).toThrow();
  });

  test('emails_log table accepts otp email_type', () => {
    migrate();
    expect(() =>
      db.prepare(
        "INSERT INTO emails_log (to_email, email_type) VALUES ('a@b.com','otp')"
      ).run()
    ).not.toThrow();
  });

  test('members table has correct role CHECK constraint', () => {
    migrate();
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

  test('members table allows NULL role for regular members', () => {
    migrate();
    db.prepare(
      "INSERT INTO members (first_name, last_name, email) VALUES ('A', 'B', 'reg@a.com')"
    ).run();
    const member = db.prepare("SELECT role FROM members WHERE email = 'reg@a.com'").get();
    expect(member.role).toBeNull();
  });

  test('creates tables with correct default values', () => {
    migrate();
    db.prepare("INSERT INTO members (first_name, last_name, email) VALUES ('A','B','def@a.com')").run();
    const member = db.prepare("SELECT status, created_at FROM members WHERE email = 'def@a.com'").get();
    expect(member.status).toBe('pending');
    expect(member.created_at).toBeTruthy();
  });
});
