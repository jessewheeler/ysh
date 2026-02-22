const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

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
    const actor = getActor();
    const result = await db.run(
        'INSERT INTO announcements (title, body, image_path, link_url, link_text, is_published, sort_order, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        title, body || null, image_path || null, link_url || null, link_text || null, is_published ? 1 : 0, parseInt(sort_order) || 0, actor.id || null, actor.id || null
  );
    const row = await db.get('SELECT * FROM announcements WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'announcements',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return result;
}

async function update(id, { title, body, image_path, link_url, link_text, is_published, sort_order }) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM announcements WHERE id = ?', id);
    const result = await db.run(
        `UPDATE announcements SET title=?, body=?, image_path=?, link_url=?, link_text=?, is_published=?, sort_order=?, updated_at=datetime('now'), updated_by=? WHERE id=?`,
        title, body || null, image_path || null, link_url || null, link_text || null, is_published ? 1 : 0, parseInt(sort_order) || 0, actor.id || null, id
  );
    const row = await db.get('SELECT * FROM announcements WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'announcements',
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
    const old = await db.get('SELECT * FROM announcements WHERE id = ?', id);
    const result = await db.run('DELETE FROM announcements WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'announcements',
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
  findAllPublished,
  findById,
  getImagePath,
  create,
  update,
  deleteById,
};
