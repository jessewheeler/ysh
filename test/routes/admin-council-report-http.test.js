/**
 * HTTP integration test for the Council membership report: the real Express app, real
 * session + CSRF middleware, a real admin login, real Pug rendering and real .xlsx bytes.
 * Only the database is swapped for the in-memory SQLite proxy.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));
// The report page and download don't send mail; stub it so nothing tries to.
jest.mock('../../services/email', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const JSZip = require('jszip');
const app = require('../../server');
const db = require('../../db/database');
const biosRepo = require('../../db/repos/bios');
const membershipYearsRepo = require('../../db/repos/membershipYears');
const { insertMember, insertAdmin, insertPeriod } = require('../helpers/fixtures');

/** In test env services/auth issues a fixed OTP, so a real login is scriptable. */
const TEST_OTP = '000000';

function tokenFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error('No CSRF token in response');
  return match[1];
}

/** Logs in over HTTP the way a person would, and returns the authenticated agent. */
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
    .expect(302)
    .expect('location', '/admin/dashboard');

  return agent;
}

let period;

beforeEach(() => {
  db.__resetTestDb();
  period = insertPeriod(db, { label: '2025-26 Season', end_date: '2026-07-31' });
});

describe('GET /admin/reports/membership', () => {
  test('redirects an anonymous visitor to the login page', async () => {
    await request(app).get('/admin/reports/membership')
      .expect(302)
      .expect('location', '/admin/login');
  });

  test('redirects an anonymous download attempt too', async () => {
    await request(app).get('/admin/reports/membership/download')
      .expect(302)
      .expect('location', '/admin/login');
  });

  test('renders the preview with counts, board block and warnings for an admin', async () => {
    insertAdmin(db, { email: 'admin@ysh.test', first_name: 'Ada', last_name: 'Admin' });
    const member = insertMember(db, { email: 'member@ysh.test', first_name: 'Mel', last_name: 'Member' });
    await membershipYearsRepo.enroll(member.id, period.id, null);
    await biosRepo.create({ name: 'Pat Pres', role: 'President', email: 'president@ysh.test', is_visible: true, sort_order: 1 });
    await biosRepo.create({ name: 'Huey Hype', role: 'Chief Hype Officer', email: 'hype@ysh.test', is_visible: true, sort_order: 2 });

    const agent = await loginAsAdmin('admin@ysh.test');
    const res = await agent.get(`/admin/reports/membership?period=${period.id}`).expect(200);

    expect(res.text).toContain('Total member count');
    expect(res.text).toContain('Pat Pres');
    expect(res.text).toContain('president@ysh.test');
    expect(res.text).toContain('Download .xlsx (1 member)');
    // Defaults are prefilled, and the filename is editable.
    expect(res.text).toContain('value="Yellowstone Sea Hawkers"');
    expect(res.text).toContain('value="July 2026"');
    expect(res.text).toContain('value="Yellowstone-Sea-Hawkers-Membership-Report-2026-07.xlsx"');
    expect(res.text).toContain('value="Ada Admin"');
    // The bio's own role is what appears, not one of the Council's pre-printed titles.
    expect(res.text).toContain('Chief Hype Officer');
    expect(res.text).toContain('Board members listed');
  });
});

describe('GET /admin/reports/membership/download', () => {
  test('serves a real workbook with the enrolled roster and the Council formatting intact', async () => {
    insertAdmin(db, { email: 'admin@ysh.test', first_name: 'Ada', last_name: 'Admin' });
    const alice = insertMember(db, {
      email: 'alice@ysh.test', first_name: 'Alice', last_name: 'Smith',
      phone: '4065551234', address_state: 'Montana',
    });
    await membershipYearsRepo.enroll(alice.id, period.id, null);
    await biosRepo.create({ name: 'Pat Pres', role: 'President', email: 'president@ysh.test', is_visible: true, sort_order: 1 });

    const agent = await loginAsAdmin('admin@ysh.test');
    const res = await agent
      .get(`/admin/reports/membership/download?period=${period.id}&month_year=July+2026&submitted_by=Ada+Admin`)
      .expect(200)
      .expect('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .buffer()
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.headers['content-disposition'])
      .toBe('attachment; filename="Yellowstone-Sea-Hawkers-Membership-Report-2026-07.xlsx"');

    const zip = await JSZip.loadAsync(res.body);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    expect(xml).toContain('<c r="C4" s="2"><v>1</v></c>');
    expect(xml).toContain('July 2026');
    expect(xml).toContain('Ada Admin');
    expect(xml).toContain('president@ysh.test');
    expect(xml).toContain('Alice');
    // The board Position column carries the bio's role.
    expect(xml).toContain('<c r="G6" s="32" t="inlineStr"><is><t xml:space="preserve">President</t></is></c>');
    // And the Council's other five pre-printed titles are cleared, since no bio fills them.
    expect(xml).toContain('<c r="G7" s="32"/>');
    expect(xml).toContain('(406) 555-1234');
    // Montana, not Missouri.
    expect(xml).toContain('<c r="F19" s="2" t="inlineStr"><is><t xml:space="preserve">MT</t></is></c>');
    // The Council's own formatting survives the round trip.
    expect(xml).toContain('<mergeCells count="13">');
    expect(Object.keys(zip.files)).toContain('xl/styles.xml');
    expect(Object.keys(zip.files)).toContain('xl/printerSettings/printerSettings1.bin');
  });

  test('sanitizes a filename supplied through the form', async () => {
    insertAdmin(db, { email: 'admin@ysh.test', first_name: 'Ada', last_name: 'Admin' });
    const agent = await loginAsAdmin('admin@ysh.test');

    const res = await agent
      .get(`/admin/reports/membership/download?period=${period.id}&filename=${encodeURIComponent('../../etc/passwd')}`)
      .expect(200);

    expect(res.headers['content-disposition']).toBe('attachment; filename="passwd.xlsx"');
  });
});
