const db = require('./database');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_number TEXT UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      address_street TEXT,
      address_city TEXT,
      address_state TEXT,
      address_zip TEXT,
      membership_year INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','expired','cancelled')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','refunded')),
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT,
      image_path TEXT,
      link_url TEXT,
      link_text TEXT,
      is_published INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gallery_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      alt_text TEXT,
      caption TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT,
      bio_text TEXT,
      photo_path TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS emails_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT NOT NULL,
      to_name TEXT,
      subject TEXT,
      body_html TEXT,
      email_type TEXT CHECK(email_type IN ('welcome','payment_confirmation','card_delivery','blast','contact')),
      status TEXT NOT NULL DEFAULT 'sent',
      error TEXT,
      member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS membership_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      pdf_path TEXT,
      png_path TEXT,
      year INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

  `);

  // Migrate emails_log CHECK constraint to include 'otp' type.
  // SQLite can't ALTER constraints, so we swap the table if it lacks the 'otp' type.
  const hasOtp = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='emails_log'"
  ).get();
  if (hasOtp && !hasOtp.sql.includes("'otp'")) {
    db.exec(`
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
      INSERT INTO emails_log_new SELECT * FROM emails_log;
      DROP TABLE emails_log;
      ALTER TABLE emails_log_new RENAME TO emails_log;
    `);
  }

  // Add payment_method column for offline payments
  try {
    db.exec("ALTER TABLE payments ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'stripe'");
  } catch (_e) {
    // Column already exists
  }

  // Merge admins into members: add admin-related columns
  try {
    db.exec("ALTER TABLE members ADD COLUMN role TEXT CHECK(role IN ('super_admin','editor'))");
  } catch (_e) { /* Column already exists */ }
  try {
    db.exec("ALTER TABLE members ADD COLUMN otp_hash TEXT");
  } catch (_e) { /* Column already exists */ }
  try {
    db.exec("ALTER TABLE members ADD COLUMN otp_expires_at TEXT");
  } catch (_e) { /* Column already exists */ }
  try {
    db.exec("ALTER TABLE members ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0");
  } catch (_e) { /* Column already exists */ }

  // Migrate existing admins rows into members, then drop admins table
  const adminsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='admins'"
  ).get();
  if (adminsExists) {
    const admins = db.prepare('SELECT * FROM admins').all();
    const upsert = db.transaction(() => {
      for (const admin of admins) {
        const existing = db.prepare('SELECT id FROM members WHERE email = ?').get(admin.email);
        if (existing) {
          db.prepare(
            "UPDATE members SET role = ?, otp_hash = ?, otp_expires_at = ?, otp_attempts = ?, updated_at = datetime('now') WHERE id = ?"
          ).run(admin.role, admin.otp_hash, admin.otp_expires_at, admin.otp_attempts, existing.id);
        } else {
          const spaceIdx = (admin.name || '').indexOf(' ');
          const firstName = spaceIdx > 0 ? admin.name.slice(0, spaceIdx) : admin.name;
          const lastName = spaceIdx > 0 ? admin.name.slice(spaceIdx + 1) : '';
          db.prepare(
            `INSERT INTO members (first_name, last_name, email, role, otp_hash, otp_expires_at, otp_attempts)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(firstName, lastName, admin.email, admin.role, admin.otp_hash, admin.otp_expires_at, admin.otp_attempts);
        }
      }
    });
    upsert();
    db.exec('DROP TABLE admins');
  }

  console.log('Database migration complete.');
}

module.exports = migrate;

if (require.main === module) {
  migrate();
}
