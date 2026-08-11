/**
 * HTTP integration test for the campaigns admin: the real Express app, real session + CSRF
 * middleware, a real admin login, real Pug rendering and real QR bytes. Only the database is
 * swapped for the in-memory SQLite proxy.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/email', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const campaignsRepo = require('../../db/repos/campaigns');
const campaignVisitsRepo = require('../../db/repos/campaignVisits');
const {insertAdmin, insertCampaign, insertMember, insertContactSubmission} = require('../helpers/fixtures');

const TEST_OTP = '000000';

/**
 * Admin pages carry the CSRF token in a meta tag rather than a hidden input — public/js/admin.js
 * injects it into forms in the browser — so accept either shape.
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
    .send({_csrf: tokenFrom(loginPage.text), email})
    .expect(302);
  const verifyPage = await agent.get('/admin/login/verify').expect(200);
  await agent.post('/admin/login/verify')
    .type('form')
    .send({_csrf: tokenFrom(verifyPage.text), code: TEST_OTP})
    .expect(302)
    .expect('location', '/admin/dashboard');
  return agent;
}

let agent;

// Login costs two bcrypt rounds, so do it once. requireAdmin only inspects the session, which
// outlives the per-test database reset below.
beforeAll(async () => {
  db.__resetTestDb();
  insertAdmin(db, {email: 'admin@example.com', role: 'super_admin'});
  agent = await loginAsAdmin('admin@example.com');
});

beforeEach(() => {
  db.__resetTestDb();
  insertAdmin(db, {email: 'admin@example.com', role: 'super_admin'});
});

describe('campaign admin authentication', () => {
  test.each([
    '/admin/campaigns',
    '/admin/campaigns/new',
    '/admin/campaigns.csv',
    '/admin/contact-submissions',
  ])('redirects an anonymous visitor away from %s', async (path) => {
    await request(app).get(path).expect(302).expect('location', '/admin/login');
  });
});

describe('GET /admin/campaigns', () => {
  test('shows an empty state before any campaigns exist', async () => {
    const res = await agent.get('/admin/campaigns').expect(200);
    expect(res.text).toContain('No campaigns yet');
  });

  test('lists campaigns with their attribution counts', async () => {
    const campaign = insertCampaign(db, {name: 'Watch Party Flyer', utm_campaign: 'flyer26'});
    await campaignVisitsRepo.record({campaignId: campaign.id, landingPath: '/membership'});
    await campaignVisitsRepo.record({campaignId: campaign.id, landingPath: '/'});
    insertMember(db, {email: 'joined@example.com'});
    await db.run('UPDATE members SET campaign_id = ? WHERE email = ?', campaign.id, 'joined@example.com');

    const res = await agent.get('/admin/campaigns').expect(200);
    expect(res.text).toContain('Watch Party Flyer');
    expect(res.text).toContain('flyer26');
    // 2 visits, 1 signup → 50%
    expect(res.text).toContain('50%');
  });
});

describe('POST /admin/campaigns', () => {
  async function submit(fields) {
    const page = await agent.get('/admin/campaigns/new').expect(200);
    return await agent.post('/admin/campaigns')
      .type('form')
      .send({_csrf: tokenFrom(page.text), ...fields});
  }

  test('creates a campaign and redirects to its detail page', async () => {
    const res = await submit({
      name: 'Watch Party Flyer',
      utm_campaign: 'FLYER26',
      utm_source: 'print',
      utm_medium: 'flyer',
      target_path: '/membership',
    });
    expect(res.status).toBe(302);

    const created = await campaignsRepo.findByUtmCampaign('flyer26');
    expect(created).toBeTruthy();
    expect(created.name).toBe('Watch Party Flyer');
    expect(res.headers.location).toBe(`/admin/campaigns/${created.id}`);
  });

  test('bounces an invalid campaign code back to the form', async () => {
    const res = await submit({name: 'Bad', utm_campaign: 'has space'});
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/campaigns/new');
    expect(await campaignsRepo.list()).toHaveLength(0);
  });

  test('explains a duplicate campaign code instead of leaking the SQL error', async () => {
    insertCampaign(db, {utm_campaign: 'taken'});
    const res = await submit({name: 'Second', utm_campaign: 'taken'});
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/campaigns/new');

    // The flash is rendered on the next page load, not on the redirect itself.
    const form = await agent.get('/admin/campaigns/new').expect(200);
    expect(form.text).toContain('Another campaign already uses that campaign code');
    expect(form.text).not.toContain('UNIQUE constraint');
  });

  test('rejects a target path pointing off-site', async () => {
    const res = await submit({name: 'Evil', utm_campaign: 'evil', target_path: '//evil.example.com'});
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/campaigns/new');
    expect(await campaignsRepo.list()).toHaveLength(0);
  });
});

describe('GET /admin/campaigns/:id', () => {
  test('renders the generated link, the QR preview and the attribution tables', async () => {
    const campaign = insertCampaign(db, {
      name: 'Watch Party Flyer', utm_campaign: 'flyer26', utm_source: 'print', utm_medium: 'flyer',
    });
    insertContactSubmission(db, {
      name: 'Sam Fan', email: 'sam@example.com', message: 'When is the next one?', campaign_id: campaign.id,
    });

    const res = await agent.get(`/admin/campaigns/${campaign.id}`).expect(200);
    expect(res.text).toContain('utm_source=print');
    expect(res.text).toContain('utm_medium=flyer');
    expect(res.text).toContain('utm_campaign=flyer26');
    expect(res.text).toContain(`/admin/campaigns/${campaign.id}/qr.png`);
    expect(res.text).toContain(`/admin/campaigns/${campaign.id}/qr.svg`);
    expect(res.text).toContain('Sam Fan');
  });

  test('redirects when the campaign does not exist', async () => {
    await agent.get('/admin/campaigns/9999').expect(302).expect('location', '/admin/campaigns');
  });
});

// PNG encoding in the qrcode library runs roughly 80x slower inside Jest's sandbox than in
// plain node (a 2000px code takes ~19s here vs ~0.2s in the real server), and the cost scales
// with pixel area. These tests therefore request the smallest allowed size — size handling
// itself is covered by the clampSize unit tests in test/services/campaigns.test.js. Do not
// "fix" a slow run here by raising the timeout; lower the size instead.
describe('campaign QR endpoints', () => {
  let campaign;

  beforeEach(() => {
    campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
  });

  test('serves a PNG inline', async () => {
    const res = await agent.get(`/admin/campaigns/${campaign.id}/qr.png?size=200`)
      .expect(200)
      .expect('Content-Type', /image\/png/);
    expect(res.body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  test('serves a PNG as an attachment when asked', async () => {
    const res = await agent.get(`/admin/campaigns/${campaign.id}/qr.png?size=200&download=1`).expect(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="ysh-qr-flyer26.png"');
  });

  test('serves an SVG attachment', async () => {
    const res = await agent.get(`/admin/campaigns/${campaign.id}/qr.svg`)
      .expect(200)
      .expect('Content-Type', /image\/svg\+xml/);
    // supertest buffers image/* as binary, so the body is a Buffer rather than res.text.
    expect(res.body.toString('utf8')).toContain('<svg');
    expect(res.headers['content-disposition']).toBe('attachment; filename="ysh-qr-flyer26.svg"');
  });

  test('404s for a campaign that does not exist', async () => {
    await agent.get('/admin/campaigns/9999/qr.png').expect(404);
  });
});

describe('POST /admin/campaigns/:id/toggle', () => {
  test('deactivates and reactivates a campaign', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    const listPage = await agent.get('/admin/campaigns').expect(200);
    const csrf = tokenFrom(listPage.text);

    await agent.post(`/admin/campaigns/${campaign.id}/toggle`)
      .type('form').send({_csrf: csrf})
      .expect(302)
      .expect('location', '/admin/campaigns');
    expect((await campaignsRepo.get(campaign.id)).is_active).toBe(0);

    const again = await agent.get('/admin/campaigns').expect(200);
    await agent.post(`/admin/campaigns/${campaign.id}/toggle`)
      .type('form').send({_csrf: tokenFrom(again.text)})
      .expect(302);
    expect((await campaignsRepo.get(campaign.id)).is_active).toBe(1);
  });
});

describe('POST /admin/campaigns/:id/edit', () => {
  test('updates the campaign', async () => {
    const campaign = insertCampaign(db, {name: 'Old', utm_campaign: 'old26'});
    const page = await agent.get(`/admin/campaigns/${campaign.id}/edit`).expect(200);

    await agent.post(`/admin/campaigns/${campaign.id}/edit`)
      .type('form')
      .send({_csrf: tokenFrom(page.text), name: 'New', utm_campaign: 'new26', utm_source: 'facebook'})
      .expect(302)
      .expect('location', `/admin/campaigns/${campaign.id}`);

    const updated = await campaignsRepo.get(campaign.id);
    expect(updated.name).toBe('New');
    expect(updated.utm_campaign).toBe('new26');
    expect(updated.utm_source).toBe('facebook');
  });
});

describe('GET /admin/campaigns.csv', () => {
  test('exports campaign performance', async () => {
    const campaign = insertCampaign(db, {name: 'Watch Party Flyer', utm_campaign: 'flyer26'});
    await campaignVisitsRepo.record({campaignId: campaign.id});

    const res = await agent.get('/admin/campaigns.csv')
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="ysh-campaigns-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.text).toContain('Name,Campaign,Source');
    expect(res.text).toContain('Watch Party Flyer');
  });
});

describe('GET /admin/contact-submissions', () => {
  test('shows an empty state', async () => {
    const res = await agent.get('/admin/contact-submissions').expect(200);
    expect(res.text).toContain('No submissions yet');
  });

  test('lists submissions with their campaign and send status', async () => {
    const campaign = insertCampaign(db, {name: 'Watch Party Flyer', utm_campaign: 'flyer26'});
    insertContactSubmission(db, {name: 'Attributed', email: 'a@example.com', campaign_id: campaign.id});
    insertContactSubmission(db, {name: 'Unattributed', email: 'b@example.com', email_status: 'failed'});

    const res = await agent.get('/admin/contact-submissions').expect(200);
    expect(res.text).toContain('Attributed');
    expect(res.text).toContain('Unattributed');
    expect(res.text).toContain('Watch Party Flyer');
    expect(res.text).toContain('Send failed');
  });
});
