const db = require('../database');

function findAll() {
  return db.prepare('SELECT * FROM gallery_images ORDER BY sort_order ASC').all();
}

function findAllVisible() {
  return db.prepare('SELECT * FROM gallery_images WHERE is_visible = 1 ORDER BY sort_order ASC').all();
}

function findById(id) {
  return db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(id);
}

function getFilename(id) {
  const row = db.prepare('SELECT filename FROM gallery_images WHERE id = ?').get(id);
  return row?.filename || null;
}

function create({ filename, alt_text, caption, sort_order, is_visible }) {
  return db.prepare(
    'INSERT INTO gallery_images (filename, alt_text, caption, sort_order, is_visible) VALUES (?, ?, ?, ?, ?)'
  ).run(filename, alt_text || null, caption || null, parseInt(sort_order) || 0, is_visible ? 1 : 0);
}

function update(id, { filename, alt_text, caption, sort_order, is_visible }) {
  return db.prepare(
    'UPDATE gallery_images SET filename=?, alt_text=?, caption=?, sort_order=?, is_visible=? WHERE id=?'
  ).run(filename, alt_text || null, caption || null, parseInt(sort_order) || 0, is_visible ? 1 : 0, id);
}

function deleteById(id) {
  return db.prepare('DELETE FROM gallery_images WHERE id = ?').run(id);
}

module.exports = {
  findAll,
  findAllVisible,
  findById,
  getFilename,
  create,
  update,
  deleteById,
};
