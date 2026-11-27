const db = require('../database');
const { getActor } = require('../audit-context');
const auditLog = require('./auditLog');

// Funds are what a donor earmarks a gift for (issue #126). They are retired with setActive,
// never deleted: a donation keeps pointing at its fund so old totals stay attributed.

async function listActive() {
  return await db.all('SELECT * FROM donation_funds WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
}

async function listAll() {
  return await db.all('SELECT * FROM donation_funds ORDER BY is_active DESC, sort_order ASC, id ASC');
}

async function findById(id) {
  return await db.get('SELECT * FROM donation_funds WHERE id = ?', id);
}

async function create({ name, sort_order }) {
  const actor = getActor();
  const result = await db.run(
    'INSERT INTO donation_funds (name, sort_order, created_by, updated_by) VALUES (?, ?, ?, ?)',
    name, parseInt(sort_order) || 0, actor.id || null, actor.id || null
  );
  const row = await findById(result.lastInsertRowid);
  await auditLog.insert({
    tableName: 'donation_funds',
    recordId: result.lastInsertRowid,
    action: 'INSERT',
    actor,
    oldValues: null,
    newValues: row,
  });
  return row;
}

async function update(id, { name, sort_order }) {
  const actor = getActor();
  const old = await findById(id);
  if (!old) return null;
  await db.run(
    "UPDATE donation_funds SET name = ?, sort_order = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
    name, parseInt(sort_order) || 0, actor.id || null, id
  );
  const row = await findById(id);
  await auditLog.insert({ tableName: 'donation_funds', recordId: id, action: 'UPDATE', actor, oldValues: old, newValues: row });
  return row;
}

async function setActive(id, isActive) {
  const actor = getActor();
  const old = await findById(id);
  if (!old) return null;
  await db.run(
    "UPDATE donation_funds SET is_active = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
    isActive ? 1 : 0, actor.id || null, id
  );
  const row = await findById(id);
  await auditLog.insert({ tableName: 'donation_funds', recordId: id, action: 'UPDATE', actor, oldValues: old, newValues: row });
  return row;
}

module.exports = {
  listActive,
  listAll,
  findById,
  create,
  update,
  setActive,
};
