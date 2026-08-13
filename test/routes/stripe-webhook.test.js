jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { insertMember, insertPeriod, insertPayment } = require('../helpers/fixtures');

const mockHandlers = {};
jest.mock('express', () => {
  const realExpress = jest.requireActual('express');
  const fakeRouter = {
    get(path, ...fns) { mockHandlers['GET ' + path] = fns[fns.length - 1]; },
    post(path, ...fns) { mockHandlers['POST ' + path] = fns[fns.length - 1]; },
    use() {},
  };
  return { ...realExpress, Router: () => fakeRouter };
});

jest.mock('../../services/stripe', () => ({
  constructWebhookEvent: jest.fn(),
}));

jest.mock('../../services/card', () => ({
  generatePDF: jest.fn().mockResolvedValue(undefined),
  generatePNG: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/email', () => ({
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  sendPaymentConfirmation: jest.fn().mockResolvedValue(undefined),
  sendCardEmail: jest.fn().mockResolvedValue(undefined),
}));

const stripeService = require('../../services/stripe');
const emailService = require('../../services/email');
const cardService = require('../../services/card');

function mockReq(overrides = {}) {
  return { headers: { 'stripe-signature': 'sig' }, body: Buffer.from('{}'), ...overrides };
}

function mockRes() {
  return { json: jest.fn() };
}

function checkoutCompletedEvent(session) {
  return { type: 'checkout.session.completed', data: { object: session } };
}

beforeEach(() => {
  db.__resetTestDb();
  Object.keys(mockHandlers).forEach(k => delete mockHandlers[k]);
  jest.clearAllMocks();
  jest.isolateModules(() => { require('../../routes/stripe'); });
});

function getTestDb() {
  return db.__getCurrentDb();
}

describe('POST /webhook — checkout.session.completed', () => {
  test('emails and cards use the updated membership_year, not the stale pre-renewal value', async () => {
    const testDb = getTestDb();
    // Member renewing: still holds last season's year and is pending until payment lands.
    const member = insertMember(testDb, {
      email: 'renewer@test.com',
      status: 'pending',
      membership_year: 2025,
    });
    // New period whose start year is 2026.
    const period = insertPeriod(testDb, {
      label: '2026-27 Season',
      start_date: '2026-04-01',
      end_date: '2027-07-31',
    });

    stripeService.constructWebhookEvent.mockReturnValue(
      checkoutCompletedEvent({
        id: 'cs_test_123',
        payment_intent: 'pi_test_123',
        amount_total: 1600,
        metadata: { member_id: String(member.id), period_id: String(period.id) },
      })
    );

    const handler = mockHandlers['POST /webhook'];
    const res = mockRes();
    await handler(mockReq(), res);

    expect(res.json).toHaveBeenCalledWith({ received: true });

    // The welcome + card emails must reflect the new year, not the stale 2025.
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendWelcomeEmail.mock.calls[0][0].membership_year).toBe(2026);

    expect(emailService.sendCardEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendCardEmail.mock.calls[0][0].membership_year).toBe(2026);

    // Card generation likewise sees the updated year.
    expect(cardService.generatePDF.mock.calls[0][0].membership_year).toBe(2026);
    expect(cardService.generatePNG.mock.calls[0][0].membership_year).toBe(2026);

    // And the DB row was actually updated.
    const updated = testDb.prepare('SELECT membership_year, expiry_date FROM members WHERE id = ?').get(member.id);
    expect(updated.membership_year).toBe(2026);
    expect(updated.expiry_date).toBe('2027-07-31');
  });

  test('does nothing for non-checkout events', async () => {
    stripeService.constructWebhookEvent.mockReturnValue({
      type: 'payment_intent.created',
      data: { object: {} },
    });

    const handler = mockHandlers['POST /webhook'];
    const res = mockRes();
    await handler(mockReq(), res);

    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

/**
 * Failure events are what give the Needs attention filter its payment signals — before
 * these branches existed, payments.status = 'failed' was declared in the schema but
 * never written by any code path.
 */
describe('POST /webhook — checkout.session.expired', () => {
  async function fire(session) {
    stripeService.constructWebhookEvent.mockReturnValue({
      type: 'checkout.session.expired', data: { object: session },
    });
    const res = mockRes();
    await mockHandlers['POST /webhook'](mockReq(), res);
    return res;
  }

  test('flips the pending payment to failed', async () => {
    const testDb = getTestDb();
    const member = insertMember(testDb, { email: 'abandoned@test.com', status: 'pending' });
    insertPayment(testDb, { member_id: member.id, status: 'pending', stripe_session_id: 'cs_exp_1' });

    const res = await fire({ id: 'cs_exp_1' });

    expect(res.json).toHaveBeenCalledWith({ received: true });
    const row = testDb.prepare('SELECT status, failure_reason FROM payments WHERE stripe_session_id = ?').get('cs_exp_1');
    expect(row.status).toBe('failed');
    expect(row.failure_reason).toBe('Checkout session expired');
  });

  test('is idempotent on redelivery', async () => {
    const testDb = getTestDb();
    const member = insertMember(testDb, { email: 'abandoned@test.com', status: 'pending' });
    insertPayment(testDb, { member_id: member.id, status: 'pending', stripe_session_id: 'cs_exp_2' });

    await fire({ id: 'cs_exp_2' });
    await fire({ id: 'cs_exp_2' });

    const rows = testDb.prepare("SELECT id FROM payments WHERE stripe_session_id = ? AND status = 'failed'").all('cs_exp_2');
    expect(rows).toHaveLength(1);
  });

  test('never clobbers a payment that already completed', async () => {
    const testDb = getTestDb();
    const member = insertMember(testDb, { email: 'paid@test.com', status: 'active' });
    insertPayment(testDb, { member_id: member.id, status: 'completed', stripe_session_id: 'cs_exp_3' });

    await fire({ id: 'cs_exp_3' });

    const row = testDb.prepare('SELECT status FROM payments WHERE stripe_session_id = ?').get('cs_exp_3');
    expect(row.status).toBe('completed');
  });

  test('tolerates a session it has no payment row for', async () => {
    const res = await fire({ id: 'cs_unknown' });
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});

describe('POST /webhook — payment_intent.payment_failed', () => {
  async function fire(intent) {
    stripeService.constructWebhookEvent.mockReturnValue({
      type: 'payment_intent.payment_failed', data: { object: intent },
    });
    const res = mockRes();
    await mockHandlers['POST /webhook'](mockReq(), res);
    return res;
  }

  test('records a failed payment against the member', async () => {
    const testDb = getTestDb();
    const member = insertMember(testDb, { email: 'declined@test.com', status: 'pending' });

    const res = await fire({
      id: 'pi_fail_1',
      amount: 1600,
      metadata: { member_id: String(member.id) },
      last_payment_error: { message: 'Your card was declined.' },
    });

    expect(res.json).toHaveBeenCalledWith({ received: true });
    const row = testDb.prepare('SELECT * FROM payments WHERE stripe_payment_intent = ?').get('pi_fail_1');
    expect(row.status).toBe('failed');
    expect(row.member_id).toBe(member.id);
    expect(row.amount_cents).toBe(1600);
    expect(row.failure_reason).toBe('Your card was declined.');
  });

  test('is idempotent on redelivery', async () => {
    const testDb = getTestDb();
    const member = insertMember(testDb, { email: 'declined@test.com', status: 'pending' });
    const intent = { id: 'pi_fail_2', amount: 1600, metadata: { member_id: String(member.id) } };

    await fire(intent);
    await fire(intent);

    const rows = testDb.prepare('SELECT id FROM payments WHERE stripe_payment_intent = ?').all('pi_fail_2');
    expect(rows).toHaveLength(1);
  });

  test('falls back to a generic reason when Stripe gives none', async () => {
    const testDb = getTestDb();
    const member = insertMember(testDb, { email: 'declined@test.com', status: 'pending' });

    await fire({ id: 'pi_fail_3', amount: 1600, metadata: { member_id: String(member.id) } });

    const row = testDb.prepare('SELECT failure_reason FROM payments WHERE stripe_payment_intent = ?').get('pi_fail_3');
    expect(row.failure_reason).toBe('Payment failed');
  });

  test('no-ops without member_id metadata', async () => {
    const testDb = getTestDb();

    const res = await fire({ id: 'pi_fail_4', amount: 1600, metadata: {} });

    expect(res.json).toHaveBeenCalledWith({ received: true });
    const rows = testDb.prepare('SELECT id FROM payments').all();
    expect(rows).toHaveLength(0);
  });
});
