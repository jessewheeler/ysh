const db = require('../database');

function findAll() {
  return db.prepare('SELECT * FROM announcements ORDER BY sort_order ASC').all();
}

function findAllPublished() {
  return db.prepare('SELECT * FROM announcements WHERE is_published = 1 ORDER BY sort_order ASC').all();
}

function findById(id) {
  return db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
}

function getImagePath(id) {
  const row = db.prepare('SELECT image_path FROM announcements WHERE id = ?').get(id);
  return row?.image_path || null;
}

function create({ title, body, image_path, link_url, link_text, is_published, sort_order }) {
  return db.prepare(
    'INSERT INTO announcements (title, body, image_path, link_url, link_text, is_published, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(title, body || null, image_path || null, link_url || null, link_text || null, is_published ? 1 : 0, parseInt(sort_order) || 0);
}

function update(id, { title, body, image_path, link_url, link_text, is_published, sort_order }) {
  return db.prepare(
    `UPDATE announcements SET title=?, body=?, image_path=?, link_url=?, link_text=?, is_published=?, sort_order=?, updated_at=datetime('now') WHERE id=?`
  ).run(title, body || null, image_path || null, link_url || null, link_text || null, is_published ? 1 : 0, parseInt(sort_order) || 0, id);
}

function deleteById(id) {
  return db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
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
