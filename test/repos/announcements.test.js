jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const announcementRepo = require('../../db/repos/announcements');

beforeEach(() => {
  db.__resetTestDb();
});

function insertAnnouncement(overrides = {}) {
  const a = { title: 'Test', body: 'Body', is_published: 1, sort_order: 0, ...overrides };
  const result = db.prepare(
    'INSERT INTO announcements (title, body, is_published, sort_order) VALUES (?, ?, ?, ?)'
  ).run(a.title, a.body, a.is_published, a.sort_order);
  return { ...a, id: result.lastInsertRowid };
}

describe('findAll / findAllPublished', () => {
  test('findAll returns all, findAllPublished filters', () => {
    insertAnnouncement({ title: 'Pub', is_published: 1 });
    insertAnnouncement({ title: 'Draft', is_published: 0 });
    expect(announcementRepo.findAll()).toHaveLength(2);
    expect(announcementRepo.findAllPublished()).toHaveLength(1);
  });
});

describe('findById', () => {
  test('returns announcement by id', () => {
    const a = insertAnnouncement({ title: 'Find me' });
    expect(announcementRepo.findById(a.id).title).toBe('Find me');
  });

  test('returns undefined for missing id', () => {
    expect(announcementRepo.findById(999)).toBeUndefined();
  });
});

describe('getImagePath', () => {
  test('returns image_path', () => {
    const result = db.prepare(
      'INSERT INTO announcements (title, image_path, is_published, sort_order) VALUES (?, ?, 1, 0)'
    ).run('T', '/img/test.jpg');
    expect(announcementRepo.getImagePath(result.lastInsertRowid)).toBe('/img/test.jpg');
  });

  test('returns null when no image', () => {
    const a = insertAnnouncement();
    expect(announcementRepo.getImagePath(a.id)).toBeNull();
  });
});

describe('create', () => {
  test('inserts and returns result', () => {
    const result = announcementRepo.create({ title: 'New', body: 'Body', is_published: true, sort_order: 1 });
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
  });
});

describe('update', () => {
  test('updates fields', () => {
    const a = insertAnnouncement({ title: 'Old' });
    announcementRepo.update(a.id, { title: 'New', is_published: true, sort_order: 0 });
    expect(announcementRepo.findById(a.id).title).toBe('New');
  });
});

describe('deleteById', () => {
  test('removes the announcement', () => {
    const a = insertAnnouncement();
    announcementRepo.deleteById(a.id);
    expect(announcementRepo.findById(a.id)).toBeUndefined();
  });
});
