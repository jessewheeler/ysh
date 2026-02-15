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
  test('filters by visibility', () => {
    insertImage({ is_visible: 1 });
    insertImage({ filename: 'hidden.jpg', is_visible: 0 });
    expect(galleryRepo.findAll()).toHaveLength(2);
    expect(galleryRepo.findAllVisible()).toHaveLength(1);
  });
});

describe('findById', () => {
  test('returns image by id', () => {
    const g = insertImage({ filename: 'test.jpg' });
    expect(galleryRepo.findById(g.id).filename).toBe('test.jpg');
  });
});

describe('getFilename', () => {
  test('returns filename', () => {
    const g = insertImage({ filename: 'photo.png' });
    expect(galleryRepo.getFilename(g.id)).toBe('photo.png');
  });

  test('returns null for missing id', () => {
    expect(galleryRepo.getFilename(999)).toBeNull();
  });
});

describe('create / update / deleteById', () => {
  test('full CRUD cycle', () => {
    const result = galleryRepo.create({ filename: 'new.jpg', is_visible: true, sort_order: 0 });
    const id = result.lastInsertRowid;
    expect(galleryRepo.findById(id).filename).toBe('new.jpg');

    galleryRepo.update(id, { filename: 'updated.jpg', is_visible: true, sort_order: 1 });
    expect(galleryRepo.findById(id).filename).toBe('updated.jpg');

    galleryRepo.deleteById(id);
    expect(galleryRepo.findById(id)).toBeUndefined();
  });
});
