jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const paymentRepo = require('../../db/repos/payments');
const { insertMember, insertPayment } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('create', () => {
  test('inserts a payment and returns result', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    const result = paymentRepo.create({ member_id: m.id, amount_cents: 2500, currency: 'usd', status: 'pending', description: 'Dues' });
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
  });
});

describe('completeBySessionId', () => {
  test('marks payment as completed', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id, stripe_session_id: 'sess_123', status: 'pending' });

    paymentRepo.completeBySessionId('sess_123', 'pi_abc');
    const payments = paymentRepo.findByMemberId(m.id);
    expect(payments[0].status).toBe('completed');
    expect(payments[0].stripe_payment_intent).toBe('pi_abc');
  });
});

describe('findByMemberId', () => {
  test('returns payments for a member', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id });
    insertPayment(testDb, { member_id: m.id, amount_cents: 5000 });
    expect(paymentRepo.findByMemberId(m.id)).toHaveLength(2);
  });
});

describe('listWithMembers', () => {
  test('returns paginated payments with member info', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com', first_name: 'Jane' });
    insertPayment(testDb, { member_id: m.id });
    const result = paymentRepo.listWithMembers({ limit: 25, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.payments[0].first_name).toBe('Jane');
  });
});

describe('listAllWithMembers', () => {
  test('returns all payments with member info', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id });
    const payments = paymentRepo.listAllWithMembers();
    expect(payments).toHaveLength(1);
    expect(payments[0].first_name).toBeDefined();
  });
});

describe('listRecent', () => {
  test('returns limited recent payments', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id });
    insertPayment(testDb, { member_id: m.id, amount_cents: 5000 });
    expect(paymentRepo.listRecent(1)).toHaveLength(1);
  });
});

describe('sumCompletedCents', () => {
  test('sums completed payments only', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id, amount_cents: 2500, status: 'completed' });
    insertPayment(testDb, { member_id: m.id, amount_cents: 1000, status: 'pending' });
    expect(paymentRepo.sumCompletedCents()).toBe(2500);
  });
});

describe('countAll', () => {
  test('counts all payments', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id });
    insertPayment(testDb, { member_id: m.id });
    expect(paymentRepo.countAll()).toBe(2);
  });
});
