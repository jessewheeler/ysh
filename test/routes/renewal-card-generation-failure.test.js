// Regression: renewal delivers last year's membership card.
//
// Reported symptom: after renewing, the member's new membership_year is set
// correctly, but they receive LAST YEAR's card. Root cause (Defect A): the
// Stripe webhook wraps card generation in a try/catch that logs and swallows
// any error (routes/stripe.js). When generation throws, no current-year card
// row is written, yet the webhook still fires sendCardEmail — which then
// attaches the stale prior-year card.
//
// These tests exercise the webhook with card generation FORCED TO THROW and
// assert the fix target:
//   1. the failure is swallowed today (webhook still 200s) — documents the trap
//   2. no current-year membership_cards row is created (the observed symptom)
//   3. after the fix, no card email should be sent when the current-year card
//      was not produced (so a stale card can never be delivered as current)

jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { insertMember, insertPeriod, insertCard } = require('../helpers/fixtures');

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

// Card generation FAILS — mimics a real production failure (missing template
// file, storage upload error, canvas/font error, etc.).
jest.mock('../../services/card', () => ({
  generatePDF: jest.fn().mockRejectedValue(new Error('template not found')),
  generatePNG: jest.fn().mockRejectedValue(new Error('template not found')),
}));

jest.mock('../../services/email', () => ({
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  sendPaymentConfirmation: jest.fn().mockResolvedValue(undefined),
  sendCardEmail: jest.fn().mockResolvedValue(undefined),
}));

const stripeService = require('../../services/stripe');
const emailService = require('../../services/email');

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

describe('renewal when card generation fails', () => {
  async function renew() {
    const testDb = getTestDb();
    // Renewing member who already holds LAST season's card (2025).
    const member = insertMember(testDb, {
      email: 'renewer@test.com',
      status: 'pending',
      membership_year: 2025,
    });
    insertCard(testDb, {
      member_id: member.id,
      pdf_path: 'https://b2.example.com/cards/card-1-2025.pdf',
      png_path: 'https://b2.example.com/cards/card-1-2025.png',
      year: 2025,
    });
    // New season period (start year 2026).
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

    const res = mockRes();
    await mockHandlers['POST /webhook'](mockReq(), res);
    return { member, res, testDb };
  }

  test('the year advances but no current-year (2026) card row is created', async () => {
    const { member, res, testDb } = await renew();

    // Webhook still succeeds — the generation error was swallowed.
    expect(res.json).toHaveBeenCalledWith({ received: true });
    // Year advanced as reported.
    const updated = testDb.prepare('SELECT membership_year FROM members WHERE id = ?').get(member.id);
    expect(updated.membership_year).toBe(2026);

    // The observed symptom: no 2026 card exists — only last year's remains.
    const card2026 = testDb.prepare(
      'SELECT * FROM membership_cards WHERE member_id = ? AND year = 2026'
    ).get(member.id);
    expect(card2026).toBeUndefined();
  });

  test('no card email is sent when the current-year card was not generated', async () => {
    // Fix target: the webhook must not deliver a card email (which would attach
    // the stale 2025 card) when the 2026 card failed to generate.
    await renew();
    expect(emailService.sendCardEmail).not.toHaveBeenCalled();
  });
});
