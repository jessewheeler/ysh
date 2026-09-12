/**
 * HTTP integration tests for voiding a mistaken offline payment (issue #108): the real
 * Express app, session + CSRF, a real admin login. Only the database and outbound services
 * are swapped out.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/email', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue({}),
  sendWelcomeEmail: jest.fn().mockResolvedValue({}),
  sendPaymentConfirmation: jest.fn().mockResolvedValue({}),
  sendCardEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../services/sender', () => ({
  syncMemberSafe: jest.fn().mockResolvedValue(undefined),
  syncMembersSafe: jest.fn().mockResolvedValue(undefined),
  syncEmailSafe: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const paymentRepo = require('../../db/repos/payments');
const membershipYearsRepo = require('../../db/repos/membershipYears');
const { insertMember, insertAdmin, insertPayment, insertPeriod, enrollMember } = require('../helpers/fixtures');

const TEST_OTP = '000000';

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

/**
 * Posts the per-row void form the way the member page does and returns the response.
 * The CSRF token comes from the members list so an unknown member id can be posted too.
 */
async function voidPayment(agent, memberId, paymentId, fields) {
  const page = await agent.get('/admin/members').expect(200);
  return agent.post(`/admin/members/${memberId}/payments/${paymentId}/void`)
    .type('form')
    .send({ _csrf: tokenFrom(page.text), void_reason: 'duplicate', void_note: '', ...fields });
}

beforeEach(() => {
  db.__resetTestDb();
  jest.clearAllMocks();
});

describe('POST /admin/members/:memberId/payments/:id/void', () => {
  describe('as a super admin', () => {
    let agent;
    beforeEach(async () => {
      insertAdmin(db, { email: 'super@ysh.test', role: 'super_admin' });
      agent = await loginAsAdmin('super@ysh.test');
    });

    test('voids a check payment and shows the reason on the member page', async () => {
      const m = insertMember(db, { email: 'solo@ysh.test' });
      const p = insertPayment(db, { member_id: m.id, amount_cents: 2600, payment_method: 'check' });

      expect((await voidPayment(agent, m.id, p.id, { void_reason: 'duplicate' })).status).toBe(302);

      const row = await paymentRepo.findById(p.id);
      expect(row.status).toBe('voided');
      expect(row.void_reason).toBe('duplicate');
      expect(await paymentRepo.sumCompletedCents()).toBe(0);

      const page = await agent.get(`/admin/members/${m.id}`).expect(200);
      expect(page.text).toMatch(/Payment of \$26\.00 voided \(duplicate\)/);
      expect(page.text).toMatch(/badge badge-voided/);
      // The control is gone from the row it just voided.
      expect(page.text).not.toMatch(new RegExp(`/payments/${p.id}/void`));
    });

    test('keeps the enrollment that cites the payment', async () => {
      const period = insertPeriod(db, { start_date: '2020-01-01', end_date: '2020-12-31' });
      const m = insertMember(db, { email: 'solo@ysh.test' });
      const p = insertPayment(db, { member_id: m.id, payment_method: 'cash' });
      enrollMember(db, m.id, period.id, p.id);

      expect((await voidPayment(agent, m.id, p.id)).status).toBe(302);

      const enrollments = await membershipYearsRepo.findByMember(m.id);
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0].payment_id).toBe(p.id);
      expect(enrollments[0].payment_status).toBe('voided');
    });

    test('refuses Other without a note and reopens that row\'s disclosure', async () => {
      const m = insertMember(db, { email: 'solo@ysh.test' });
      const p = insertPayment(db, { member_id: m.id, payment_method: 'check' });

      expect((await voidPayment(agent, m.id, p.id, { void_reason: 'other', void_note: '  ' })).status).toBe(302);

      expect((await paymentRepo.findById(p.id)).status).toBe('completed');
      const page = await agent.get(`/admin/members/${m.id}`).expect(200);
      expect(page.text).toMatch(/note is required/i);
      expect(page.text).toMatch(new RegExp(`<dialog[^>]*id="void-payment-${p.id}"[^>]*data-dialog-open-on-load="true"`));
    });

    test('refuses a Stripe payment and renders no Void control for it', async () => {
      const m = insertMember(db, { email: 'solo@ysh.test' });
      const p = insertPayment(db, { member_id: m.id, payment_method: 'stripe' });

      const page = await agent.get(`/admin/members/${m.id}`).expect(200);
      expect(page.text).not.toMatch(/\/void"/);

      expect((await voidPayment(agent, m.id, p.id, { void_reason: 'refunded' })).status).toBe(302);
      expect((await paymentRepo.findById(p.id)).status).toBe('completed');
      const after = await agent.get(`/admin/members/${m.id}`).expect(200);
      expect(after.text).toMatch(/Stripe payments cannot be voided/);
    });

    test('refuses a payment that belongs to a different member', async () => {
      const a = insertMember(db, { email: 'a@ysh.test' });
      const b = insertMember(db, { email: 'b@ysh.test' });
      const p = insertPayment(db, { member_id: a.id, payment_method: 'check' });

      expect((await voidPayment(agent, b.id, p.id)).status).toBe(302);

      expect((await paymentRepo.findById(p.id)).status).toBe('completed');
    });

    test('redirects to the list for an unknown member', async () => {
      const res = await voidPayment(agent, 999, 1);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/admin/members');
    });
  });

  describe('as an editor', () => {
    test('sees no Void control and cannot void', async () => {
      insertAdmin(db, { email: 'editor@ysh.test', role: 'editor' });
      const agent = await loginAsAdmin('editor@ysh.test');
      const m = insertMember(db, { email: 'solo@ysh.test' });
      const p = insertPayment(db, { member_id: m.id, payment_method: 'check' });

      const page = await agent.get(`/admin/members/${m.id}`).expect(200);
      expect(page.text).not.toMatch(/\/void"/);
      expect(page.text).not.toMatch(/<th>Actions<\/th>/);
      expect(page.text).not.toMatch(/data-dialog-open=/);

      const res = await voidPayment(agent, m.id, p.id);
      expect([302, 403]).toContain(res.status);
      expect((await paymentRepo.findById(p.id)).status).toBe('completed');
    });
  });
});
