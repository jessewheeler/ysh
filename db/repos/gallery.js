const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

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
    const actor = getActor();
    const result = await db.run(
        'INSERT INTO gallery_images (filename, alt_text, caption, sort_order, is_visible, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        filename, alt_text || null, caption || null, parseInt(sort_order) || 0, is_visible ? 1 : 0, actor.id || null, actor.id || null
  );
    const row = await db.get('SELECT * FROM gallery_images WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'gallery_images',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return result;
}

async function update(id, { filename, alt_text, caption, sort_order, is_visible }) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM gallery_images WHERE id = ?', id);
    const result = await db.run(
        "UPDATE gallery_images SET filename=?, alt_text=?, caption=?, sort_order=?, is_visible=?, updated_at=datetime('now'), updated_by=? WHERE id=?",
        filename, alt_text || null, caption || null, parseInt(sort_order) || 0, is_visible ? 1 : 0, actor.id || null, id
  );
    const row = await db.get('SELECT * FROM gallery_images WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'gallery_images',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return result;
}

async function deleteById(id) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM gallery_images WHERE id = ?', id);
    const result = await db.run('DELETE FROM gallery_images WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'gallery_images',
        recordId: id,
        action: 'DELETE',
        actor,
        oldValues: old,
        newValues: null
    });
    return result;
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
