/**
 * Canonical schema definition — single source of truth for all table DDL.
 * Written in SQLite syntax. Use toPgSchema() to convert for PostgreSQL.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS members (
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
    primary_member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','expired','cancelled')),
    is_lifetime INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    role TEXT CHECK(role IN ('super_admin','editor')),
    otp_hash TEXT,
    otp_expires_at TEXT,
    otp_attempts INTEGER NOT NULL DEFAULT 0,
    join_date TEXT DEFAULT (datetime('now')),
    expiry_date TEXT,
    renewal_token TEXT,
    renewal_token_expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT
  (
    datetime
  (
    'now'
  )),
    created_by INTEGER REFERENCES members
  (
    id
  )
                                                     ON DELETE SET NULL,
    updated_by INTEGER REFERENCES members
  (
    id
  )
                                                     ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
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
    -- 'voided' is the soft delete for a mistaken offline payment (issue #108). The row stays
    -- so the audit trail and any membership_years citation survive; the reason is mandatory.
    void_reason TEXT CHECK(void_reason IN ('refunded','voided','duplicate','other')),
    void_note TEXT,
    voided_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT
  (
    datetime
  (
    'now'
  )),
    created_by INTEGER REFERENCES members
  (
    id
  )
                                                      ON DELETE SET NULL,
    updated_by INTEGER REFERENCES members
  (
    id
  )
                                                      ON DELETE SET NULL
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
    updated_at TEXT DEFAULT
  (
    datetime
  (
    'now'
  )),
    created_by INTEGER REFERENCES members
  (
    id
  ) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES members
  (
    id
  )
    ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS gallery_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    alt_text TEXT,
    caption TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_visible INTEGER NOT NULL DEFAULT 1,
    created_at
    TEXT
    DEFAULT (
    datetime
  (
    'now'
  )),
    updated_at TEXT DEFAULT
  (
    datetime
  (
    'now'
  )),
    created_by INTEGER REFERENCES members
  (
    id
  ) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES members
  (
    id
  )
    ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS bios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT,
    email TEXT,
    bio_text TEXT,
    photo_path TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_visible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT
  (
    datetime
  (
    'now'
  )),
    created_by INTEGER REFERENCES members
  (
    id
  ) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES members
  (
    id
  )
    ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at
    TEXT
    DEFAULT (
    datetime
  (
    'now'
  )),
    updated_by INTEGER REFERENCES members
  (
    id
  ) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS emails_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email TEXT NOT NULL,
    to_name TEXT,
    subject TEXT,
    body_html TEXT,
    email_type
    TEXT
    CHECK (
    email_type
    IN
  (
    'welcome',
    'payment_confirmation',
    'card_delivery',
    'blast',
    'contact',
    'otp',
    'renewal_reminder'
  )),
    status TEXT NOT NULL DEFAULT 'sent',
    error TEXT,
    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT
  (
    datetime
  (
    'now'
  )),
    created_by INTEGER REFERENCES members
  (
    id
  )
                                             ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS membership_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    pdf_path TEXT,
    png_path TEXT,
    year INTEGER,
    created_at TEXT DEFAULT
  (
    datetime
  (
    'now'
  )),
    created_by INTEGER REFERENCES members
  (
    id
  )
                                                      ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log
  (
    id
    INTEGER
    PRIMARY
    KEY
    AUTOINCREMENT,
    table_name
    TEXT
    NOT
    NULL,
    record_id
    TEXT
    NOT
    NULL,
    action
    TEXT
    NOT
    NULL
    CHECK (
    action
    IN
  (
    'INSERT',
    'UPDATE',
    'DELETE'
  )),
    actor_id INTEGER REFERENCES members
  (
    id
  ) ON DELETE SET NULL,
    actor_email TEXT,
    old_values TEXT,
    new_values TEXT,
    changed_at TEXT DEFAULT
  (
    datetime
  (
    'now'
  ))
    );

  CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON audit_log(changed_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email_primary ON members(email) WHERE primary_member_id IS NULL;

  CREATE TABLE IF NOT EXISTS membership_periods
  (
    id                         INTEGER PRIMARY KEY AUTOINCREMENT,
    label                      TEXT,
    start_date                 TEXT    NOT NULL,
    end_date                   TEXT    NOT NULL,
    individual_dues_cents      INTEGER NOT NULL,
    family_dues_cents          INTEGER NOT NULL,
    electronic_surcharge_cents INTEGER NOT NULL DEFAULT 0,
    card_template_path         TEXT,
    created_at                 TEXT             DEFAULT (datetime('now')),
    updated_at                 TEXT             DEFAULT (datetime('now')),
    created_by                 INTEGER REFERENCES members (id) ON DELETE SET NULL,
    updated_by                 INTEGER REFERENCES members (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS membership_years
  (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id            INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    membership_period_id INTEGER NOT NULL REFERENCES membership_periods (id),
    payment_id           INTEGER REFERENCES payments (id),
    created_at           TEXT DEFAULT (datetime('now')),
    created_by           INTEGER REFERENCES members (id) ON DELETE SET NULL,
    UNIQUE (member_id, membership_period_id)
  );

  CREATE TABLE IF NOT EXISTS campaigns
  (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    utm_campaign TEXT NOT NULL UNIQUE,
    utm_source   TEXT,
    utm_medium   TEXT,
    utm_content  TEXT,
    target_path  TEXT NOT NULL DEFAULT '/membership',
    notes        TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now')),
    created_by   INTEGER REFERENCES members (id) ON DELETE SET NULL,
    updated_by   INTEGER REFERENCES members (id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS campaign_visits
  (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id  INTEGER NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
    landing_path TEXT,
    referrer     TEXT,
    utm_source   TEXT,
    utm_medium   TEXT,
    utm_content  TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_submissions
  (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL,
    message      TEXT NOT NULL,
    campaign_id  INTEGER REFERENCES campaigns (id) ON DELETE SET NULL,
    email_status TEXT NOT NULL DEFAULT 'sent' CHECK (email_status IN ('sent', 'failed')),
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- Game-day events (watch parties) that members check in to. Rows with source='espn'
  -- come from services/nflSchedule.js and are matched on external_id; admins create the
  -- rest by hand. event_date is the America/Denver local date, not the UTC one.
  CREATE TABLE IF NOT EXISTS events
  (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT    NOT NULL,
    event_date           TEXT    NOT NULL,
    kickoff_at           TEXT,
    opponent             TEXT,
    home_away            TEXT CHECK (home_away IN ('home', 'away') OR home_away IS NULL),
    location             TEXT,
    notes                TEXT,
    membership_period_id INTEGER REFERENCES membership_periods (id) ON DELETE SET NULL,
    source               TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'espn')),
    external_id          TEXT,
    cancelled            INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT DEFAULT (datetime('now')),
    updated_at           TEXT DEFAULT (datetime('now')),
    created_by           INTEGER REFERENCES members (id) ON DELETE SET NULL,
    updated_by           INTEGER REFERENCES members (id) ON DELETE SET NULL
  );

  -- One row per person per event. tickets_issued is the raffle entry count; staff can
  -- raise it above 1 for promotions, and it is forced to 0 for anyone not enrolled.
  CREATE TABLE IF NOT EXISTS check_ins
  (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id             INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    member_id            INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    tickets_issued       INTEGER NOT NULL DEFAULT 0 CHECK (tickets_issued >= 0),
    enrolled_at_check_in INTEGER NOT NULL DEFAULT 0,
    checked_in_at        TEXT DEFAULT (datetime('now')),
    checked_in_by        INTEGER REFERENCES members (id) ON DELETE SET NULL,
    updated_at           TEXT DEFAULT (datetime('now')),
    updated_by           INTEGER REFERENCES members (id) ON DELETE SET NULL,
    UNIQUE (event_id, member_id)
  );

  -- Family sub-members with no email of their own, set aside when their primary downgrades
  -- to an individual membership (issue #107). Their members row is deleted, so this keeps
  -- what's needed to bring them back: name, original join date, every member number they
  -- have held and the periods they were enrolled in (both JSON arrays). A restore stamps
  -- restored_at rather than deleting the row.
  CREATE TABLE IF NOT EXISTS archived_members
  (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name               TEXT NOT NULL,
    last_name                TEXT NOT NULL,
    join_date                TEXT,
    member_numbers           TEXT NOT NULL DEFAULT '[]',
    enrolled_period_ids      TEXT NOT NULL DEFAULT '[]',
    former_member_id         INTEGER,
    former_primary_member_id INTEGER REFERENCES members (id) ON DELETE SET NULL,
    archived_at              TEXT DEFAULT (datetime('now')),
    restored_at              TEXT,
    restored_member_id       INTEGER REFERENCES members (id) ON DELETE SET NULL,
    created_at               TEXT DEFAULT (datetime('now')),
    updated_at               TEXT DEFAULT (datetime('now')),
    created_by               INTEGER REFERENCES members (id) ON DELETE SET NULL,
    updated_by               INTEGER REFERENCES members (id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_archived_members_name ON archived_members(last_name, first_name);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_events_external_id ON events(external_id) WHERE external_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
  CREATE INDEX IF NOT EXISTS idx_events_period ON events(membership_period_id);
  CREATE INDEX IF NOT EXISTS idx_check_ins_member ON check_ins(member_id);

  CREATE INDEX IF NOT EXISTS idx_campaign_visits_campaign ON campaign_visits(campaign_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_campaign_visits_created ON campaign_visits(created_at);
  CREATE INDEX IF NOT EXISTS idx_contact_submissions_campaign ON contact_submissions(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_contact_submissions_created ON contact_submissions(created_at);

  -- Supports the "needs attention" member signals, which probe payments and emails_log
  -- once per signal per member. See docs/needs-attention-signals.md.
  CREATE INDEX IF NOT EXISTS idx_payments_member_status ON payments(member_id, status);
  CREATE INDEX IF NOT EXISTS idx_emails_log_member_type ON emails_log(member_id, email_type);
  CREATE INDEX IF NOT EXISTS idx_emails_log_status ON emails_log(status, created_at);
`;

/**
 * Converts the canonical SQLite schema DDL to PostgreSQL DDL.
 */
function toPgSchema(sql) {
  return sql
      .replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
      .replace(/datetime\s*\(\s*['"]now['"]\s*\)/gi, 'NOW()')
      .replace(/\bTEXT\s+DEFAULT\s+\(NOW\(\)\)/g, 'TIMESTAMP DEFAULT NOW()');
}

module.exports = { SCHEMA, toPgSchema };
