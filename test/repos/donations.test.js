jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const donationRepo = require('../../db/repos/donations');
const donationFundsRepo = require('../../db/repos/donationFunds');
const { insertMember, insertDonation, insertDonationFund } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

function auditRows(tableName) {
  return db.__getCurrentDb()
    .prepare('SELECT * FROM audit_log WHERE table_name = ? ORDER BY id')
    .all(tableName);
}

describe('donations repo: create', () => {
  test('stores a named gift with its fund, fee cover and total', async () => {
    const fund = insertDonationFund(db, { name: 'Heart Wheels' });
    const member = insertMember(db, { email: 'jane@example.com' });

    const row = await donationRepo.create({
      donor_name: 'Jane Donor',
      donor_email: 'jane@example.com',
      is_anonymous: false,
      fund_id: fund.id,
      gift_cents: 2500,
      fee_cover_cents: 106,
      member_id: member.id,
    });

    expect(row).toMatchObject({
      donor_name: 'Jane Donor',
      donor_email: 'jane@example.com',
      is_anonymous: 0,
      fund_id: fund.id,
      gift_cents: 2500,
      fee_cover_cents: 106,
      amount_cents: 2606,
      status: 'pending',
      member_id: member.id,
    });
  });

  test('an anonymous gift stores no name, email or member even when they are passed in', async () => {
    const fund = insertDonationFund(db);
    const member = insertMember(db, { email: 'secret@example.com' });

    const row = await donationRepo.create({
      donor_name: 'Should Not Be Stored',
      donor_email: 'secret@example.com',
      is_anonymous: true,
      fund_id: fund.id,
      gift_cents: 1200,
      member_id: member.id,
    });

    expect(row.is_anonymous).toBe(1);
    expect(row.donor_name).toBeNull();
    expect(row.donor_email).toBeNull();
    expect(row.member_id).toBeNull();
  });

  test('the audit snapshot of an anonymous gift holds no donor details', async () => {
    const fund = insertDonationFund(db);
    await donationRepo.create({
      donor_name: 'Should Not Be Stored',
      donor_email: 'secret@example.com',
      is_anonymous: true,
      fund_id: fund.id,
      gift_cents: 1200,
    });

    const [entry] = auditRows('donations');
    expect(entry.action).toBe('INSERT');
    expect(entry.new_values).not.toContain('secret@example.com');
    expect(entry.new_values).not.toContain('Should Not Be Stored');
  });

  test('the table refuses a named gift with no donor, and an anonymous one with a donor', () => {
    const raw = db.__getCurrentDb();
    expect(() => raw.prepare(
      'INSERT INTO donations (is_anonymous, gift_cents, amount_cents) VALUES (0, 1200, 1200)'
    ).run()).toThrow(/CHECK/i);
    expect(() => raw.prepare(
      "INSERT INTO donations (is_anonymous, donor_name, donor_email, gift_cents, amount_cents) VALUES (1, 'A', 'a@b.co', 1200, 1200)"
    ).run()).toThrow(/CHECK/i);
  });
});

describe('donations repo: complete', () => {
  test('the first completion marks the row completed and returns true', async () => {
    insertDonation(db, { stripe_session_id: 'cs_1', status: 'pending' });

    expect(await donationRepo.complete('cs_1', { paymentIntent: 'pi_1' })).toBe(true);

    const row = await donationRepo.findBySessionId('cs_1');
    expect(row.status).toBe('completed');
    expect(row.stripe_payment_intent).toBe('pi_1');
  });

  test('a repeat completion (webhook retry) returns false', async () => {
    insertDonation(db, { stripe_session_id: 'cs_2', status: 'pending' });
    await donationRepo.complete('cs_2', { paymentIntent: 'pi_2' });

    expect(await donationRepo.complete('cs_2', { paymentIntent: 'pi_2' })).toBe(false);
    expect(auditRows('donations').filter(r => r.action === 'UPDATE')).toHaveLength(1);
  });

  test('links the member found at completion time', async () => {
    const member = insertMember(db, { email: 'donor@member.com' });
    insertDonation(db, { stripe_session_id: 'cs_3', status: 'pending', donor_email: 'donor@member.com' });

    await donationRepo.complete('cs_3', { memberId: member.id });

    expect((await donationRepo.findBySessionId('cs_3')).member_id).toBe(member.id);
  });

  test('keeps a link made at checkout when completion finds no member', async () => {
    const member = insertMember(db, { email: 'donor@member.com' });
    insertDonation(db, { stripe_session_id: 'cs_4', status: 'pending', member_id: member.id });

    await donationRepo.complete('cs_4', { memberId: null });

    expect((await donationRepo.findBySessionId('cs_4')).member_id).toBe(member.id);
  });

  test('never links an anonymous gift, even when handed a member', async () => {
    const member = insertMember(db, { email: 'donor@member.com' });
    insertDonation(db, { stripe_session_id: 'cs_5', status: 'pending', is_anonymous: true });

    await donationRepo.complete('cs_5', { memberId: member.id });

    const row = await donationRepo.findBySessionId('cs_5');
    expect(row.status).toBe('completed');
    expect(row.member_id).toBeNull();
  });

  test('falls back to the donation id when the session id was never attached', async () => {
    const d = insertDonation(db, { stripe_session_id: null, status: 'pending' });

    expect(await donationRepo.complete('cs_late', { donationId: d.id })).toBe(true);

    const row = await donationRepo.findById(d.id);
    expect(row.status).toBe('completed');
    expect(row.stripe_session_id).toBe('cs_late');
  });

  test('returns false for a session it has never heard of', async () => {
    expect(await donationRepo.complete('cs_unknown', {})).toBe(false);
  });
});

describe('donations repo: failBySessionId', () => {
  test('marks a pending donation failed', async () => {
    insertDonation(db, { stripe_session_id: 'cs_x', status: 'pending' });

    expect(await donationRepo.failBySessionId('cs_x')).toBe(true);
    expect((await donationRepo.findBySessionId('cs_x')).status).toBe('failed');
  });

  test('leaves a completed donation alone', async () => {
    insertDonation(db, { stripe_session_id: 'cs_y', status: 'completed' });

    expect(await donationRepo.failBySessionId('cs_y')).toBe(false);
    expect((await donationRepo.findBySessionId('cs_y')).status).toBe('completed');
  });
});

describe('donations repo: reporting', () => {
  test('summary counts completed donations only', async () => {
    insertDonation(db, { gift_cents: 1200, fee_cover_cents: 67 });
    insertDonation(db, { gift_cents: 2500 });
    insertDonation(db, { gift_cents: 9900, status: 'pending' });
    insertDonation(db, { gift_cents: 5000, status: 'failed' });

    expect(await donationRepo.summary()).toEqual({
      count: 2,
      giftCents: 3700,
      feeCoverCents: 67,
      amountCents: 3767,
    });
    expect(await donationRepo.sumCompletedCents()).toBe(3767);
    expect((await donationRepo.completedAmounts()).sort((a, b) => a - b)).toEqual([1267, 2500]);
  });

  test('summary is all zeroes on an empty table', async () => {
    expect(await donationRepo.summary()).toEqual({ count: 0, giftCents: 0, feeCoverCents: 0, amountCents: 0 });
  });

  test('totalsByFund lists every fund in sort order, counts anonymous gifts, and skips unpaid ones', async () => {
    const birds = insertDonationFund(db, { name: 'Battle of the Birds', sort_order: 2 });
    const wheels = insertDonationFund(db, { name: 'Heart Wheels', sort_order: 1 });
    const retired = insertDonationFund(db, { name: 'Old Drive', sort_order: 3, is_active: 0 });
    insertDonation(db, { fund_id: wheels.id, gift_cents: 1200 });
    insertDonation(db, { fund_id: wheels.id, gift_cents: 2500, is_anonymous: true });
    insertDonation(db, { fund_id: wheels.id, gift_cents: 9900, status: 'pending' });
    insertDonation(db, { fund_id: retired.id, gift_cents: 5000 });

    expect(await donationRepo.totalsByFund()).toEqual([
      { fundId: wheels.id, fundName: 'Heart Wheels', isActive: true, count: 2, giftCents: 3700 },
      { fundId: birds.id, fundName: 'Battle of the Birds', isActive: true, count: 0, giftCents: 0 },
      { fundId: retired.id, fundName: 'Old Drive', isActive: false, count: 1, giftCents: 5000 },
    ]);
  });

  test('findByMemberId returns only that member\'s gifts, with the fund name', async () => {
    const fund = insertDonationFund(db, { name: 'Heart Wheels' });
    const member = insertMember(db, { email: 'a@example.com' });
    const other = insertMember(db, { email: 'b@example.com' });
    insertDonation(db, { member_id: member.id, fund_id: fund.id, gift_cents: 1200 });
    insertDonation(db, { member_id: other.id, fund_id: fund.id, gift_cents: 9900 });
    insertDonation(db, { is_anonymous: true, fund_id: fund.id, gift_cents: 5000 });

    const rows = await donationRepo.findByMemberId(member.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gift_cents: 1200, fund_name: 'Heart Wheels' });
  });

  test('list pages newest first and carries the linked member\'s name', async () => {
    const member = insertMember(db, { email: 'a@example.com', first_name: 'Ann', last_name: 'Able' });
    insertDonation(db, { member_id: member.id, created_at: '2026-11-01 10:00:00', gift_cents: 100 });
    insertDonation(db, { created_at: '2026-11-02 10:00:00', gift_cents: 200 });
    insertDonation(db, { created_at: '2026-11-03 10:00:00', gift_cents: 300 });

    const first = await donationRepo.list({ limit: 2, offset: 0 });
    expect(first.total).toBe(3);
    expect(first.donations.map(d => d.gift_cents)).toEqual([300, 200]);

    const second = await donationRepo.list({ limit: 2, offset: 2 });
    expect(second.donations).toHaveLength(1);
    expect(second.donations[0]).toMatchObject({ member_first_name: 'Ann', member_last_name: 'Able' });
  });
});

describe('donation funds repo', () => {
  test('create, update and setActive each write an audit row', async () => {
    const fund = await donationFundsRepo.create({ name: 'Turkey Drive', sort_order: 5 });
    await donationFundsRepo.update(fund.id, { name: 'Turkey Drive 2026', sort_order: 6 });
    await donationFundsRepo.setActive(fund.id, false);

    expect(auditRows('donation_funds').map(r => r.action)).toEqual(['INSERT', 'UPDATE', 'UPDATE']);
    expect(await donationFundsRepo.findById(fund.id)).toMatchObject({
      name: 'Turkey Drive 2026', sort_order: 6, is_active: 0,
    });
  });

  test('listActive leaves out retired funds and follows sort order', async () => {
    insertDonationFund(db, { name: 'B', sort_order: 2 });
    insertDonationFund(db, { name: 'A', sort_order: 1 });
    insertDonationFund(db, { name: 'Gone', sort_order: 0, is_active: 0 });

    expect((await donationFundsRepo.listActive()).map(f => f.name)).toEqual(['A', 'B']);
    expect((await donationFundsRepo.listAll()).map(f => f.name)).toEqual(['A', 'B', 'Gone']);
  });

  test('update and setActive return null for a fund that does not exist', async () => {
    expect(await donationFundsRepo.update(999, { name: 'X', sort_order: 1 })).toBeNull();
    expect(await donationFundsRepo.setActive(999, false)).toBeNull();
  });
});
