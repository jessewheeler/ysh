jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { insertMember, insertPayment } = require('../helpers/fixtures');
const { activateMember } = require('../../services/members');

beforeEach(() => {
  db.__resetTestDb();
});

describe('offline payment recording', () => {
  test('inserts payment with correct amount in cents', () => {
    const testDb = db.__getCurrentDb();
    const member = insertMember(testDb, { email: 'pay@test.com' });

    testDb.prepare(
      `INSERT INTO payments (member_id, amount_cents, currency, status, description, payment_method)
       VALUES (?, ?, 'usd', 'completed', ?, ?)`
    ).run(member.id, 2500, 'Membership dues', 'cash');

    const payment = testDb.prepare('SELECT * FROM payments WHERE member_id = ?').get(member.id);
    expect(payment.amount_cents).toBe(2500);
    expect(payment.status).toBe('completed');
    expect(payment.payment_method).toBe('cash');
  });

  test('defaults payment_method to stripe', () => {
    const testDb = db.__getCurrentDb();
    const member = insertMember(testDb, { email: 'def@test.com' });

    testDb.prepare(
      'INSERT INTO payments (member_id, amount_cents, currency, status, description) VALUES (?, ?, ?, ?, ?)'
    ).run(member.id, 1000, 'usd', 'completed', 'Test');

    const payment = testDb.prepare('SELECT * FROM payments WHERE member_id = ?').get(member.id);
    expect(payment.payment_method).toBe('stripe');
  });

  test('records multiple payments for the same member', () => {
    const testDb = db.__getCurrentDb();
    const member = insertMember(testDb, { email: 'multi@test.com' });

    insertPayment(testDb, { member_id: member.id, amount_cents: 2500, payment_method: 'cash' });
    insertPayment(testDb, { member_id: member.id, amount_cents: 5000, payment_method: 'check' });

    const payments = testDb.prepare('SELECT * FROM payments WHERE member_id = ?').all(member.id);
    expect(payments.length).toBe(2);
    expect(payments.map(p => p.payment_method).sort()).toEqual(['cash', 'check']);
  });

  test('payment with member activation changes status to active', async () => {
    const testDb = db.__getCurrentDb();
    const member = insertMember(testDb, { email: 'act@test.com', status: 'pending' });

    insertPayment(testDb, { member_id: member.id, amount_cents: 2500, payment_method: 'cash' });
    await activateMember(member.id);

    const updated = testDb.prepare('SELECT * FROM members WHERE id = ?').get(member.id);
    expect(updated.status).toBe('active');
  });

  test('insertPayment fixture uses defaults correctly', () => {
    const testDb = db.__getCurrentDb();
    const member = insertMember(testDb, { email: 'fix@test.com' });
    const payment = insertPayment(testDb, { member_id: member.id });

    expect(payment.amount_cents).toBe(2500);
    expect(payment.currency).toBe('usd');
    expect(payment.status).toBe('completed');
    expect(payment.payment_method).toBe('stripe');
    expect(payment.description).toBe('Membership dues');
    expect(payment.id).toBeDefined();
  });
});
