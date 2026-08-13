/**
 * HTTP integration test for the Generate Renewal Link admin action: the real Express app,
 * real session + CSRF middleware, a real admin login and real Pug rendering. Only the
 * database is swapped for the in-memory SQLite proxy.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/email', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const { insertMember, insertAdmin } = require('../helpers/fixtures');

const TEST_OTP = '000000';

function tokenFrom(html) {
  // Admin pages carry the token in a meta tag; public/js/admin.js injects it into POST
  // forms in the browser, so the rendered form markup has no hidden input of its own.
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

/** POSTs the action for a member, fetching a fresh CSRF token from their detail page. */
async function generateLink(agent, memberId) {
  const page = await agent.get(`/admin/members/${memberId}`).expect(200);
  return agent.post(`/admin/members/${memberId}/renewal-link`)
    .type('form')
    .send({ _csrf: tokenFrom(page.text) });
}

async function memberRow(id) {
  return db.get('SELECT * FROM members WHERE id = ?', id);
}

let agent;
let member;

beforeEach(async () => {
  db.__resetTestDb();
  insertAdmin(db, { email: 'admin@ysh.test' });
  agent = await loginAsAdmin('admin@ysh.test');
  member = insertMember(db, { email: 'renewer@t.com', first_name: 'Rita', last_name: 'Renewer' });
});

describe('POST /admin/members/:id/renewal-link', () => {
  test('mints a token and redirects back to the member page', async () => {
    const res = await generateLink(agent, member.id);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/admin/members/${member.id}`);

    const row = await memberRow(member.id);
    expect(row.renewal_token).toMatch(/^[a-f0-9]{64}$/);

    // 30 days out, give or take the time the request took.
    const msOut = new Date(row.renewal_token_expires_at).getTime() - Date.now();
    expect(msOut).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(msOut).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  test('renders the link in a copyable field on the next page load', async () => {
    await generateLink(agent, member.id);
    const row = await memberRow(member.id);

    const page = await agent.get(`/admin/members/${member.id}`).expect(200);
    expect(page.text).toContain(`/renew/${row.renewal_token}`);
    expect(page.text).toContain('data-copy="#renewal-link"');
    expect(page.text).toContain('Renewal Link');
  });

  test('the link is one-shot — a later page load does not show it again', async () => {
    await generateLink(agent, member.id);
    await agent.get(`/admin/members/${member.id}`).expect(200);

    const second = await agent.get(`/admin/members/${member.id}`).expect(200);
    expect(second.text).not.toContain('data-copy="#renewal-link"');
  });

  test('reuses a still-valid token so an already-emailed link keeps working', async () => {
    await generateLink(agent, member.id);
    const first = await memberRow(member.id);

    await generateLink(agent, member.id);
    const second = await memberRow(member.id);

    expect(second.renewal_token).toBe(first.renewal_token);
    // Same token, but the clock is pushed back out.
    expect(new Date(second.renewal_token_expires_at).getTime())
      .toBeGreaterThanOrEqual(new Date(first.renewal_token_expires_at).getTime());
  });

  test('the generated link opens the public renewal form', async () => {
    await generateLink(agent, member.id);
    const row = await memberRow(member.id);

    // A fresh agent — the member is not logged in as an admin.
    await request(app).get(`/renew/${row.renewal_token}`).expect(200);
  });

  test('an unknown member redirects to the members list', async () => {
    const page = await agent.get(`/admin/members/${member.id}`).expect(200);
    const res = await agent.post('/admin/members/999999/renewal-link')
      .type('form')
      .send({ _csrf: tokenFrom(page.text) });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/members');
  });

  test('rejects a request with no admin session', async () => {
    // A real CSRF token from the (unauthenticated) login page, so the request gets past the
    // token check and is turned away by requireAdmin rather than by CSRF.
    const anon = request.agent(app);
    const loginPage = await anon.get('/admin/login').expect(200);

    const res = await anon.post(`/admin/members/${member.id}/renewal-link`)
      .type('form')
      .send({ _csrf: tokenFrom(loginPage.text) });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);

    const row = await memberRow(member.id);
    expect(row.renewal_token).toBeFalsy();
  });
});
