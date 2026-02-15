jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/storage', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  deleteFile: jest.fn().mockResolvedValue(),
}));

const db = require('../../db/database');
const contentService = require('../../services/content');
const storage = require('../../services/storage');

beforeEach(() => {
  db.__resetTestDb();
  jest.clearAllMocks();
});

function insertAnnouncement(overrides = {}) {
  const a = { title: 'Test', body: 'Body', is_published: 1, sort_order: 0, ...overrides };
  const r = db.prepare('INSERT INTO announcements (title, body, image_path, is_published, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(a.title, a.body, a.image_path || null, a.is_published, a.sort_order);
  return { ...a, id: r.lastInsertRowid };
}

function insertGalleryImage(overrides = {}) {
  const g = { filename: 'img.jpg', is_visible: 1, sort_order: 0, ...overrides };
  const r = db.prepare('INSERT INTO gallery_images (filename, is_visible, sort_order) VALUES (?, ?, ?)')
    .run(g.filename, g.is_visible, g.sort_order);
  return { ...g, id: r.lastInsertRowid };
}

function insertBio(overrides = {}) {
  const b = { name: 'John', is_visible: 1, sort_order: 0, ...overrides };
  const r = db.prepare('INSERT INTO bios (name, photo_path, is_visible, sort_order) VALUES (?, ?, ?, ?)')
    .run(b.name, b.photo_path || null, b.is_visible, b.sort_order);
  return { ...b, id: r.lastInsertRowid };
}

describe('Announcements', () => {
  test('listAnnouncements returns all', async () => {
    insertAnnouncement({ title: 'A' });
    insertAnnouncement({ title: 'B', is_published: 0 });
    expect(await contentService.listAnnouncements()).toHaveLength(2);
  });

  test('listPublishedAnnouncements filters unpublished', async () => {
    insertAnnouncement({ title: 'A' });
    insertAnnouncement({ title: 'B', is_published: 0 });
    expect(await contentService.listPublishedAnnouncements()).toHaveLength(1);
  });

  test('getAnnouncement returns by id', async () => {
    const a = insertAnnouncement({ title: 'Find me' });
    expect((await contentService.getAnnouncement(a.id)).title).toBe('Find me');
  });

  test('createAnnouncement inserts', async () => {
    await contentService.createAnnouncement({ title: 'New', is_published: true, sort_order: 0 });
    expect(await contentService.listAnnouncements()).toHaveLength(1);
  });

  test('updateAnnouncement modifies', async () => {
    const a = insertAnnouncement({ title: 'Old' });
    await contentService.updateAnnouncement(a.id, { title: 'New', is_published: true, sort_order: 0 });
    expect((await contentService.getAnnouncement(a.id)).title).toBe('New');
  });

  test('deleteAnnouncement removes and cleans up image', async () => {
    const a = insertAnnouncement({ title: 'Del', image_path: '/img/old.jpg' });
    await contentService.deleteAnnouncement(a.id);
    expect(await contentService.getAnnouncement(a.id)).toBeUndefined();
    expect(storage.deleteFile).toHaveBeenCalledWith('/img/old.jpg');
  });
});

describe('Gallery', () => {
  test('listGalleryImages / listVisibleGalleryImages', async () => {
    insertGalleryImage();
    insertGalleryImage({ filename: 'h.jpg', is_visible: 0 });
    expect(await contentService.listGalleryImages()).toHaveLength(2);
    expect(await contentService.listVisibleGalleryImages()).toHaveLength(1);
  });

  test('CRUD cycle', async () => {
    await contentService.createGalleryImage({ filename: 'new.jpg', is_visible: true, sort_order: 0 });
    const all = await contentService.listGalleryImages();
    expect(all).toHaveLength(1);

    const id = all[0].id;
    await contentService.updateGalleryImage(id, { filename: 'upd.jpg', is_visible: true, sort_order: 0 });
    expect((await contentService.getGalleryImage(id)).filename).toBe('upd.jpg');

    await contentService.deleteGalleryImage(id);
    expect(await contentService.getGalleryImage(id)).toBeUndefined();
  });
});

describe('Bios', () => {
  test('listBios / listVisibleBios', async () => {
    insertBio();
    insertBio({ name: 'Hidden', is_visible: 0 });
    expect(await contentService.listBios()).toHaveLength(2);
    expect(await contentService.listVisibleBios()).toHaveLength(1);
  });

  test('CRUD cycle', async () => {
    await contentService.createBio({ name: 'New', is_visible: true, sort_order: 0 });
    const all = await contentService.listBios();
    expect(all).toHaveLength(1);

    const id = all[0].id;
    await contentService.updateBio(id, { name: 'Updated', is_visible: true, sort_order: 0 });
    expect((await contentService.getBio(id)).name).toBe('Updated');

    await contentService.deleteBio(id);
    expect(await contentService.getBio(id)).toBeUndefined();
  });

  test('deleteBio cleans up photo', async () => {
    const b = insertBio({ photo_path: '/img/photo.jpg' });
    await contentService.deleteBio(b.id);
    expect(storage.deleteFile).toHaveBeenCalledWith('/img/photo.jpg');
  });
});
