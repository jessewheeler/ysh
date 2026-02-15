jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const paymentsService = require('../../services/payments');
const memberRepo = require('../../db/repos/members');
const paymentRepo = require('../../db/repos/payments');
const { insertMember, insertPayment } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('recordOfflinePayment', () => {
  test('creates a completed payment record', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });

    paymentsService.recordOfflinePayment({
      memberId: m.id,
      amountCents: 2500,
      paymentMethod: 'check',
      description: 'Annual dues',
    });

    const payments = paymentRepo.findByMemberId(m.id);
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('completed');
    expect(payments[0].amount_cents).toBe(2500);
    expect(payments[0].payment_method).toBe('check');
  });

  test('activates member when activateMember is true', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com', status: 'pending' });

    paymentsService.recordOfflinePayment({
      memberId: m.id,
      amountCents: 2500,
      activateMember: true,
    });

    expect(memberRepo.findById(m.id).status).toBe('active');
  });

  test('does not activate when activateMember is falsy', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com', status: 'pending' });

    paymentsService.recordOfflinePayment({
      memberId: m.id,
      amountCents: 2500,
    });

    expect(memberRepo.findById(m.id).status).toBe('pending');
  });
});

describe('completeStripePayment', () => {
  test('marks payment as completed by session id', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id, stripe_session_id: 'sess_123', status: 'pending' });

    paymentsService.completeStripePayment('sess_123', 'pi_abc');

    const payments = paymentRepo.findByMemberId(m.id);
    expect(payments[0].status).toBe('completed');
    expect(payments[0].stripe_payment_intent).toBe('pi_abc');
  });
});
