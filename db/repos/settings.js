const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

async function getAll() {
  const rows = await db.all('SELECT key, value FROM site_settings');
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

async function get(key) {
  const row = await db.get('SELECT value FROM site_settings WHERE key = ?', key);
  return row?.value || null;
}

async function upsertMany(keyValues) {
    const actor = getActor();
  await db.transaction(async () => {
    for (const [key, value] of Object.entries(keyValues)) {
      if (value !== undefined) {
          const old = await db.get('SELECT * FROM site_settings WHERE key = ?', key);
        await db.run(
            "INSERT INTO site_settings (key, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by",
            key, value, actor.id || null
        );
          const row = await db.get('SELECT * FROM site_settings WHERE key = ?', key);
          const action = old ? 'UPDATE' : 'INSERT';
          await auditLog.insert({
              tableName: 'site_settings',
              recordId: key,
              action,
              actor,
              oldValues: old || null,
              newValues: row
          });
      }
    }
  });
}

module.exports = {
  getAll,
  get,
  upsertMany,
};
