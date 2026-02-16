const db = require('./database');
const { SCHEMA, toPgSchema } = require('./schema');

async function migrate() {
  if (db.dialect === 'pg') {
    await db.exec(toPgSchema(SCHEMA));
    console.log('PostgreSQL schema creation complete.');
    return;
  }

  // SQLite migration path — uses canonical schema for fresh installs (CREATE IF NOT EXISTS),
  // then runs incremental ALTER TABLEs for existing databases missing newer columns.
  await db.exec(SCHEMA);

  // Migrate emails_log CHECK constraint to include 'otp' type.
  // SQLite can't ALTER constraints, so we swap the table if it lacks the 'otp' type.
  const hasOtp = await db.get(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='emails_log'"
  );
  if (hasOtp && !hasOtp.sql.includes("'otp'")) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS emails_log_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        to_email TEXT NOT NULL,
        to_name TEXT,
        subject TEXT,
        body_html TEXT,
        email_type TEXT CHECK(email_type IN ('welcome','payment_confirmation','card_delivery','blast','contact','otp')),
        status TEXT NOT NULL DEFAULT 'sent',
        error TEXT,
        member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO emails_log_new (id, to_email, to_name, subject, body_html, email_type, status, error, member_id, created_at)
      SELECT id, to_email, to_name, subject, body_html, email_type, status, error, member_id, created_at FROM emails_log;
      DROP TABLE emails_log;
      ALTER TABLE emails_log_new RENAME TO emails_log;
    `);
  }

  // Add payment_method column for offline payments
  try {
    await db.exec("ALTER TABLE payments ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'stripe'");
  } catch (_e) {
    // Column already exists
  }

  // Merge admins into members: add admin-related columns
  try {
    await db.exec("ALTER TABLE members ADD COLUMN role TEXT CHECK(role IN ('super_admin','editor'))");
  } catch (_e) { /* Column already exists */ }
  try {
    await db.exec("ALTER TABLE members ADD COLUMN otp_hash TEXT");
  } catch (_e) { /* Column already exists */ }
  try {
    await db.exec("ALTER TABLE members ADD COLUMN otp_expires_at TIMESTAMP");
  } catch (_e) { /* Column already exists */ }
  try {
    await db.exec("ALTER TABLE members ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0");
  } catch (_e) { /* Column already exists */ }

  // Migrate existing admins rows into members, then drop admins table
  const adminsExists = await db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='admins'"
  );
  if (adminsExists) {
    const admins = await db.all('SELECT * FROM admins');
    await db.transaction(async () => {
      for (const admin of admins) {
        const existing = await db.get('SELECT id FROM members WHERE email = ?', admin.email);
        if (existing) {
          await db.run(
            "UPDATE members SET role = ?, otp_hash = ?, otp_expires_at = ?, otp_attempts = ?, updated_at = datetime('now') WHERE id = ?",
            admin.role, admin.otp_hash, admin.otp_expires_at, admin.otp_attempts, existing.id
          );
        } else {
          const spaceIdx = (admin.name || '').indexOf(' ');
          const firstName = spaceIdx > 0 ? admin.name.slice(0, spaceIdx) : admin.name;
          const lastName = spaceIdx > 0 ? admin.name.slice(spaceIdx + 1) : '';
          await db.run(
            `INSERT INTO members (first_name, last_name, email, role, otp_hash, otp_expires_at, otp_attempts)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            firstName, lastName, admin.email, admin.role, admin.otp_hash, admin.otp_expires_at, admin.otp_attempts
          );
        }
      }
    });
    await db.exec('DROP TABLE admins');
  }

  console.log('Database migration complete.');
}

module.exports = migrate;

if (require.main === module) {
  migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
