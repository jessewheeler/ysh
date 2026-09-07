/**
 * HTTP integration test for recording an offline payment: the real Express app, real
 * session + CSRF middleware, a real admin login. Only the database, card generation and
 * the outbound services are swapped out.
 *
 * The route had no Jest coverage at all, which is how it shipped skipping the family
 * cascade and the membership year for any member who was already active.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/email', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue({}),
  sendWelcomeEmail: jest.fn().mockResolvedValue({}),
  sendPaymentConfirmation: jest.fn().mockResolvedValue({}),
  sendCardEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../services/card', () => ({
  generatePDF: jest.fn().mockResolvedValue('/cards/test.pdf'),
  generatePNG: jest.fn().mockResolvedValue('/cards/test.png'),
}));
jest.mock('../../services/sender', () => ({
  syncMemberSafe: jest.fn().mockResolvedValue(undefined),
  syncMembersSafe: jest.fn().mockResolvedValue(undefined),
  syncEmailSafe: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const memberRepo = require('../../db/repos/members');
const paymentRepo = require('../../db/repos/payments');
const membershipYearsRepo = require('../../db/repos/membershipYears');
const emailService = require('../../services/email');
const { insertMember, insertAdmin, insertPeriod, insertFamilyMembership } = require('../helpers/fixtures');

const TEST_OTP = '000000';

// Anchored on today so the suite doesn't rot the moment a fixed window closes:
// getCurrent() only resolves a period that spans the current date.
const THIS_YEAR = new Date().getFullYear();
const PERIOD = { start_date: `${THIS_YEAR}-01-01`, end_date: `${THIS_YEAR + 1}-12-31` };

/**
 * The login pages carry a hidden _csrf input; the admin layout carries a csrf-token meta
 * that public/js/admin.js stamps into forms in the browser. Read either.
 */
function tokenFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/)
    || html.match(/name="csrf-token" content="([^"]+)"/);
  if (!match) throw new Error('No CSRF token in response');
  return match[1];
}

async function loginAsAdmin(email) {
  const agent = request.agent(app);
  const loginPage = await agent.get('/admin/login').expect(200);
  await agent.post('/admin/login')
    .type('form')
    .send({ _csrf: tokenFrom(loginPage.text), email })
    .expect(302);
  const verifyPage = await agent.get('/admin/login/verify').expect(200);
  await agent.post('/admin/login/verify')
    .type('form')
    .send({ _csrf: tokenFrom(verifyPage.text), code: TEST_OTP })
    .expect(302);
  return agent;
}

/** Posts the offline-payment form the way the member page does. */
async function recordPayment(agent, memberId, fields) {
  const page = await agent.get(`/admin/members/${memberId}`).expect(200);
  return agent.post(`/admin/members/${memberId}/payments`)
    .type('form')
    .send({ _csrf: tokenFrom(page.text), amount: '26.00', payment_method: 'check', ...fields })
    .expect(302);
}

let agent;

beforeEach(async () => {
  db.__resetTestDb();
  jest.clearAllMocks();
  insertAdmin(db, { email: 'admin@ysh.test' });
  agent = await loginAsAdmin('admin@ysh.test');
});

describe('POST /admin/members/:id/payments', () => {
  test('activating an already-active family primary re-stamps the whole family', async () => {
    const period = insertPeriod(db, PERIOD);
    const { primary, familyMembers } = insertFamilyMembership(db, {
      primaryMember: {
        email: 'household@ysh.test',
        status: 'active',
        membership_year: 2024,
        expiry_date: '2025-07-31',
      },
    });

    await recordPayment(agent, primary.id, { activate_member: 'on' });

    for (const id of [primary.id, ...familyMembers.map(fm => fm.id)]) {
      const row = await memberRepo.findById(id);
      expect(row.status).toBe('active');
      expect(row.membership_year).toBe(THIS_YEAR);
      expect(row.expiry_date).toBe(PERIOD.end_date);
      expect(await membershipYearsRepo.isEnrolled(id, period.id)).toBe(true);
    }
  });

  test('links the enrollment to the payment just recorded', async () => {
    const period = insertPeriod(db, PERIOD);
    const m = insertMember(db, { email: 'solo@ysh.test', status: 'expired' });

    await recordPayment(agent, m.id, { activate_member: 'on', amount: '16.00' });

    const payments = await paymentRepo.findByMemberId(m.id);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount_cents).toBe(1600);
    expect(payments[0].payment_method).toBe('check');

    const enrollments = await membershipYearsRepo.findByMember(m.id);
    expect(enrollments[0].membership_period_id).toBe(period.id);
    expect(enrollments[0].payment_id).toBe(payments[0].id);
  });

  test('sends the welcome and receipt on activation', async () => {
    insertPeriod(db, PERIOD);
    const m = insertMember(db, { email: 'solo@ysh.test', status: 'expired' });

    await recordPayment(agent, m.id, { activate_member: 'on' });

    expect(emailService.sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendPaymentConfirmation).toHaveBeenCalledTimes(1);
    expect(emailService.sendPaymentConfirmation.mock.calls[0][1].amount_total).toBe(2600);
  });

  test('without the activate box, records the payment and changes nothing else', async () => {
    const period = insertPeriod(db, PERIOD);
    const m = insertMember(db, {
      email: 'solo@ysh.test', status: 'expired', membership_year: 2019, expiry_date: '2020-07-31',
    });

    await recordPayment(agent, m.id, {});

    const row = await memberRepo.findById(m.id);
    expect(row.status).toBe('expired');
    expect(row.membership_year).toBe(2019);
    expect(row.expiry_date).toBe('2020-07-31');
    expect(await membershipYearsRepo.isEnrolled(m.id, period.id)).toBe(false);
    expect(await paymentRepo.findByMemberId(m.id)).toHaveLength(1);
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  test('refuses the activation, and says so, when no period is open', async () => {
    const m = insertMember(db, {
      email: 'solo@ysh.test', status: 'expired', membership_year: 2019, expiry_date: '2020-07-31',
    });

    await recordPayment(agent, m.id, { activate_member: 'on' });

    const page = await agent.get(`/admin/members/${m.id}`).expect(200);
    expect(page.text).toMatch(/no membership period is currently open/i);

    // The payment stands, but nothing about the membership moved — an active member with
    // no expiry or enrollment would be worse than an unactivated one.
    expect(await paymentRepo.findByMemberId(m.id)).toHaveLength(1);
    const row = await memberRepo.findById(m.id);
    expect(row.status).toBe('expired');
    expect(row.membership_year).toBe(2019);
    expect(await membershipYearsRepo.findByMember(m.id)).toHaveLength(0);
    // And no welcome carrying last season's card.
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  test('a family member with no email of their own rides on the primary welcome', async () => {
    insertPeriod(db, PERIOD);
    // Built by hand: insertFamilyMembership substitutes a generated address for a blank
    // one, and a blank address is exactly what this covers.
    const primary = insertMember(db, {
      email: 'household@ysh.test', status: 'expired', membership_type: 'family',
    });
    insertMember(db, {
      first_name: 'Kid', last_name: 'Doe', email: '',
      membership_type: 'family', primary_member_id: primary.id, status: 'expired',
    });

    await recordPayment(agent, primary.id, { activate_member: 'on' });

    expect(emailService.sendWelcomeEmail.mock.calls[0][1]).toHaveLength(2);
    expect(emailService.sendCardEmail).not.toHaveBeenCalled();
  });

  test('rejects an invalid amount without recording anything', async () => {
    insertPeriod(db, PERIOD);
    const m = insertMember(db, { email: 'solo@ysh.test', status: 'expired' });

    await recordPayment(agent, m.id, { amount: '0', activate_member: 'on' });

    expect(await paymentRepo.findByMemberId(m.id)).toHaveLength(0);
    expect((await memberRepo.findById(m.id)).status).toBe('expired');
  });

  test('a payment recorded against a sub-member still activates the whole family', async () => {
    const period = insertPeriod(db, PERIOD);
    const { primary, familyMembers } = insertFamilyMembership(db, {
      primaryMember: { email: 'household@ysh.test', status: 'expired' },
    });

    await recordPayment(agent, familyMembers[0].id, { activate_member: 'on' });

    for (const id of [primary.id, ...familyMembers.map(fm => fm.id)]) {
      const row = await memberRepo.findById(id);
      expect(row.status).toBe('active');
      expect(await membershipYearsRepo.isEnrolled(id, period.id)).toBe(true);
    }
  });
});
