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
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','refunded')),
    description TEXT,
    payment_method TEXT NOT NULL DEFAULT 'stripe',
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

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
    closes_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vote_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vote_id INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS vote_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vote_id INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    option_id INTEGER NOT NULL REFERENCES vote_options(id) ON DELETE CASCADE,
    voted_at TEXT DEFAULT (datetime('now')),
    UNIQUE(vote_id, member_id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT,
    event_type TEXT NOT NULL CHECK(event_type IN ('game','watch_party')),
    event_date TEXT,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS event_volunteer_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    role_name TEXT NOT NULL,
    max_volunteers INTEGER,
    display_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS volunteer_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES event_volunteer_roles(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    signed_up_at TEXT DEFAULT (datetime('now')),
    UNIQUE(event_id, member_id)
  );
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
