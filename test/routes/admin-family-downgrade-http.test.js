/**
 * HTTP integration test for the family downgrade and the archive it feeds (issue #107): the
 * real Express app, session + CSRF, a real admin login and real Pug rendering. Only the
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
const archivedMembersRepo = require('../../db/repos/archivedMembers');
const { insertMember, insertAdmin, insertFamilyMembership } = require('../helpers/fixtures');

const TEST_OTP = '000000';

function tokenFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/) || html.match(/name="csrf-token" content="([^"]+)"/);
  if (!match) throw new Error('No CSRF token in response');
  return match[1];
}

async function loginAsAdmin(email) {
  const agent = request.agent(app);
  const loginPage = await agent.get('/admin/login').expect(200);
  await agent.post('/admin/login').type('form').send({ _csrf: tokenFrom(loginPage.text), email });
  const verifyPage = await agent.get('/admin/login/verify').expect(200);
  await agent.post('/admin/login/verify').type('form').send({ _csrf: tokenFrom(verifyPage.text), code: TEST_OTP })
    .expect(302).expect('location', '/admin/dashboard');
  return agent;
}

/** POSTs a form the way the browser would (CSRF token taken from a page first) and expects a redirect. */
async function postForm(agent, fromPath, path, body = {}, location) {
  const page = await agent.get(fromPath).expect(200);
  const req = agent.post(path).type('form').send({ _csrf: tokenFrom(page.text), ...body });
  return location ? req.expect('location', location) : req;
}

function raw() {
  return db.__getCurrentDb();
}

let agent;
let primary;
let robin;
let casey;

beforeEach(async () => {
  db.__resetTestDb();
  insertAdmin(raw(), { email: 'admin@ysh.test' });
  ({ primary, familyMembers: [robin, casey] } = insertFamilyMembership(raw(), {
    primaryMember: { email: 'pat@hawk.test', first_name: 'Pat', last_name: 'Hawk', status: 'active' },
    familyMembers: [
      { first_name: 'Robin', last_name: 'Hawk', email: 'robin@hawk.test' },
      { first_name: 'Casey', last_name: 'Hawk', email: 'pat@hawk.test' },
    ],
  }));
  raw().prepare("UPDATE members SET member_number = 'YSH-2019-0042' WHERE id = ?").run(casey.id);
  agent = await loginAsAdmin('admin@ysh.test');
});

describe('member page', () => {
  test('offers Downgrade to Individual with a confirm that names who is detached and who is archived', async () => {
    const res = await agent.get(`/admin/members/${primary.id}`).expect(200);
    expect(res.text).toContain(`action="/admin/members/${primary.id}/downgrade-to-individual"`);
    expect(res.text).toMatch(/Robin Hawk \(own email\) will become individual members/);
    expect(res.text).toMatch(/Casey Hawk \(no email of their own\) will be archived/);
    expect(res.text).toMatch(/No dues are refunded/);
  });

  test('does not offer it to a sub-member or an individual', async () => {
    const sub = await agent.get(`/admin/members/${robin.id}`).expect(200);
    expect(sub.text).not.toContain('downgrade-to-individual');
    const solo = insertMember(raw(), { email: 'solo@hawk.test' });
    const ind = await agent.get(`/admin/members/${solo.id}`).expect(200);
    expect(ind.text).not.toContain('downgrade-to-individual');
  });
});

describe('POST /admin/members/:id/downgrade-to-individual', () => {
  test('downgrades, detaches Robin, archives Casey and says so', async () => {
    await postForm(agent, `/admin/members/${primary.id}`, `/admin/members/${primary.id}/downgrade-to-individual`, {}, `/admin/members/${primary.id}`);

    const page = await agent.get(`/admin/members/${primary.id}`).expect(200);
    expect(page.text).toContain('downgraded to individual');
    expect(page.text).toContain('Now individual members: Robin Hawk.');
    expect(page.text).toContain('Archived: Casey Hawk.');

    expect(raw().prepare('SELECT membership_type FROM members WHERE id = ?').get(primary.id).membership_type).toBe('individual');
    expect(raw().prepare('SELECT primary_member_id FROM members WHERE id = ?').get(robin.id).primary_member_id).toBeNull();
    expect(raw().prepare('SELECT id FROM members WHERE id = ?').get(casey.id)).toBeUndefined();
  });

  test('refuses a sub-member with a flash', async () => {
    await postForm(agent, `/admin/members/${robin.id}`, `/admin/members/${robin.id}/downgrade-to-individual`);
    const page = await agent.get(`/admin/members/${robin.id}`).expect(200);
    expect(page.text).toContain('Cannot downgrade a family sub-member');
  });
});

describe('the archive', () => {
  beforeEach(async () => {
    await postForm(agent, `/admin/members/${primary.id}`, `/admin/members/${primary.id}/downgrade-to-individual`);
  });

  test('GET /admin/members/archived lists them rather than being read as a member id', async () => {
    const res = await agent.get('/admin/members/archived').expect(200);
    expect(res.text).toContain('Archived Family Members');
    expect(res.text).toContain('Casey Hawk');
    expect(res.text).toContain('YSH-2019-0042');

    const none = await agent.get('/admin/members/archived?q=zzz').expect(200);
    expect(none.text).not.toContain('Casey Hawk');
  });

  test('search JSON matches a last-name prefix and ignores one letter', async () => {
    const res = await agent.get('/admin/members/archived/search?last_name=haw').expect(200);
    expect(res.body).toEqual([expect.objectContaining({ first_name: 'Casey', last_name: 'Hawk', member_numbers: ['YSH-2019-0042'] })]);
    const short = await agent.get('/admin/members/archived/search?last_name=h').expect(200);
    expect(short.body).toEqual([]);
  });

  test('restore creates the member and lands on their page', async () => {
    const [row] = await archivedMembersRepo.search({});
    const res = await postForm(agent, '/admin/members/archived', `/admin/members/archived/${row.id}/restore`, { email: 'casey@hawk.test' });
    const restored = raw().prepare("SELECT * FROM members WHERE email = 'casey@hawk.test'").get();
    expect(res.headers.location).toBe(`/admin/members/${restored.id}`);
    expect(restored.member_number).toBe('YSH-2019-0042');

    const page = await agent.get(res.headers.location).expect(200);
    expect(page.text).toContain('restored as YSH-2019-0042');
  });

  test('a refused restore returns to the archive with the dialog reopened', async () => {
    const [row] = await archivedMembersRepo.search({});
    await postForm(agent, '/admin/members/archived', `/admin/members/archived/${row.id}/restore`, { email: 'pat@hawk.test' }, '/admin/members/archived');
    const page = await agent.get('/admin/members/archived').expect(200);
    expect(page.text).toContain('A member with that email already exists.');
    expect(page.text).toMatch(new RegExp(`id="restore-${row.id}"[^>]*data-dialog-open-on-load`));
  });

  test('Add Family Member with archived_member_id reattaches the same person', async () => {
    const [row] = await archivedMembersRepo.search({});
    const family = insertMember(raw(), { email: 'fam@hawk.test', membership_type: 'family' });

    await postForm(agent, `/admin/members/${family.id}`, `/admin/members/${family.id}/family-members`, {
      first_name: 'Casey', last_name: 'Hawk', email: '', archived_member_id: String(row.id),
    });

    const page = await agent.get(`/admin/members/${family.id}`).expect(200);
    expect(page.text).toContain('restored from the archive (YSH-2019-0042)');
    const back = raw().prepare('SELECT * FROM members WHERE primary_member_id = ?').get(family.id);
    expect(back).toMatchObject({ first_name: 'Casey', member_number: 'YSH-2019-0042', email: 'fam@hawk.test' });
  });
});
