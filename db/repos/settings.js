const db = require('../database');

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
  await db.transaction(async () => {
    for (const [key, value] of Object.entries(keyValues)) {
      if (value !== undefined) {
        await db.run(
          "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
          key, value
        );
      }
    }
  });
}

module.exports = {
  getAll,
  get,
  upsertMany,
};
