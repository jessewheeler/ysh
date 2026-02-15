const db = require('../database');

async function findAll() {
  return await db.all('SELECT * FROM gallery_images ORDER BY sort_order ASC');
}

async function findAllVisible() {
  return await db.all('SELECT * FROM gallery_images WHERE is_visible = 1 ORDER BY sort_order ASC');
}

async function findById(id) {
  return await db.get('SELECT * FROM gallery_images WHERE id = ?', id);
}

async function getFilename(id) {
  const row = await db.get('SELECT filename FROM gallery_images WHERE id = ?', id);
  return row?.filename || null;
}

async function create({ filename, alt_text, caption, sort_order, is_visible }) {
  return await db.run(
    'INSERT INTO gallery_images (filename, alt_text, caption, sort_order, is_visible) VALUES (?, ?, ?, ?, ?)',
    filename, alt_text || null, caption || null, parseInt(sort_order) || 0, is_visible ? 1 : 0
  );
}

async function update(id, { filename, alt_text, caption, sort_order, is_visible }) {
  return await db.run(
    'UPDATE gallery_images SET filename=?, alt_text=?, caption=?, sort_order=?, is_visible=? WHERE id=?',
    filename, alt_text || null, caption || null, parseInt(sort_order) || 0, is_visible ? 1 : 0, id
  );
}

async function deleteById(id) {
  return await db.run('DELETE FROM gallery_images WHERE id = ?', id);
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
