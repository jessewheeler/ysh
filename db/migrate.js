const db = require('./database');
const { SCHEMA, toPgSchema } = require('./schema');
const logger = require('../services/logger');

async function migrate() {
  if (db.dialect === 'pg') {
    await db.exec(toPgSchema(SCHEMA));

    // For existing PG databases created from older schemas, add missing columns idempotently.
    // PostgreSQL supports ADD COLUMN IF NOT EXISTS (v9.6+).
    const pgAlters = [
      // payments: payment_method added for offline payments
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'stripe'",
      // members: admin columns merged from admins table
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS role TEXT CHECK(role IN ('super_admin','editor'))",
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS otp_hash TEXT",
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP",
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS otp_attempts INTEGER NOT NULL DEFAULT 0",
      // members: replace full unique constraint on email with a partial one (primary members only)
      "ALTER TABLE members DROP CONSTRAINT IF EXISTS members_email_key",
      "CREATE UNIQUE INDEX IF NOT EXISTS members_email_primary_unique ON members (email) WHERE primary_member_id IS NULL",
      // members: family membership columns
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_type TEXT NOT NULL DEFAULT 'individual' CHECK(membership_type IN ('individual','family'))",
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS primary_member_id INTEGER REFERENCES members(id) ON DELETE CASCADE",
      // members: join/renewal columns
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS join_date TIMESTAMP",
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMP",
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS renewal_token TEXT",
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS renewal_token_expires_at TIMESTAMP",
      // audit columns
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE gallery_images ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE gallery_images ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE bios ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE bios ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE emails_log ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
      "ALTER TABLE membership_cards ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    ];
    for (const sql of pgAlters) {
      await db.exec(sql);
    }

    // audit_log table and indexes (idempotent)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log
      (
        id          SERIAL PRIMARY KEY,
        table_name  TEXT    NOT NULL,
        record_id   TEXT    NOT NULL,
        action      TEXT    NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
        actor_id    INTEGER REFERENCES members (id) ON DELETE SET NULL,
        actor_email TEXT,
        old_values  TEXT,
        new_values  TEXT,
        changed_at  TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log (table_name, record_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON audit_log (changed_at);
    `);

    logger.info('PostgreSQL schema creation complete');
    return;
  }

  // SQLite migration path — uses canonical schema for fresh installs (CREATE IF NOT EXISTS),
  // then runs incremental ALTER TABLEs for existing databases missing newer columns.
  await db.exec(SCHEMA);

  // Migrate emails_log CHECK constraint to include 'otp' and 'renewal_reminder' types.
  // SQLite can't ALTER constraints, so we swap the table if it lacks the latest type.
  const emailsLogSchema = await db.get(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='emails_log'"
  );
  if (emailsLogSchema && !emailsLogSchema.sql.includes("'renewal_reminder'")) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS emails_log_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        to_email TEXT NOT NULL,
        to_name TEXT,
        subject TEXT,
        body_html TEXT,
        email_type TEXT CHECK (email_type IN
                               ('welcome', 'payment_confirmation', 'card_delivery', 'blast', 'contact', 'otp',
                                'renewal_reminder')),
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

  // Add family membership columns and remove UNIQUE constraint on email
  // Check if migration is needed by looking at the table schema
  const memberSchema = await db.get(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='members'"
  );

  const needsMigration = memberSchema && (
    memberSchema.sql.includes('email TEXT UNIQUE') ||
    !memberSchema.sql.includes('membership_type')
  );

  if (needsMigration) {
    // Need to rebuild the table to remove UNIQUE constraint and add new columns
    const allMembers = await db.all('SELECT * FROM members');

    await db.transaction(async () => {
      // Create new members table with updated schema
      await db.exec(`
        CREATE TABLE members_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_number TEXT UNIQUE,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT,
          address_street TEXT,
          address_city TEXT,
          address_state TEXT,
          address_zip TEXT,
          membership_year INTEGER,
          membership_type TEXT NOT NULL DEFAULT 'individual' CHECK(membership_type IN ('individual','family')),
          primary_member_id INTEGER REFERENCES members_new(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','expired','cancelled')),
          notes TEXT,
          role TEXT CHECK(role IN ('super_admin','editor')),
          otp_hash TEXT,
          otp_expires_at TEXT,
          otp_attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      // Copy data from old to new table
      if (allMembers.length > 0) {
        for (const m of allMembers) {
          await db.run(
            `INSERT INTO members_new (id, member_number, first_name, last_name, email, phone,
              address_street, address_city, address_state, address_zip, membership_year,
              membership_type, primary_member_id, status, notes, role, otp_hash,
              otp_expires_at, otp_attempts, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            m.id, m.member_number, m.first_name, m.last_name, m.email, m.phone,
            m.address_street, m.address_city, m.address_state, m.address_zip, m.membership_year,
            'individual', null, m.status, m.notes,
            m.role, m.otp_hash, m.otp_expires_at, m.otp_attempts || 0, m.created_at, m.updated_at
          );
        }
      }

      // Drop old table and rename new one
      await db.exec('DROP TABLE members');
      await db.exec('ALTER TABLE members_new RENAME TO members');

      // Create index for family member lookups
      await db.exec('CREATE INDEX IF NOT EXISTS idx_members_primary_member_id ON members(primary_member_id)');
    });

    logger.info('Members table migrated to support family memberships');
  }

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

  // Add join_date column to track when members joined the organization
  // Note: SQLite ALTER TABLE doesn't support DEFAULT with functions, so we add without default
  // and set values manually. New inserts will use the schema default from SCHEMA constant.
  try {
    await db.exec("ALTER TABLE members ADD COLUMN join_date TEXT");
    // For existing members, set join_date to created_at for backward compatibility
    await db.exec("UPDATE members SET join_date = created_at WHERE join_date IS NULL");
    logger.info('Added join_date column to members table');
  } catch (_e) {
    // Column already exists
  }

  // Add renewal reminder columns
  try {
    await db.exec("ALTER TABLE members ADD COLUMN expiry_date TEXT");
  } catch (_e) { /* Column already exists */
  }
  try {
    await db.exec("ALTER TABLE members ADD COLUMN renewal_token TEXT");
  } catch (_e) { /* Column already exists */
  }
  try {
    await db.exec("ALTER TABLE members ADD COLUMN renewal_token_expires_at TEXT");
  } catch (_e) { /* Column already exists */
  }

  // Add audit columns (created_by / updated_by) to all tables
  const auditAlters = [
    "ALTER TABLE members ADD COLUMN created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE members ADD COLUMN updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE payments ADD COLUMN created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE payments ADD COLUMN updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE announcements ADD COLUMN created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE announcements ADD COLUMN updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE gallery_images ADD COLUMN updated_at TEXT",
    "ALTER TABLE gallery_images ADD COLUMN created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE gallery_images ADD COLUMN updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE bios ADD COLUMN created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE bios ADD COLUMN updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE site_settings ADD COLUMN updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE emails_log ADD COLUMN created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
    "ALTER TABLE membership_cards ADD COLUMN created_by INTEGER REFERENCES members(id) ON DELETE SET NULL",
  ];
  for (const sql of auditAlters) {
    try {
      await db.exec(sql);
    } catch (_e) { /* Column already exists */
    }
  }

  // Create audit_log table and indexes (idempotent)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('INSERT', 'UPDATE', 'DELETE')),
      actor_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      actor_email TEXT,
      old_values TEXT,
      new_values TEXT,
      changed_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON audit_log(changed_at);
  `);

  logger.info('Database migration complete');
}

module.exports = migrate;

if (require.main === module) {
  migrate().catch(err => {
    logger.error('Migration failed', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}
