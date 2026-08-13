function buildMember(overrides = {}) {
  return {
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    phone: '555-0100',
    address_street: '123 Main St',
    address_city: 'Billings',
    address_state: 'MT',
    address_zip: '59101',
    membership_year: new Date().getFullYear(),
    status: 'pending',
    ...overrides,
  };
}

function insertMember(db, overrides = {}) {
  const m = buildMember(overrides);
  const info = db.prepare(
    `INSERT INTO members (first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, status, member_number, membership_type, primary_member_id, expiry_date, is_lifetime, renewal_token, renewal_token_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  ).run(
    m.first_name, m.last_name, m.email, m.phone,
    m.address_street, m.address_city, m.address_state, m.address_zip,
    m.membership_year, m.status, m.member_number || null,
    m.membership_type || 'individual', m.primary_member_id || null,
    m.expiry_date || null, m.is_lifetime ? 1 : 0,
    m.renewal_token || null, m.renewal_token_expires_at || null,
    m.created_at || null
  );
  return { ...m, id: info.lastInsertRowid };
}

function insertSetting(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run(key, value);
}

function insertCard(db, { member_id, pdf_path, png_path, year }) {
  const info = db.prepare(
    'INSERT INTO membership_cards (member_id, pdf_path, png_path, year) VALUES (?, ?, ?, ?)'
  ).run(member_id, pdf_path || null, png_path || null, year || new Date().getFullYear());
  return { id: info.lastInsertRowid };
}

function buildStripeSession(overrides = {}) {
  return {
    id: 'cs_test_abc123',
    amount_total: 2500,
    currency: 'usd',
    payment_status: 'paid',
    metadata: { member_id: '1' },
    ...overrides,
  };
}

function buildAdmin(overrides = {}) {
  return {
    first_name: 'Test',
    last_name: 'Admin',
    email: 'admin@example.com',
    role: 'super_admin',
    ...overrides,
  };
}

function insertAdmin(db, overrides = {}) {
  const a = buildAdmin(overrides);
  const info = db.prepare(
    'INSERT INTO members (first_name, last_name, email, role) VALUES (?, ?, ?, ?)'
  ).run(a.first_name, a.last_name, a.email, a.role);
  return { ...a, id: info.lastInsertRowid };
}

function insertPayment(db, overrides = {}) {
  const p = {
    member_id: overrides.member_id,
    amount_cents: overrides.amount_cents || 2500,
    currency: overrides.currency || 'usd',
    status: overrides.status || 'completed',
    description: overrides.description || 'Membership dues',
    payment_method: overrides.payment_method || 'stripe',
    stripe_session_id: overrides.stripe_session_id || null,
    stripe_payment_intent: overrides.stripe_payment_intent || null,
  };
  // created_at is overridable so a test can make a payment old enough to count as an
  // abandoned checkout.
  const info = db.prepare(
    `INSERT INTO payments (member_id, amount_cents, currency, status, description, payment_method, stripe_session_id, stripe_payment_intent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  ).run(p.member_id, p.amount_cents, p.currency, p.status, p.description, p.payment_method, p.stripe_session_id, p.stripe_payment_intent, overrides.created_at || null);
  return { ...p, created_at: overrides.created_at || null, id: info.lastInsertRowid };
}

function insertEmailLog(db, overrides = {}) {
  const e = {
    to_email: overrides.to_email || 'jane@example.com',
    to_name: overrides.to_name || 'Jane Doe',
    subject: overrides.subject || 'Test subject',
    email_type: overrides.email_type || 'renewal_reminder',
    status: overrides.status || 'sent',
    error: overrides.error || null,
    member_id: overrides.member_id ?? null,
  };
  const info = db.prepare(
    `INSERT INTO emails_log (to_email, to_name, subject, email_type, status, error, member_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  ).run(e.to_email, e.to_name, e.subject, e.email_type, e.status, e.error, e.member_id, overrides.created_at || null);
  return { ...e, id: info.lastInsertRowid };
}

function buildFamilyMembership(overrides = {}) {
  return {
    primaryMember: buildMember({
      email: 'primary@example.com',
      membership_type: 'family',
      ...overrides.primaryMember
    }),
    familyMembers: overrides.familyMembers || [
      { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
      { first_name: 'Jimmy', last_name: 'Doe', email: '' }
    ]
  };
}

function insertFamilyMembership(db, overrides = {}) {
  const year = new Date().getFullYear();
  const primary = insertMember(db, {
    membership_type: 'family',
    email: 'primary@family.test',
    ...overrides.primaryMember
  });

  const familyMembers = (overrides.familyMembers || [
    { first_name: 'Jane', last_name: 'Doe', email: 'jane@family.test' },
    { first_name: 'Jimmy', last_name: 'Doe', email: 'jimmy@family.test' }
  ]).map((fm, index) => {
    return insertMember(db, {
      ...fm,
      email: fm.email || `family${index}@family.test`,
      membership_type: 'family',
      primary_member_id: primary.id,
      membership_year: year,
      status: primary.status
    });
  });

  return { primary, familyMembers };
}

function insertPeriod(db, overrides = {}) {
    const p = {
        label: overrides.label || '2025-26 Season',
        start_date: overrides.start_date || '2025-04-01',
        end_date: overrides.end_date || '2026-07-31',
        individual_dues_cents: overrides.individual_dues_cents ?? 1600,
        family_dues_cents: overrides.family_dues_cents ?? 2600,
        electronic_surcharge_cents: overrides.electronic_surcharge_cents ?? 0,
    };
    const info = db.prepare(
        `INSERT INTO membership_periods (label, start_date, end_date, individual_dues_cents, family_dues_cents, electronic_surcharge_cents)
     VALUES (?, ?, ?, ?, ?, ?)`
    ).run(p.label, p.start_date, p.end_date, p.individual_dues_cents, p.family_dues_cents, p.electronic_surcharge_cents);
    return {...p, id: info.lastInsertRowid};
}

function enrollMember(db, memberId, periodId, paymentId = null, createdAt = null) {
    const info = createdAt
        ? db.prepare(
            `INSERT OR IGNORE INTO membership_years (member_id, membership_period_id, payment_id, created_at)
     VALUES (?, ?, ?, ?)`
        ).run(memberId, periodId, paymentId, createdAt)
        : db.prepare(
            `INSERT OR IGNORE INTO membership_years (member_id, membership_period_id, payment_id)
     VALUES (?, ?, ?)`
        ).run(memberId, periodId, paymentId);
    return {id: info.lastInsertRowid, member_id: memberId, membership_period_id: periodId, payment_id: paymentId};
}

function insertCampaign(db, overrides = {}) {
    const c = {
        name: 'Test Campaign',
        utm_campaign: 'test26',
        utm_source: 'print',
        utm_medium: 'flyer',
        utm_content: null,
        target_path: '/membership',
        notes: null,
        is_active: 1,
        ...overrides,
    };
    const info = db.prepare(
        `INSERT INTO campaigns (name, utm_campaign, utm_source, utm_medium, utm_content, target_path, notes, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(c.name, c.utm_campaign, c.utm_source, c.utm_medium, c.utm_content, c.target_path, c.notes,
        c.is_active ? 1 : 0);
    return {...c, id: info.lastInsertRowid};
}

function insertCampaignVisit(db, {campaign_id, landing_path = '/membership', referrer = null, created_at = null}) {
    const info = created_at
        ? db.prepare(
            `INSERT INTO campaign_visits (campaign_id, landing_path, referrer, created_at) VALUES (?, ?, ?, ?)`
        ).run(campaign_id, landing_path, referrer, created_at)
        : db.prepare(
            `INSERT INTO campaign_visits (campaign_id, landing_path, referrer) VALUES (?, ?, ?)`
        ).run(campaign_id, landing_path, referrer);
    return {id: info.lastInsertRowid, campaign_id, landing_path, referrer};
}

function insertContactSubmission(db, overrides = {}) {
    const s = {
        name: 'Contact Person',
        email: 'contact@example.com',
        message: 'Hello there',
        campaign_id: null,
        email_status: 'sent',
        ...overrides,
    };
    const info = db.prepare(
        `INSERT INTO contact_submissions (name, email, message, campaign_id, email_status)
         VALUES (?, ?, ?, ?, ?)`
    ).run(s.name, s.email, s.message, s.campaign_id, s.email_status);
    return {...s, id: info.lastInsertRowid};
}

module.exports = {
    buildMember,
    insertMember,
    insertCampaign,
    insertCampaignVisit,
    insertContactSubmission,
    insertSetting,
    insertCard,
    buildStripeSession,
    buildAdmin,
    insertAdmin,
    insertPayment,
    insertEmailLog,
    buildFamilyMembership,
    insertFamilyMembership,
    insertPeriod,
    enrollMember
};
