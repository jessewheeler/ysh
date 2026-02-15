jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const biosRepo = require('../../db/repos/bios');

beforeEach(() => {
  db.__resetTestDb();
});

function insertBio(overrides = {}) {
  const b = { name: 'John Doe', role: 'President', bio_text: 'Bio', sort_order: 0, is_visible: 1, ...overrides };
  const result = db.prepare(
    'INSERT INTO bios (name, role, bio_text, sort_order, is_visible) VALUES (?, ?, ?, ?, ?)'
  ).run(b.name, b.role, b.bio_text, b.sort_order, b.is_visible);
  return { ...b, id: result.lastInsertRowid };
}

describe('findAll / findAllVisible', () => {
  test('filters by visibility', async () => {
    insertBio({ is_visible: 1 });
    insertBio({ name: 'Hidden', is_visible: 0 });
    expect(await biosRepo.findAll()).toHaveLength(2);
    expect(await biosRepo.findAllVisible()).toHaveLength(1);
  });
});

describe('findById', () => {
  test('returns bio by id', async () => {
    const b = insertBio({ name: 'Find Me' });
    const found = await biosRepo.findById(b.id);
    expect(found.name).toBe('Find Me');
  });
});

describe('getPhotoPath', () => {
  test('returns photo_path', async () => {
    const result = db.prepare(
      'INSERT INTO bios (name, photo_path, sort_order, is_visible) VALUES (?, ?, 0, 1)'
    ).run('Test', '/img/photo.jpg');
    expect(await biosRepo.getPhotoPath(result.lastInsertRowid)).toBe('/img/photo.jpg');
  });

  test('returns null when no photo', async () => {
    const b = insertBio();
    expect(await biosRepo.getPhotoPath(b.id)).toBeNull();
  });
});

describe('create / update / deleteById', () => {
  test('full CRUD cycle', async () => {
    const result = await biosRepo.create({ name: 'New Bio', is_visible: true, sort_order: 0 });
    const id = result.lastInsertRowid;
    const found = await biosRepo.findById(id);
    expect(found.name).toBe('New Bio');

    await biosRepo.update(id, { name: 'Updated', is_visible: true, sort_order: 1 });
    const updated = await biosRepo.findById(id);
    expect(updated.name).toBe('Updated');

    await biosRepo.deleteById(id);
    const deleted = await biosRepo.findById(id);
    expect(deleted).toBeUndefined();
  });
});
