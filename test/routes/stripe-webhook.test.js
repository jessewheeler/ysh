jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { insertMember, insertPeriod } = require('../helpers/fixtures');

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
