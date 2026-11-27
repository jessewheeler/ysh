const db = require('./database');
const { SCHEMA, toPgSchema } = require('./schema');
const logger = require('../services/logger');

const VISIT_RETENTION_DAYS = 730; // two years

/**
 * Deletes campaign_visits rows older than the retention window, keeping the table bounded
 * without a cron job. The cutoff is computed in JS and bound as a parameter — comparing a
 * TEXT/TIMESTAMP date column against an inline SQL date function does not survive the
 * SQLite→PostgreSQL dialect translation (see the PR #69 revert).
 */
async function pruneCampaignVisits() {
  const cutoff = new Date(Date.now() - VISIT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  const result = await db.run('DELETE FROM campaign_visits WHERE created_at < ?', cutoff);
  const removed = result?.changes || 0;
  if (removed > 0) {
    logger.info('Pruned old campaign visits', { removed, cutoff });
  }
}

// The funds a donor can earmark a gift for (issue #126). Seeded only into an empty table, so
// a fund an admin later renames or retires is never put back.
const DEFAULT_DONATION_FUNDS = ['General Fund', 'Heart Wheels', 'Battle of the Birds', 'Charity Partner of the Year'];

async function seedDonationFunds() {
  const row = await db.get('SELECT COUNT(*) AS c FROM donation_funds');
  if (row && Number(row.c) > 0) return;
  for (const [i, name] of DEFAULT_DONATION_FUNDS.entries()) {
    await db.run('INSERT INTO donation_funds (name, sort_order) VALUES (?, ?)', name, i + 1);
  }
}

async function migrate() {
  if (db.dialect === 'pg') {
    await db.exec(toPgSchema(SCHEMA));

    // For existing PG databases created from older schemas, add missing columns idempotently.
    // PostgreSQL supports ADD COLUMN IF NOT EXISTS (v9.6+).
    const pgAlters = [
      // payments: payment_method added for offline payments
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'stripe'",
      // payments: why Stripe declined, captured by the failure webhooks
      'ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_reason TEXT',
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
      "ALTER TABLE membership_periods ADD COLUMN IF NOT EXISTS card_template_path TEXT",
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS is_lifetime INTEGER NOT NULL DEFAULT 0",
      // bios: contact email, required by the Central Council membership report
      "ALTER TABLE bios ADD COLUMN IF NOT EXISTS email TEXT",
      // members: campaign attribution (issue #88). Added here rather than in schema.js because
      // members is created before campaigns and campaigns.created_by points back at members.
      "ALTER TABLE members ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL",
      "CREATE INDEX IF NOT EXISTS idx_members_campaign ON members (campaign_id)",
      // payments: soft delete of a mistaken offline payment (issue #108). PG names an inline
      // column CHECK <table>_<column>_check; DROP IF EXISTS + ADD keeps the pair idempotent.
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS void_reason TEXT CHECK(void_reason IN ('refunded','voided','duplicate','other'))",
      'ALTER TABLE payments ADD COLUMN IF NOT EXISTS void_note TEXT',
      'ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_at TEXT',
      'ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check',
      "ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending','completed','failed','refunded','voided'))",
      // emails_log: the full list of email types — silent auction (issue #119) and donation
      // confirmation (issue #126). Same DROP IF EXISTS + ADD pairing. Keep this list, the one in
      // schema.js and the SQLite rebuild below identical: whichever runs last wins.
      // donations (issue #126): bring a table left by the old feature/donate-button branch up
      // to the current shape. On a fresh database every statement is a no-op. An old row was a
      // named gift with no fee cover, so its gift is the whole amount.
      'ALTER TABLE donations ADD COLUMN IF NOT EXISTS is_anonymous INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE donations ADD COLUMN IF NOT EXISTS fund_id INTEGER REFERENCES donation_funds(id) ON DELETE SET NULL',
      'ALTER TABLE donations ADD COLUMN IF NOT EXISTS gift_cents INTEGER',
      'ALTER TABLE donations ADD COLUMN IF NOT EXISTS fee_cover_cents INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE donations ADD COLUMN IF NOT EXISTS member_id INTEGER REFERENCES members(id) ON DELETE SET NULL',
      'UPDATE donations SET gift_cents = amount_cents WHERE gift_cents IS NULL',
      'ALTER TABLE donations ALTER COLUMN gift_cents SET NOT NULL',
      'ALTER TABLE donations ALTER COLUMN donor_name DROP NOT NULL',
      'ALTER TABLE donations ALTER COLUMN donor_email DROP NOT NULL',
      'ALTER TABLE donations DROP CONSTRAINT IF EXISTS donations_donor_check',
      'ALTER TABLE donations ADD CONSTRAINT donations_donor_check CHECK ((is_anonymous = 1 AND donor_name IS NULL AND donor_email IS NULL AND member_id IS NULL) OR (is_anonymous = 0 AND donor_name IS NOT NULL AND donor_email IS NOT NULL))',
      'ALTER TABLE emails_log DROP CONSTRAINT IF EXISTS emails_log_email_type_check',
      "ALTER TABLE emails_log ADD CONSTRAINT emails_log_email_type_check CHECK (email_type IN ('welcome','payment_confirmation','card_delivery','blast','contact','otp','renewal_reminder','auction_otp','auction_outbid','auction_winner','donation_confirmation'))",
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

    // Backfill membership_periods from settings if the table is empty (PG)
    const pgPeriodCount = await db.get('SELECT COUNT(*) as c FROM membership_periods');
    if (pgPeriodCount && pgPeriodCount.c === 0) {
      const pgIndividualDues = await db.get("SELECT value FROM site_settings WHERE key='individual_dues_amount_cents'");
      const pgFamilyDues = await db.get("SELECT value FROM site_settings WHERE key='family_dues_amount_cents'");
      const pgExpiryDate = await db.get("SELECT value FROM site_settings WHERE key='membership_expiry_date'");

      const pgEndDate = pgExpiryDate?.value || `${new Date().getFullYear()}-07-31`;
      const pgEndYear = parseInt(pgEndDate.slice(0, 4));
      const pgStartDate = `${pgEndYear - 1}-04-01`;
      const pgIndCents = parseInt(pgIndividualDues?.value) || 1600;
      const pgFamCents = parseInt(pgFamilyDues?.value) || 2600;

      const pgResult = await db.run(
          `INSERT INTO membership_periods (label, start_date, end_date, individual_dues_cents, family_dues_cents, electronic_surcharge_cents)
         VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
          `${pgEndYear - 1}–${pgEndYear} Season`, pgStartDate, pgEndDate, pgIndCents, pgFamCents
      );
      const pgPeriodId = pgResult.lastInsertRowid;

      const pgActiveMembers = await db.all("SELECT id FROM members WHERE status='active' AND primary_member_id IS NULL");
      for (const m of pgActiveMembers) {
        await db.run(
            'INSERT INTO membership_years (member_id, membership_period_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            m.id, pgPeriodId
        );
      }
      logger.info('Backfilled membership_periods from settings (PG)', {
        pgPeriodId,
        activeMembers: pgActiveMembers.length
      });
    }

    await seedDonationFunds();

    await pruneCampaignVisits();

    logger.info('PostgreSQL schema creation complete');
    return;
  }

  // SQLite migration path — uses canonical schema for fresh installs (CREATE IF NOT EXISTS),
  // then runs incremental ALTER TABLEs for existing databases missing newer columns.
  await db.exec(SCHEMA);

  // Migrate emails_log CHECK constraint to the latest list of email types (donation_confirmation,
  // issue #126, is the newest). SQLite can't ALTER constraints, so the table is swapped
  // when its DDL lacks the newest type. created_by is carried across when the old table has it —
  // it is otherwise only added by the ALTER further down, and a rebuild that dropped it would
  // lose who sent each existing email.
  const emailsLogSchema = await db.get(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='emails_log'"
  );
  if (emailsLogSchema && !emailsLogSchema.sql.includes("'donation_confirmation'")) {
    const hasCreatedBy = (await db.all('PRAGMA table_info(emails_log)')).some(c => c.name === 'created_by');
    await db.exec(`
      DROP TABLE IF EXISTS emails_log_new;
      CREATE TABLE emails_log_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        to_email TEXT NOT NULL,
        to_name TEXT,
        subject TEXT,
        body_html TEXT,
        email_type TEXT CHECK (email_type IN
                               ('welcome', 'payment_confirmation', 'card_delivery', 'blast', 'contact', 'otp',
                                'renewal_reminder', 'auction_otp', 'auction_outbid', 'auction_winner',
                                'donation_confirmation')),
        status TEXT NOT NULL DEFAULT 'sent',
        error TEXT,
        member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT (datetime('now')),
        created_by INTEGER REFERENCES members(id) ON DELETE SET NULL
      );
      INSERT INTO emails_log_new (id, to_email, to_name, subject, body_html, email_type, status, error, member_id, created_at, created_by)
      SELECT id, to_email, to_name, subject, body_html, email_type, status, error, member_id, created_at,
             ${hasCreatedBy ? 'created_by' : 'NULL'} FROM emails_log;
      DROP TABLE emails_log;
      ALTER TABLE emails_log_new RENAME TO emails_log;
      CREATE INDEX IF NOT EXISTS idx_emails_log_member_type ON emails_log(member_id, email_type);
      CREATE INDEX IF NOT EXISTS idx_emails_log_status ON emails_log(status, created_at);
    `);
  }

  // Add payment_method column for offline payments
  try {
    await db.exec("ALTER TABLE payments ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'stripe'");
  } catch (_e) {
    // Column already exists
  }

  await migratePaymentsStatusCheck(db);
  await migrateDonationsShape(db);

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
    "ALTER TABLE membership_periods ADD COLUMN card_template_path TEXT",
    "ALTER TABLE members ADD COLUMN is_lifetime INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE bios ADD COLUMN email TEXT",
    // members: campaign attribution (issue #88). Added here rather than in schema.js because
    // members is created before campaigns and campaigns.created_by points back at members.
    "ALTER TABLE members ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS idx_members_campaign ON members (campaign_id)",
    // payments: why Stripe declined, captured by the failure webhooks
    'ALTER TABLE payments ADD COLUMN failure_reason TEXT',
    // payments: void columns (issue #108). The rebuild above adds them on a database that
    // predates 'voided'; these cover one that already has the status but not the columns.
    "ALTER TABLE payments ADD COLUMN void_reason TEXT CHECK(void_reason IN ('refunded','voided','duplicate','other'))",
    'ALTER TABLE payments ADD COLUMN void_note TEXT',
    'ALTER TABLE payments ADD COLUMN voided_at TEXT',
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

  // Backfill membership_periods from settings if the table is empty
  const periodCount = await db.get('SELECT COUNT(*) as c FROM membership_periods');
  if (periodCount && periodCount.c === 0) {
    const individualDues = await db.get("SELECT value FROM site_settings WHERE key='individual_dues_amount_cents'");
    const familyDues = await db.get("SELECT value FROM site_settings WHERE key='family_dues_amount_cents'");
    const expiryDate = await db.get("SELECT value FROM site_settings WHERE key='membership_expiry_date'");

    const endDate = expiryDate?.value || `${new Date().getFullYear()}-07-31`;
    const endYear = parseInt(endDate.slice(0, 4));
    const startDate = `${endYear - 1}-04-01`;
    const indCents = parseInt(individualDues?.value) || 1600;
    const famCents = parseInt(familyDues?.value) || 2600;

    const result = await db.run(
        `INSERT INTO membership_periods (label, start_date, end_date, individual_dues_cents, family_dues_cents, electronic_surcharge_cents)
       VALUES (?, ?, ?, ?, ?, 0)`,
        `${endYear - 1}–${endYear} Season`, startDate, endDate, indCents, famCents
    );
    const periodId = result.lastInsertRowid;

    const activeMembers = await db.all("SELECT id FROM members WHERE status='active' AND primary_member_id IS NULL");
    for (const m of activeMembers) {
      await db.run(
          'INSERT OR IGNORE INTO membership_years (member_id, membership_period_id) VALUES (?, ?)',
          m.id, periodId
      );
    }
    logger.info('Backfilled membership_periods from settings', {periodId, activeMembers: activeMembers.length});
  }

  await seedDonationFunds();

  await pruneCampaignVisits();

  logger.info('Database migration complete');
}

/**
 * Brings a donations table left by the old feature/donate-button branch up to the current
 * shape (issue #126). That branch was never merged, but any database it ran against — a dev
 * machine, the Robot database — kept its table, and CREATE TABLE IF NOT EXISTS skips it.
 *
 * SQLite cannot drop NOT NULL or add a CHECK in place, so the table is rebuilt: the old one
 * is set aside, schema.js creates the current one, and the rows are copied across. An old row
 * was a named gift with no fee cover, so its gift is the whole amount. Nothing references
 * donations, so unlike payments this needs no foreign-key dance.
 */
async function migrateDonationsShape(db) {
  const columns = await db.all('PRAGMA table_info(donations)');
  if (!columns.length || columns.some(c => c.name === 'fund_id')) return;

  await db.exec(`
    BEGIN;
    DROP TABLE IF EXISTS donations_pre126;
    ALTER TABLE donations RENAME TO donations_pre126;
    DROP INDEX IF EXISTS idx_donations_stripe_session;
    DROP INDEX IF EXISTS idx_donations_member;
  `);
  try {
    await db.exec(SCHEMA);
    await db.exec(`
      INSERT INTO donations (id, donor_name, donor_email, is_anonymous, gift_cents, fee_cover_cents,
                             amount_cents, currency, status, stripe_session_id, stripe_payment_intent,
                             member_id, created_at, updated_at)
      SELECT id, donor_name, donor_email, 0, amount_cents, 0,
             amount_cents, currency, status, stripe_session_id, stripe_payment_intent,
             member_id, created_at, updated_at
        FROM donations_pre126;
      DROP TABLE donations_pre126;
      COMMIT;
    `);
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
  logger.info('Rebuilt donations table to the issue #126 shape');
}

/**
 * Widens payments.status to allow 'voided' (issue #108). SQLite cannot alter a CHECK, so
 * the table is rebuilt the way emails_log is above — but payments is referenced by
 * membership_years.payment_id, and with foreign keys on a DROP TABLE runs an implicit
 * DELETE that those citations would veto (or, worse, cascade). Hence SQLite's documented
 * twelve-step dance: foreign_keys OFF outside the transaction, rebuild inside it, verify
 * with foreign_key_check, foreign_keys back ON.
 *
 * Only columns present on the old table are copied; anything newer takes its default.
 */
async function migratePaymentsStatusCheck(db) {
  const current = await db.get(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'"
  );
  if (!current || current.sql.includes("'voided'")) return;

  const columns = (await db.all('PRAGMA table_info(payments)')).map(c => c.name);
  const copyable = [
    'id', 'member_id', 'stripe_session_id', 'stripe_payment_intent', 'amount_cents',
    'currency', 'status', 'description', 'failure_reason', 'payment_method',
    'created_at', 'updated_at', 'created_by', 'updated_by',
  ].filter(name => columns.includes(name)).join(', ');

  // Only violations the rebuild introduces are ours to fail on. An older database can
  // already carry orphans (payments citing a member deleted before ON DELETE CASCADE
  // existed), and the rebuild copies those rows exactly as it found them.
  const violationKey = v => `${v.table}:${v.rowid}:${v.parent}:${v.fkid}`;
  const before = new Set((await db.all('PRAGMA foreign_key_check')).map(violationKey));

  await db.exec('PRAGMA foreign_keys = OFF');
  try {
    await db.transaction(async () => {
      await db.exec(`
        CREATE TABLE payments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          stripe_session_id TEXT,
          stripe_payment_intent TEXT,
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'usd',
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','refunded','voided')),
          description TEXT,
          failure_reason TEXT,
          payment_method TEXT NOT NULL DEFAULT 'stripe',
          void_reason TEXT CHECK(void_reason IN ('refunded','voided','duplicate','other')),
          void_note TEXT,
          voided_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
          updated_by INTEGER REFERENCES members(id) ON DELETE SET NULL
        )
      `);
      await db.exec(`INSERT INTO payments_new (${copyable}) SELECT ${copyable} FROM payments`);
      await db.exec('DROP TABLE payments');
      await db.exec('ALTER TABLE payments_new RENAME TO payments');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_payments_member_status ON payments(member_id, status)');
    });
    const introduced = (await db.all('PRAGMA foreign_key_check'))
      .filter(v => !before.has(violationKey(v)));
    if (introduced.length) {
      throw new Error(`payments rebuild introduced ${introduced.length} foreign key violation(s)`);
    }
  } finally {
    await db.exec('PRAGMA foreign_keys = ON');
  }
  logger.info("Payments table migrated to allow status 'voided'");
}

module.exports = migrate;

if (require.main === module) {
  migrate().catch(err => {
    logger.error('Migration failed', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}
