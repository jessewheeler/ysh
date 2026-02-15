const db = require('../database');

async function findAll() {
  return await db.all('SELECT * FROM announcements ORDER BY sort_order ASC');
}

async function findAllPublished() {
  return await db.all('SELECT * FROM announcements WHERE is_published = 1 ORDER BY sort_order ASC');
}

async function findById(id) {
  return await db.get('SELECT * FROM announcements WHERE id = ?', id);
}

async function getImagePath(id) {
  const row = await db.get('SELECT image_path FROM announcements WHERE id = ?', id);
  return row?.image_path || null;
}

async function create({ title, body, image_path, link_url, link_text, is_published, sort_order }) {
  return await db.run(
    'INSERT INTO announcements (title, body, image_path, link_url, link_text, is_published, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    title, body || null, image_path || null, link_url || null, link_text || null, is_published ? 1 : 0, parseInt(sort_order) || 0
  );
}

async function update(id, { title, body, image_path, link_url, link_text, is_published, sort_order }) {
  return await db.run(
    `UPDATE announcements SET title=?, body=?, image_path=?, link_url=?, link_text=?, is_published=?, sort_order=?, updated_at=datetime('now') WHERE id=?`,
    title, body || null, image_path || null, link_url || null, link_text || null, is_published ? 1 : 0, parseInt(sort_order) || 0, id
  );
}

async function deleteById(id) {
  return await db.run('DELETE FROM announcements WHERE id = ?', id);
}

module.exports = {
  findAll,
  findAllPublished,
  findById,
  getImagePath,
  create,
  update,
  deleteById,
};
