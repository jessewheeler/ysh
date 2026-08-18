/**
 * HTTP integration test for the payments list and the dashboard's Recent Payments panel:
 * the real Express app, a real admin login and real Pug rendering, with only the database
 * swapped for the in-memory SQLite proxy.
 *
 * These pages had no rendered-HTML coverage at all, which is how the member column stayed
 * unlinked. The point of these tests is to pin the href.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/email', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const { insertMember, insertAdmin, insertPayment, insertPeriod } = require('../helpers/fixtures');

const TEST_OTP = '000000';

function tokenFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
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

let testDb;
let agent;

beforeEach(async () => {
  db.__resetTestDb();
  testDb = db.__getCurrentDb();
  insertAdmin(testDb, { email: 'admin@ysh.test', first_name: 'Ada', last_name: 'Admin' });
  agent = await loginAsAdmin('admin@ysh.test');
});

describe('GET /admin/payments', () => {
  test('links the member name back to the member record', async () => {
    const member = insertMember(testDb, {
      first_name: 'Adam', last_name: 'Emmert', email: 'adam@example.com',
    });
    insertPayment(testDb, { member_id: member.id, amount_cents: 1600 });

    const res = await agent.get('/admin/payments').expect(200);

    expect(res.text).toContain(`<a href="/admin/members/${member.id}">Adam Emmert</a>`);
  });

  test('formats the amount with thousands separators', async () => {
    const member = insertMember(testDb, { email: 'big@example.com' });
    insertPayment(testDb, { member_id: member.id, amount_cents: 203400 });

    const res = await agent.get('/admin/payments').expect(200);

    expect(res.text).toContain('$2,034.00');
  });

  // member_id is NOT NULL, so the only way first_name goes missing is a vanished member
  // row — which is exactly the case an id-only link would send an admin to a 404.
  test('renders N/A without a link when the joined member row is missing', async () => {
    const member = insertMember(testDb, { email: 'gone@example.com' });
    insertPayment(testDb, { member_id: member.id });
    testDb.prepare('PRAGMA foreign_keys = OFF').run();
    testDb.prepare('DELETE FROM members WHERE id = ?').run(member.id);

    const res = await agent.get('/admin/payments').expect(200);

    expect(res.text).toContain('N/A');
    expect(res.text).not.toContain('/admin/members/null');
    expect(res.text).not.toContain('/admin/members/undefined');
    expect(res.text).not.toContain(`/admin/members/${member.id}`);
  });
});

describe('GET /admin/dashboard', () => {
  test('links the member name in Recent Payments, like Recent Members above it', async () => {
    const member = insertMember(testDb, {
      first_name: 'Dustin', last_name: 'Sanders', email: 'dustin@example.com',
    });
    insertPayment(testDb, { member_id: member.id, amount_cents: 1600 });

    const res = await agent.get('/admin/dashboard').expect(200);

    expect(res.text).toContain(`<a href="/admin/members/${member.id}">Dustin Sanders</a>`);
  });

  // admin_auth.robot counts exactly 7 of these, and admin.resource waits on .stats-grid
  // as its "login finished" signal. The seventh tile is the current-period enrollment,
  // which only renders when a period covers today — hence the seeded period.
  test('keeps the seven KPI tiles inside .stats-grid', async () => {
    const today = new Date().toISOString().slice(0, 10);
    insertPeriod(testDb, { start_date: today, end_date: '2099-12-31' });

    const res = await agent.get('/admin/dashboard').expect(200);

    expect(res.text).toContain('class="stats-grid"');
    expect(res.text.match(/class="stat-card"/g) || []).toHaveLength(7);
  });

  test('omits the enrollment tile when no period covers today', async () => {
    const res = await agent.get('/admin/dashboard').expect(200);

    expect(res.text.match(/class="stat-card"/g) || []).toHaveLength(6);
  });

  test('renders revenue in the short form so it cannot outgrow its card', async () => {
    const member = insertMember(testDb, { email: 'rev@example.com' });
    insertPayment(testDb, { member_id: member.id, amount_cents: 203400, status: 'completed' });

    const res = await agent.get('/admin/dashboard').expect(200);

    expect(res.text).toContain('$2,034<');
    expect(res.text).not.toContain('$2034.00');
  });
});
