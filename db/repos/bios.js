const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

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
    const actor = getActor();
    const result = await db.run(
        'INSERT INTO bios (name, role, bio_text, photo_path, sort_order, is_visible, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        name, role || null, bio_text || null, photo_path || null, parseInt(sort_order) || 0, is_visible ? 1 : 0, actor.id || null, actor.id || null
  );
    const row = await db.get('SELECT * FROM bios WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'bios',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return result;
}

async function update(id, { name, role, bio_text, photo_path, sort_order, is_visible }) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM bios WHERE id = ?', id);
    const result = await db.run(
        `UPDATE bios SET name=?, role=?, bio_text=?, photo_path=?, sort_order=?, is_visible=?, updated_at=datetime('now'), updated_by=? WHERE id=?`,
        name, role || null, bio_text || null, photo_path || null, parseInt(sort_order) || 0, is_visible ? 1 : 0, actor.id || null, id
  );
    const row = await db.get('SELECT * FROM bios WHERE id = ?', id);
    await auditLog.insert({tableName: 'bios', recordId: id, action: 'UPDATE', actor, oldValues: old, newValues: row});
    return result;
}

async function deleteById(id) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM bios WHERE id = ?', id);
    const result = await db.run('DELETE FROM bios WHERE id = ?', id);
    await auditLog.insert({tableName: 'bios', recordId: id, action: 'DELETE', actor, oldValues: old, newValues: null});
    return result;
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
