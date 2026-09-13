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
  test('creates a completed payment record', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });

    await paymentsService.recordOfflinePayment({
      memberId: m.id,
      amountCents: 2500,
      paymentMethod: 'check',
      description: 'Annual dues',
    });

    const payments = await paymentRepo.findByMemberId(m.id);
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe('completed');
    expect(payments[0].amount_cents).toBe(2500);
    expect(payments[0].payment_method).toBe('check');
  });

  test('returns the new payment id so the caller can link an enrollment to it', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });

    const paymentId = await paymentsService.recordOfflinePayment({
      memberId: m.id,
      amountCents: 2500,
    });

    const payments = await paymentRepo.findByMemberId(m.id);
    expect(paymentId).toBe(payments[0].id);
  });

  test('never activates on its own — that belongs to services/activation', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com', status: 'pending' });

    await paymentsService.recordOfflinePayment({
      memberId: m.id,
      amountCents: 2500,
    });

    expect((await memberRepo.findById(m.id)).status).toBe('pending');
  });
});

describe('completeStripePayment', () => {
  test('marks payment as completed by session id', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id, stripe_session_id: 'sess_123', status: 'pending' });

    await paymentsService.completeStripePayment('sess_123', 'pi_abc');

    const payments = await paymentRepo.findByMemberId(m.id);
    expect(payments[0].status).toBe('completed');
    expect(payments[0].stripe_payment_intent).toBe('pi_abc');
  });
});

describe('isRecentOfflineDuplicate', () => {
  test('is true for an identical completed payment just recorded, false otherwise', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    await paymentsService.recordOfflinePayment({ memberId: m.id, amountCents: 2500, paymentMethod: 'check' });

    expect(await paymentsService.isRecentOfflineDuplicate({ memberId: m.id, amountCents: 2500, paymentMethod: 'check' })).toBe(true);
    expect(await paymentsService.isRecentOfflineDuplicate({ memberId: m.id, amountCents: 3000, paymentMethod: 'check' })).toBe(false);
  });

  test('defaults the method to cash, matching recordOfflinePayment', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    await paymentsService.recordOfflinePayment({ memberId: m.id, amountCents: 2500 });

    expect(await paymentsService.isRecentOfflineDuplicate({ memberId: m.id, amountCents: 2500 })).toBe(true);
  });
});

describe('voidPayment', () => {
  async function seedCheckPayment(overrides = {}) {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: overrides.email || 'a@a.com' });
    const p = insertPayment(testDb, { member_id: m.id, payment_method: 'check', ...overrides });
    return { m, p };
  }

  test('voids a completed check payment and returns the row', async () => {
    const { m, p } = await seedCheckPayment();
    const row = await paymentsService.voidPayment({ paymentId: p.id, memberId: m.id, reason: 'duplicate', note: '' });
    expect(row.status).toBe('voided');
    expect(row.void_reason).toBe('duplicate');
    expect(row.void_note).toBeNull();
  });

  test('trims and keeps the note for Other', async () => {
    const { m, p } = await seedCheckPayment();
    const row = await paymentsService.voidPayment({ paymentId: p.id, memberId: m.id, reason: 'other', note: '  wrong member  ' });
    expect(row.void_note).toBe('wrong member');
  });

  test('rejects a reason that is not on the list', async () => {
    const { m, p } = await seedCheckPayment();
    await expect(paymentsService.voidPayment({ paymentId: p.id, memberId: m.id, reason: 'oops' }))
      .rejects.toThrow(/choose a reason/i);
    expect((await paymentRepo.findById(p.id)).status).toBe('completed');
  });

  test('rejects Other without a note', async () => {
    const { m, p } = await seedCheckPayment();
    await expect(paymentsService.voidPayment({ paymentId: p.id, memberId: m.id, reason: 'other', note: '   ' }))
      .rejects.toThrow(/note is required/i);
    expect((await paymentRepo.findById(p.id)).status).toBe('completed');
  });

  test('rejects a payment that belongs to another member', async () => {
    const { p } = await seedCheckPayment();
    const other = insertMember(db.__getCurrentDb(), { email: 'b@b.com' });
    await expect(paymentsService.voidPayment({ paymentId: p.id, memberId: other.id, reason: 'duplicate' }))
      .rejects.toThrow(/not found/i);
    expect((await paymentRepo.findById(p.id)).status).toBe('completed');
  });

  test('rejects a Stripe payment', async () => {
    const { m, p } = await seedCheckPayment({ payment_method: 'stripe' });
    await expect(paymentsService.voidPayment({ paymentId: p.id, memberId: m.id, reason: 'refunded' }))
      .rejects.toThrow(/stripe/i);
    expect((await paymentRepo.findById(p.id)).status).toBe('completed');
  });

  test('rejects an already-voided payment', async () => {
    const { m, p } = await seedCheckPayment();
    await paymentsService.voidPayment({ paymentId: p.id, memberId: m.id, reason: 'duplicate' });
    await expect(paymentsService.voidPayment({ paymentId: p.id, memberId: m.id, reason: 'refunded' }))
      .rejects.toThrow(/already been voided/i);
    expect((await paymentRepo.findById(p.id)).void_reason).toBe('duplicate');
  });

  test('rejects a payment that never completed', async () => {
    const { m, p } = await seedCheckPayment({ status: 'pending' });
    await expect(paymentsService.voidPayment({ paymentId: p.id, memberId: m.id, reason: 'duplicate' }))
      .rejects.toThrow(/only completed/i);
  });
});
