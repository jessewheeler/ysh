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
  test('filters by visibility', () => {
    insertBio({ is_visible: 1 });
    insertBio({ name: 'Hidden', is_visible: 0 });
    expect(biosRepo.findAll()).toHaveLength(2);
    expect(biosRepo.findAllVisible()).toHaveLength(1);
  });
});

describe('findById', () => {
  test('returns bio by id', () => {
    const b = insertBio({ name: 'Find Me' });
    expect(biosRepo.findById(b.id).name).toBe('Find Me');
  });
});

describe('getPhotoPath', () => {
  test('returns photo_path', () => {
    const result = db.prepare(
      'INSERT INTO bios (name, photo_path, sort_order, is_visible) VALUES (?, ?, 0, 1)'
    ).run('Test', '/img/photo.jpg');
    expect(biosRepo.getPhotoPath(result.lastInsertRowid)).toBe('/img/photo.jpg');
  });

  test('returns null when no photo', () => {
    const b = insertBio();
    expect(biosRepo.getPhotoPath(b.id)).toBeNull();
  });
});

describe('create / update / deleteById', () => {
  test('full CRUD cycle', () => {
    const result = biosRepo.create({ name: 'New Bio', is_visible: true, sort_order: 0 });
    const id = result.lastInsertRowid;
    expect(biosRepo.findById(id).name).toBe('New Bio');

    biosRepo.update(id, { name: 'Updated', is_visible: true, sort_order: 1 });
    expect(biosRepo.findById(id).name).toBe('Updated');

    biosRepo.deleteById(id);
    expect(biosRepo.findById(id)).toBeUndefined();
  });
});
