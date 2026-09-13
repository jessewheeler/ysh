jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const paymentRepo = require('../../db/repos/payments');
const { insertMember, insertPayment } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('create', () => {
  test('inserts a payment and returns result', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    const result = await paymentRepo.create({ member_id: m.id, amount_cents: 2500, currency: 'usd', status: 'pending', description: 'Dues' });
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
  });
});

describe('completeBySessionId', () => {
  test('marks payment as completed', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id, stripe_session_id: 'sess_123', status: 'pending' });

    await paymentRepo.completeBySessionId('sess_123', 'pi_abc');
    const payments = await paymentRepo.findByMemberId(m.id);
    expect(payments[0].status).toBe('completed');
    expect(payments[0].stripe_payment_intent).toBe('pi_abc');
  });
});

describe('findByMemberId', () => {
  test('returns payments for a member', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id });
    insertPayment(testDb, { member_id: m.id, amount_cents: 5000 });
    const payments = await paymentRepo.findByMemberId(m.id);
    expect(payments).toHaveLength(2);
  });
});

describe('listWithMembers', () => {
  test('returns paginated payments with member info', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com', first_name: 'Jane' });
    insertPayment(testDb, { member_id: m.id });
    const result = await paymentRepo.listWithMembers({ limit: 25, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.payments[0].first_name).toBe('Jane');
  });
});

describe('listAllWithMembers', () => {
  test('returns all payments with member info', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id });
    const payments = await paymentRepo.listAllWithMembers();
    expect(payments).toHaveLength(1);
    expect(payments[0].first_name).toBeDefined();
  });
});

describe('listRecent', () => {
  test('returns limited recent payments', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id });
    insertPayment(testDb, { member_id: m.id, amount_cents: 5000 });
    const payments = await paymentRepo.listRecent(1);
    expect(payments).toHaveLength(1);
  });
});

describe('sumCompletedCents', () => {
  test('sums completed payments only', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id, amount_cents: 2500, status: 'completed' });
    insertPayment(testDb, { member_id: m.id, amount_cents: 1000, status: 'pending' });
    expect(await paymentRepo.sumCompletedCents()).toBe(2500);
  });
});

describe('countAll', () => {
  test('counts all payments', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id });
    insertPayment(testDb, { member_id: m.id });
    expect(await paymentRepo.countAll()).toBe(2);
  });
});

describe('findById', () => {
  test('returns the row, or undefined for an unknown id', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    const p = insertPayment(testDb, { member_id: m.id });
    expect((await paymentRepo.findById(p.id)).id).toBe(p.id);
    expect(await paymentRepo.findById(999)).toBeUndefined();
  });
});

describe('voidById', () => {
  test('flips a completed offline payment to voided with the reason, note and time', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    const p = insertPayment(testDb, { member_id: m.id, payment_method: 'check', status: 'completed' });

    const row = await paymentRepo.voidById(p.id, { reason: 'other', note: 'Wrong member' });

    expect(row.status).toBe('voided');
    expect(row.void_reason).toBe('other');
    expect(row.void_note).toBe('Wrong member');
    expect(row.voided_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect((await paymentRepo.findById(p.id)).status).toBe('voided');
  });

  test('writes an audit UPDATE row whose old snapshot is still completed', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    const p = insertPayment(testDb, { member_id: m.id, payment_method: 'cash' });

    await paymentRepo.voidById(p.id, { reason: 'duplicate', note: null });

    const log = testDb.prepare(
      "SELECT * FROM audit_log WHERE table_name = 'payments' AND action = 'UPDATE' AND record_id = ?"
    ).get(String(p.id));
    expect(log).toBeTruthy();
    expect(JSON.parse(log.old_values).status).toBe('completed');
    expect(JSON.parse(log.new_values).status).toBe('voided');
    expect(JSON.parse(log.new_values).void_reason).toBe('duplicate');
  });

  test('drops the amount from sumCompletedCents', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    const keep = insertPayment(testDb, { member_id: m.id, amount_cents: 1000, payment_method: 'cash' });
    const gone = insertPayment(testDb, { member_id: m.id, amount_cents: 2500, payment_method: 'cash' });

    await paymentRepo.voidById(gone.id, { reason: 'voided' });

    expect(await paymentRepo.sumCompletedCents()).toBe(1000);
    expect((await paymentRepo.findById(keep.id)).status).toBe('completed');
  });

  test.each([
    ['a Stripe charge', { payment_method: 'stripe', status: 'completed' }],
    ['a pending payment', { payment_method: 'check', status: 'pending' }],
    ['a failed payment', { payment_method: 'check', status: 'failed' }],
  ])('refuses %s and writes nothing', async (_label, overrides) => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    const p = insertPayment(testDb, { member_id: m.id, ...overrides });

    expect(await paymentRepo.voidById(p.id, { reason: 'duplicate' })).toBeNull();

    expect((await paymentRepo.findById(p.id)).status).toBe(overrides.status);
    const logs = testDb.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE table_name = 'payments'").get();
    expect(logs.c).toBe(0);
  });

  test('a second void of the same payment is a no-op', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    const p = insertPayment(testDb, { member_id: m.id, payment_method: 'cash' });

    await paymentRepo.voidById(p.id, { reason: 'duplicate' });
    expect(await paymentRepo.voidById(p.id, { reason: 'refunded' })).toBeNull();

    expect((await paymentRepo.findById(p.id)).void_reason).toBe('duplicate');
    const logs = testDb.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE table_name = 'payments'").get();
    expect(logs.c).toBe(1);
  });

  test('returns null for an unknown id', async () => {
    expect(await paymentRepo.voidById(4242, { reason: 'duplicate' })).toBeNull();
  });
});

describe('findRecentCompletedDuplicate', () => {
  const since = () => new Date(Date.now() - 60 * 1000);

  test('finds an identical completed payment inside the window', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    const p = insertPayment(testDb, { member_id: m.id, amount_cents: 2500, payment_method: 'check' });

    const match = await paymentRepo.findRecentCompletedDuplicate({
      memberId: m.id, amountCents: 2500, paymentMethod: 'check', since: since(),
    });
    expect(match.id).toBe(p.id);
  });

  test.each([
    ['a different amount', { amount_cents: 2600, payment_method: 'check' }],
    ['a different method', { amount_cents: 2500, payment_method: 'cash' }],
    ['a voided payment', { amount_cents: 2500, payment_method: 'check', status: 'voided' }],
    ['a pending payment', { amount_cents: 2500, payment_method: 'check', status: 'pending' }],
    ['a payment older than the window', { amount_cents: 2500, payment_method: 'check', created_at: '2020-01-01 00:00:00' }],
  ])('ignores %s', async (_label, overrides) => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id, ...overrides });

    expect(await paymentRepo.findRecentCompletedDuplicate({
      memberId: m.id, amountCents: 2500, paymentMethod: 'check', since: since(),
    })).toBeUndefined();
  });

  test('ignores another member\'s identical payment', async () => {
    const testDb = db.__getCurrentDb();
    const a = insertMember(testDb, { email: 'a@a.com' });
    const b = insertMember(testDb, { email: 'b@b.com' });
    insertPayment(testDb, { member_id: a.id, amount_cents: 2500, payment_method: 'check' });

    expect(await paymentRepo.findRecentCompletedDuplicate({
      memberId: b.id, amountCents: 2500, paymentMethod: 'check', since: since(),
    })).toBeUndefined();
  });
});
