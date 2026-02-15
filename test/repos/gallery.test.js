jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const galleryRepo = require('../../db/repos/gallery');

beforeEach(() => {
  db.__resetTestDb();
});

function insertImage(overrides = {}) {
  const g = { filename: 'img.jpg', alt_text: 'Alt', sort_order: 0, is_visible: 1, ...overrides };
  const result = db.prepare(
    'INSERT INTO gallery_images (filename, alt_text, sort_order, is_visible) VALUES (?, ?, ?, ?)'
  ).run(g.filename, g.alt_text, g.sort_order, g.is_visible);
  return { ...g, id: result.lastInsertRowid };
}

describe('findAll / findAllVisible', () => {
  test('filters by visibility', async () => {
    insertImage({ is_visible: 1 });
    insertImage({ filename: 'hidden.jpg', is_visible: 0 });
    expect(await galleryRepo.findAll()).toHaveLength(2);
    expect(await galleryRepo.findAllVisible()).toHaveLength(1);
  });
});

describe('findById', () => {
  test('returns image by id', async () => {
    const g = insertImage({ filename: 'test.jpg' });
    const found = await galleryRepo.findById(g.id);
    expect(found.filename).toBe('test.jpg');
  });
});

describe('getFilename', () => {
  test('returns filename', async () => {
    const g = insertImage({ filename: 'photo.png' });
    expect(await galleryRepo.getFilename(g.id)).toBe('photo.png');
  });

  test('returns null for missing id', async () => {
    expect(await galleryRepo.getFilename(999)).toBeNull();
  });
});

describe('create / update / deleteById', () => {
  test('full CRUD cycle', async () => {
    const result = await galleryRepo.create({ filename: 'new.jpg', is_visible: true, sort_order: 0 });
    const id = result.lastInsertRowid;
    const found = await galleryRepo.findById(id);
    expect(found.filename).toBe('new.jpg');

    await galleryRepo.update(id, { filename: 'updated.jpg', is_visible: true, sort_order: 1 });
    const updated = await galleryRepo.findById(id);
    expect(updated.filename).toBe('updated.jpg');

    await galleryRepo.deleteById(id);
    const deleted = await galleryRepo.findById(id);
    expect(deleted).toBeUndefined();
  });
});
