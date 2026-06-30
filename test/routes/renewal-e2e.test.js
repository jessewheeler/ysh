jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { insertMember, insertPeriod, insertSetting } = require('../helpers/fixtures');

// Capture route handlers registered on the router (both routes/index and routes/stripe).
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

jest.mock('../../middleware/captcha', () => ({
  requireCaptcha: () => (_req, _res, next) => next(),
}));

jest.mock('../../services/stripe', () => ({
  createCheckoutSession: jest.fn().mockResolvedValue({ url: 'https://stripe.test/checkout', id: 'cs_test_e2e' }),
  constructWebhookEvent: jest.fn(),
}));

jest.mock('../../services/card', () => ({
  generatePDF: jest.fn().mockResolvedValue(undefined),
  generatePNG: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/email', () => ({
  sendRenewalReminderEmail: jest.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  sendPaymentConfirmation: jest.fn().mockResolvedValue(undefined),
  sendCardEmail: jest.fn().mockResolvedValue(undefined),
}));

const stripeService = require('../../services/stripe');
const emailService = require('../../services/email');
const renewalService = require('../../services/renewal');
const membersRepo = require('../../db/repos/members');

function mockReq(overrides = {}) {
  return {
    headers: { 'stripe-signature': 'sig' },
    body: {},
    params: {},
    session: {},
    get: () => 'localhost',
    ...overrides,
  };
}

function mockRes() {
  const res = {
    _redirectStatus: null,
    _redirectUrl: null,
    redirect(statusOrUrl, url) {
      if (url !== undefined) { res._redirectStatus = statusOrUrl; res._redirectUrl = url; }
      else { res._redirectUrl = statusOrUrl; }
    },
    render: jest.fn(),
    json: jest.fn(),
  };
  return res;
}

function getTestDb() {
  return db.__getCurrentDb();
}

// The single "current" season covering today (2026-06-30 per the test clock / real now).
const SEASON = { label: '2026-27 Season', start_date: '2026-04-01', end_date: '2027-07-31' };

beforeEach(() => {
  db.__resetTestDb();
  Object.keys(mockHandlers).forEach(k => delete mockHandlers[k]);
  jest.clearAllMocks();
  // Both routers register their handlers on the shared fake router.
  jest.isolateModules(() => {
    require('../../routes/index');
    require('../../routes/stripe');
  });
});

// Simulate Stripe calling the webhook back after a checkout completes.
async function fireCheckoutCompleted({ memberId, periodId, amountTotal }) {
  stripeService.constructWebhookEvent.mockReturnValue({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_e2e',
        payment_intent: 'pi_test_e2e',
        amount_total: amountTotal,
        metadata: { member_id: String(memberId), period_id: String(periodId) },
      },
    },
  });
  const res = mockRes();
  await mockHandlers['POST /webhook'](mockReq(), res);
  return res;
}

describe('Renewal — reminder dispatch', () => {
  test('generates a token and emails a renewal link to members whose membership lapses soon', async () => {
    const testDb = getTestDb();
    const period = insertPeriod(testDb, SEASON);
    const member = insertMember(testDb, {
      email: 'lapsing@test.com',
      status: 'active',
      membership_year: 2025,
    });
    // Last season's expiry, just inside the 30-day reminder window.
    testDb.prepare('UPDATE members SET expiry_date = ? WHERE id = ?').run('2026-07-15', member.id);

    const result = await renewalService.sendBulkRenewalReminders('https://ysh.test');

    expect(result).toEqual({ sent: 1, failed: 0, total: 1 });
    expect(emailService.sendRenewalReminderEmail).toHaveBeenCalledTimes(1);

    const [emailedMember, link] = emailService.sendRenewalReminderEmail.mock.calls[0];
    expect(emailedMember.id).toBe(member.id);

    // Link carries a token that was persisted and resolves back to this member.
    const tokenMatch = link.match(/\/renew\/([a-f0-9]+)$/);
    expect(tokenMatch).not.toBeNull();
    const resolved = await membersRepo.findByRenewalToken(tokenMatch[1]);
    expect(resolved.id).toBe(member.id);

    // Sanity: the period exists and the member is not yet enrolled in it.
    expect(period.id).toBeDefined();
  });

  test('does not remind members already enrolled in the current period', async () => {
    const testDb = getTestDb();
    const period = insertPeriod(testDb, SEASON);
    const member = insertMember(testDb, { email: 'current@test.com', status: 'active' });
    testDb.prepare('UPDATE members SET expiry_date = ? WHERE id = ?').run('2026-07-15', member.id);
    testDb.prepare(
      'INSERT INTO membership_years (member_id, membership_period_id) VALUES (?, ?)'
    ).run(member.id, period.id);

    const result = await renewalService.sendBulkRenewalReminders('https://ysh.test');

    expect(result.total).toBe(0);
    expect(emailService.sendRenewalReminderEmail).not.toHaveBeenCalled();
  });
});

describe('GET /renew/:token', () => {
  async function seedRenewable(testDb, overrides = {}) {
    insertPeriod(testDb, SEASON);
    const member = insertMember(testDb, { email: 'gettest@test.com', status: 'active', ...overrides });
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await membersRepo.setRenewalToken(member.id, 'gettoken', expiresAt);
    return member;
  }

  test('renders the renewal form with member and current-period dues for a valid token', async () => {
    const testDb = getTestDb();
    const member = await seedRenewable(testDb);

    const res = mockRes();
    await mockHandlers['GET /renew/:token'](mockReq({ params: { token: 'gettoken' } }), res);

    expect(res.render).toHaveBeenCalledTimes(1);
    const [view, locals] = res.render.mock.calls[0];
    expect(view).toBe('renew');
    expect(locals.member.id).toBe(member.id);
    expect(locals.individualDues).toBe(1600);
    expect(locals.familyDues).toBe(2600);
    expect(locals.token).toBe('gettoken');
  });

  test('redirects to /membership with a flash error for an invalid token', async () => {
    const res = mockRes();
    const req = mockReq({ params: { token: 'nope' } });
    await mockHandlers['GET /renew/:token'](req, res);

    expect(res.render).not.toHaveBeenCalled();
    expect(res._redirectUrl).toBe('/membership');
    expect(req.session.flash_error).toMatch(/invalid or has expired/i);
  });
});

describe('POST /renew/:token', () => {
  async function seedRenewable(testDb, overrides = {}) {
    const period = insertPeriod(testDb, SEASON);
    const member = insertMember(testDb, { email: 'posttest@test.com', status: 'active', membership_year: 2025, ...overrides });
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await membersRepo.setRenewalToken(member.id, 'posttoken', expiresAt);
    return { member, period };
  }

  test('updates contact fields and redirects (303) to a Stripe checkout session', async () => {
    const testDb = getTestDb();
    const { member, period } = await seedRenewable(testDb);

    const res = mockRes();
    await mockHandlers['POST /renew/:token'](mockReq({
      params: { token: 'posttoken' },
      body: { first_name: 'Renewed', last_name: 'Member', phone: '555-9999' },
    }), res);

    // Contact edits persisted.
    const updated = testDb.prepare('SELECT first_name, phone, email FROM members WHERE id = ?').get(member.id);
    expect(updated.first_name).toBe('Renewed');
    expect(updated.phone).toBe('555-9999');
    expect(updated.email).toBe('posttest@test.com'); // email is identity, not editable

    // Checkout session created with current-period dues + period id.
    expect(stripeService.createCheckoutSession).toHaveBeenCalledTimes(1);
    const args = stripeService.createCheckoutSession.mock.calls[0][0];
    expect(args.memberId).toBe(member.id);
    expect(args.amountCents).toBe(1600);
    expect(args.membershipType).toBe('individual');
    expect(args.periodId).toBe(period.id);

    expect(res._redirectStatus).toBe(303);
    expect(res._redirectUrl).toBe('https://stripe.test/checkout');
  });

  test('redirects to /membership for an invalid token without creating a session', async () => {
    const res = mockRes();
    const req = mockReq({ params: { token: 'bad' }, body: {} });
    await mockHandlers['POST /renew/:token'](req, res);

    expect(stripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(res._redirectUrl).toBe('/membership');
  });

  test('redirects back to the form when no current period is open', async () => {
    const testDb = getTestDb();
    // No period inserted → getCurrent() returns nothing.
    const member = insertMember(testDb, { email: 'noperiod@test.com', status: 'active' });
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await membersRepo.setRenewalToken(member.id, 'noperiodtoken', expiresAt);

    const res = mockRes();
    const req = mockReq({ params: { token: 'noperiodtoken' }, body: {} });
    await mockHandlers['POST /renew/:token'](req, res);

    expect(stripeService.createCheckoutSession).not.toHaveBeenCalled();
    expect(res._redirectUrl).toBe('/renew/noperiodtoken');
    expect(req.session.flash_error).toMatch(/not currently open/i);
  });

  test('family renewal adds, updates, and removes family members before checkout', async () => {
    const testDb = getTestDb();
    insertSetting(testDb, 'max_family_members', '6');
    const period = insertPeriod(testDb, SEASON);
    const primary = insertMember(testDb, {
      email: 'fam@test.com', status: 'active', membership_type: 'family', membership_year: 2025,
    });
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await membersRepo.setRenewalToken(primary.id, 'famtoken', expiresAt);

    // Existing family: one to keep/update, one to remove.
    const keep = insertMember(testDb, {
      first_name: 'Keep', last_name: 'Doe', email: 'keep@test.com',
      membership_type: 'family', primary_member_id: primary.id, status: 'active',
    });
    const remove = insertMember(testDb, {
      first_name: 'Remove', last_name: 'Doe', email: 'remove@test.com',
      membership_type: 'family', primary_member_id: primary.id, status: 'active',
    });

    const res = mockRes();
    await mockHandlers['POST /renew/:token'](mockReq({
      params: { token: 'famtoken' },
      body: {
        first_name: 'Fam', last_name: 'Primary',
        family_members: [
          { id: String(keep.id), first_name: 'Keepy', last_name: 'Doe', email: 'keepy@test.com' },
          { first_name: 'NewKid', last_name: 'Doe', email: '' },
        ],
      },
    }), res);

    const family = await membersRepo.findFamilyMembers(primary.id);
    const names = family.map(f => f.first_name).sort();
    expect(names).toEqual(['Keepy', 'NewKid']);
    expect(family.find(f => f.id === remove.id)).toBeUndefined();
    // New member with blank email inherits the primary's email.
    expect(family.find(f => f.first_name === 'NewKid').email).toBe('fam@test.com');

    // Checkout uses family dues and includes the surviving family member ids.
    const args = stripeService.createCheckoutSession.mock.calls[0][0];
    expect(args.amountCents).toBe(2600);
    expect(args.membershipType).toBe('family');
    expect(args.familyMemberIds.sort()).toEqual(family.map(f => f.id).sort());
    expect(args.periodId).toBe(period.id);
  });
});

describe('Renewal — full lifecycle (reminder → renew → webhook)', () => {
  test('a lapsing member ends up renewed into the new season with a cleared token', async () => {
    const testDb = getTestDb();
    const period = insertPeriod(testDb, SEASON);
    const member = insertMember(testDb, {
      email: 'lifecycle@test.com', status: 'active', membership_year: 2025,
    });
    testDb.prepare('UPDATE members SET expiry_date = ? WHERE id = ?').run('2026-07-15', member.id);

    // 1. Reminder dispatch issues a token + link.
    await renewalService.sendBulkRenewalReminders('https://ysh.test');
    const link = emailService.sendRenewalReminderEmail.mock.calls[0][1];
    const token = link.match(/\/renew\/([a-f0-9]+)$/)[1];

    // 2. Member opens the renewal form.
    const getRes = mockRes();
    await mockHandlers['GET /renew/:token'](mockReq({ params: { token } }), getRes);
    expect(getRes.render).toHaveBeenCalledTimes(1);

    // 3. Member submits the form → Stripe checkout session.
    const postRes = mockRes();
    await mockHandlers['POST /renew/:token'](mockReq({
      params: { token },
      body: { first_name: 'Life', last_name: 'Cycle' },
    }), postRes);
    expect(postRes._redirectStatus).toBe(303);
    const checkoutArgs = stripeService.createCheckoutSession.mock.calls[0][0];

    // 4. Stripe confirms payment via webhook.
    const hookRes = await fireCheckoutCompleted({
      memberId: member.id,
      periodId: checkoutArgs.periodId,
      amountTotal: checkoutArgs.amountCents,
    });
    expect(hookRes.json).toHaveBeenCalledWith({ received: true });

    // Outcome: renewed into the new season, enrolled, token cleared.
    const renewed = testDb.prepare(
      'SELECT membership_year, expiry_date, renewal_token, status FROM members WHERE id = ?'
    ).get(member.id);
    expect(renewed.membership_year).toBe(2026);
    expect(renewed.expiry_date).toBe('2027-07-31');
    expect(renewed.renewal_token).toBeNull();

    const enrollment = testDb.prepare(
      'SELECT 1 FROM membership_years WHERE member_id = ? AND membership_period_id = ?'
    ).get(member.id, period.id);
    expect(enrollment).toBeDefined();

    // Confirmation emails reflect the renewed year (the bug this suite guards against).
    expect(emailService.sendWelcomeEmail.mock.calls[0][0].membership_year).toBe(2026);
    expect(emailService.sendCardEmail.mock.calls[0][0].membership_year).toBe(2026);

    // The renewal token is no longer usable.
    expect(await membersRepo.findByRenewalToken(token)).toBeUndefined();
  });
});
