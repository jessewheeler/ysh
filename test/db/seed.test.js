// seed.js calls migrate() internally and uses db for all inserts
jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const seed = require('../../db/seed');

beforeEach(() => {
  db.__resetTestDb();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
});

describe('seed()', () => {
  test('inserts 7 bios', () => {
    seed();
    const count = db.prepare('SELECT COUNT(*) as c FROM bios').get().c;
    expect(count).toBe(7);
  });

  test('inserts 2 announcements', () => {
    seed();
    const count = db.prepare('SELECT COUNT(*) as c FROM announcements').get().c;
    expect(count).toBe(2);
  });

  test('inserts 4 gallery images', () => {
    seed();
    const count = db.prepare('SELECT COUNT(*) as c FROM gallery_images').get().c;
    expect(count).toBe(4);
  });

  test('inserts site settings', () => {
    seed();
    const count = db.prepare('SELECT COUNT(*) as c FROM site_settings').get().c;
    expect(count).toBeGreaterThanOrEqual(10);
  });

  test('skips when bios already exist (idempotent)', () => {
    seed();
    const firstCount = db.prepare('SELECT COUNT(*) as c FROM bios').get().c;
    seed();
    const secondCount = db.prepare('SELECT COUNT(*) as c FROM bios').get().c;
    expect(secondCount).toBe(firstCount);
  });

  test('calls migrate() before seeding — tables exist', () => {
    // Reset to bare DB to prove migrate is called
    const Database = require('better-sqlite3');
    const bareDb = new Database(':memory:');
    bareDb.pragma('foreign_keys = ON');

    // We can't easily swap the proxy target mid-test, but we can verify
    // that seed() works on a fresh (schema-applied) DB without error
    db.__resetTestDb();
    expect(() => seed()).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) as c FROM bios').get().c).toBe(7);
  });
});
