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
    `INSERT INTO members (first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, status, member_number, membership_type, primary_member_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    m.first_name, m.last_name, m.email, m.phone,
    m.address_street, m.address_city, m.address_state, m.address_zip,
    m.membership_year, m.status, m.member_number || null,
    m.membership_type || 'individual', m.primary_member_id || null
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
  const info = db.prepare(
    `INSERT INTO payments (member_id, amount_cents, currency, status, description, payment_method, stripe_session_id, stripe_payment_intent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(p.member_id, p.amount_cents, p.currency, p.status, p.description, p.payment_method, p.stripe_session_id, p.stripe_payment_intent);
  return { ...p, id: info.lastInsertRowid };
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

module.exports = { buildMember, insertMember, insertSetting, insertCard, buildStripeSession, buildAdmin, insertAdmin, insertPayment, buildFamilyMembership, insertFamilyMembership };
