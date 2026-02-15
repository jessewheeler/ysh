const db = require('../database');

function findAll() {
  return db.prepare('SELECT * FROM bios ORDER BY sort_order ASC').all();
}

function findAllVisible() {
  return db.prepare('SELECT * FROM bios WHERE is_visible = 1 ORDER BY sort_order ASC').all();
}

function findById(id) {
  return db.prepare('SELECT * FROM bios WHERE id = ?').get(id);
}

function getPhotoPath(id) {
  const row = db.prepare('SELECT photo_path FROM bios WHERE id = ?').get(id);
  return row?.photo_path || null;
}

function create({ name, role, bio_text, photo_path, sort_order, is_visible }) {
  return db.prepare(
    'INSERT INTO bios (name, role, bio_text, photo_path, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, role || null, bio_text || null, photo_path || null, parseInt(sort_order) || 0, is_visible ? 1 : 0);
}

function update(id, { name, role, bio_text, photo_path, sort_order, is_visible }) {
  return db.prepare(
    `UPDATE bios SET name=?, role=?, bio_text=?, photo_path=?, sort_order=?, is_visible=?, updated_at=datetime('now') WHERE id=?`
  ).run(name, role || null, bio_text || null, photo_path || null, parseInt(sort_order) || 0, is_visible ? 1 : 0, id);
}

function deleteById(id) {
  return db.prepare('DELETE FROM bios WHERE id = ?').run(id);
}

module.exports = {
  findAll,
  findAllVisible,
  findById,
  getPhotoPath,
  create,
  update,
  deleteById,
};
