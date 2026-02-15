const db = require('../database');

function getAll() {
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

function get(key) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key);
  return row?.value || null;
}

function upsertMany(keyValues) {
  const upsert = db.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  );
  const txn = db.transaction(() => {
    for (const [key, value] of Object.entries(keyValues)) {
      if (value !== undefined) {
        upsert.run(key, value);
      }
    }
  });
  txn();
}

module.exports = {
  getAll,
  get,
  upsertMany,
};
