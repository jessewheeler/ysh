const db = require('../database');

async function findAll() {
  return await db.all('SELECT * FROM bios ORDER BY sort_order ASC');
}

async function findAllVisible() {
  return await db.all('SELECT * FROM bios WHERE is_visible = 1 ORDER BY sort_order ASC');
}

async function findById(id) {
  return await db.get('SELECT * FROM bios WHERE id = ?', id);
}

async function getPhotoPath(id) {
  const row = await db.get('SELECT photo_path FROM bios WHERE id = ?', id);
  return row?.photo_path || null;
}

async function create({ name, role, bio_text, photo_path, sort_order, is_visible }) {
  return await db.run(
    'INSERT INTO bios (name, role, bio_text, photo_path, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, ?)',
    name, role || null, bio_text || null, photo_path || null, parseInt(sort_order) || 0, is_visible ? 1 : 0
  );
}

async function update(id, { name, role, bio_text, photo_path, sort_order, is_visible }) {
  return await db.run(
    `UPDATE bios SET name=?, role=?, bio_text=?, photo_path=?, sort_order=?, is_visible=?, updated_at=datetime('now') WHERE id=?`,
    name, role || null, bio_text || null, photo_path || null, parseInt(sort_order) || 0, is_visible ? 1 : 0, id
  );
}

async function deleteById(id) {
  return await db.run('DELETE FROM bios WHERE id = ?', id);
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
