const mockSessionCreate = jest.fn();
const mockConstructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn(() => ({
    checkout: {
      sessions: { create: mockSessionCreate },
    },
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  }));
});

jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { createCheckoutSession, constructWebhookEvent } = require('../../services/stripe');
const { insertMember } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
  jest.clearAllMocks();
});

describe('createCheckoutSession', () => {
  const baseParams = {
    memberId: null,
    email: 'test@example.com',
    amountCents: 2500,
    baseUrl: 'http://localhost:3000',
  };

  beforeEach(() => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'test@example.com' });
    baseParams.memberId = m.id;
    mockSessionCreate.mockResolvedValue({ id: 'cs_test_123' });
  });

  test('calls stripe with correct line_items and amount', async () => {
    await createCheckoutSession(baseParams);
    const callArgs = mockSessionCreate.mock.calls[0][0];
    expect(callArgs.line_items[0].price_data.unit_amount).toBe(2500);
    expect(callArgs.line_items[0].price_data.currency).toBe('usd');
    expect(callArgs.line_items[0].price_data.product_data.name).toBe('Yellowstone Sea Hawkers Membership Dues');
  });

  test('sets correct metadata with member_id', async () => {
    await createCheckoutSession(baseParams);
    const callArgs = mockSessionCreate.mock.calls[0][0];
    expect(callArgs.metadata.member_id).toBe(String(baseParams.memberId));
  });

  test('sets correct success and cancel URLs', async () => {
    await createCheckoutSession(baseParams);
    const callArgs = mockSessionCreate.mock.calls[0][0];
    expect(callArgs.success_url).toContain('http://localhost:3000/membership/success');
    expect(callArgs.cancel_url).toBe('http://localhost:3000/membership/cancel');
  });

  test('inserts pending payment row in DB', async () => {
    await createCheckoutSession(baseParams);
    const payment = db.prepare('SELECT * FROM payments WHERE member_id = ?').get(baseParams.memberId);
    expect(payment).toBeDefined();
    expect(payment.stripe_session_id).toBe('cs_test_123');
    expect(payment.amount_cents).toBe(2500);
    expect(payment.status).toBe('pending');
  });

  test('returns the session object', async () => {
    const session = await createCheckoutSession(baseParams);
    expect(session).toEqual({ id: 'cs_test_123' });
  });

  test('uses payment mode', async () => {
    await createCheckoutSession(baseParams);
    const callArgs = mockSessionCreate.mock.calls[0][0];
    expect(callArgs.mode).toBe('payment');
  });

  test('sets customer_email', async () => {
    await createCheckoutSession(baseParams);
    const callArgs = mockSessionCreate.mock.calls[0][0];
    expect(callArgs.customer_email).toBe('test@example.com');
  });

  test('sets payment_method_types to card', async () => {
    await createCheckoutSession(baseParams);
    const callArgs = mockSessionCreate.mock.calls[0][0];
    expect(callArgs.payment_method_types).toEqual(['card']);
  });
});

describe('constructWebhookEvent', () => {
  test('calls Stripe SDK verification and returns event', () => {
    const fakeEvent = { type: 'checkout.session.completed', data: {} };
    mockConstructEvent.mockReturnValue(fakeEvent);

    const result = constructWebhookEvent(Buffer.from('body'), 'sig_test');
    expect(mockConstructEvent).toHaveBeenCalledWith(
      Buffer.from('body'),
      'sig_test',
      process.env.STRIPE_WEBHOOK_SECRET
    );
    expect(result).toEqual(fakeEvent);
  });

  test('throws on bad signature', () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });
    expect(() => constructWebhookEvent(Buffer.from('body'), 'bad_sig')).toThrow('Invalid signature');
  });
});
