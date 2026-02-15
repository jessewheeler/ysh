jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const settingsRepo = require('../../db/repos/settings');
const { insertSetting } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('getAll', () => {
  test('returns key-value object', () => {
    const testDb = db.__getCurrentDb();
    insertSetting(testDb, 'hero_title', 'Welcome');
    insertSetting(testDb, 'contact_email', 'a@b.com');
    const all = settingsRepo.getAll();
    expect(all.hero_title).toBe('Welcome');
    expect(all.contact_email).toBe('a@b.com');
  });

  test('returns empty object when no settings', () => {
    expect(settingsRepo.getAll()).toEqual({});
  });
});

describe('get', () => {
  test('returns value for key', () => {
    const testDb = db.__getCurrentDb();
    insertSetting(testDb, 'dues_amount_cents', '2500');
    expect(settingsRepo.get('dues_amount_cents')).toBe('2500');
  });

  test('returns null for missing key', () => {
    expect(settingsRepo.get('nonexistent')).toBeNull();
  });
});

describe('upsertMany', () => {
  test('inserts new settings', () => {
    settingsRepo.upsertMany({ hero_title: 'Hello', hero_subtitle: 'World' });
    expect(settingsRepo.get('hero_title')).toBe('Hello');
    expect(settingsRepo.get('hero_subtitle')).toBe('World');
  });

  test('updates existing settings', () => {
    const testDb = db.__getCurrentDb();
    insertSetting(testDb, 'hero_title', 'Old');
    settingsRepo.upsertMany({ hero_title: 'New' });
    expect(settingsRepo.get('hero_title')).toBe('New');
  });

  test('skips undefined values', () => {
    settingsRepo.upsertMany({ hero_title: 'Set', hero_subtitle: undefined });
    expect(settingsRepo.get('hero_title')).toBe('Set');
    expect(settingsRepo.get('hero_subtitle')).toBeNull();
  });
});
