jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const settingsRepo = require('../../db/repos/settings');
const { insertSetting } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('getAll', () => {
  test('returns key-value object', async () => {
    const testDb = db.__getCurrentDb();
    insertSetting(testDb, 'hero_title', 'Welcome');
    insertSetting(testDb, 'contact_email', 'a@b.com');
    const all = await settingsRepo.getAll();
    expect(all.hero_title).toBe('Welcome');
    expect(all.contact_email).toBe('a@b.com');
  });

  test('returns empty object when no settings', async () => {
    expect(await settingsRepo.getAll()).toEqual({});
  });
});

describe('get', () => {
  test('returns value for key', async () => {
    const testDb = db.__getCurrentDb();
    insertSetting(testDb, 'dues_amount_cents', '2500');
    expect(await settingsRepo.get('dues_amount_cents')).toBe('2500');
  });

  test('returns null for missing key', async () => {
    expect(await settingsRepo.get('nonexistent')).toBeNull();
  });
});

describe('upsertMany', () => {
  test('inserts new settings', async () => {
    await settingsRepo.upsertMany({ hero_title: 'Hello', hero_subtitle: 'World' });
    expect(await settingsRepo.get('hero_title')).toBe('Hello');
    expect(await settingsRepo.get('hero_subtitle')).toBe('World');
  });

  test('updates existing settings', async () => {
    const testDb = db.__getCurrentDb();
    insertSetting(testDb, 'hero_title', 'Old');
    await settingsRepo.upsertMany({ hero_title: 'New' });
    expect(await settingsRepo.get('hero_title')).toBe('New');
  });

  test('skips undefined values', async () => {
    await settingsRepo.upsertMany({ hero_title: 'Set', hero_subtitle: undefined });
    expect(await settingsRepo.get('hero_title')).toBe('Set');
    expect(await settingsRepo.get('hero_subtitle')).toBeNull();
  });
});
