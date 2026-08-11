/**
 * End-to-end attribution over HTTP: a visitor arrives on a UTM-tagged link, the session picks
 * up the campaign, and their contact submission / membership signup carries it. Real Express,
 * real session + CSRF, real middleware; only the database and outbound email are stubbed.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));

const mockSendContactEmail = jest.fn().mockResolvedValue({});
jest.mock('../../services/email', () => ({
  sendContactEmail: (...args) => mockSendContactEmail(...args),
  sendOtpEmail: jest.fn().mockResolvedValue({}),
  sendRenewalReminderEmail: jest.fn().mockResolvedValue({}),
}));

const mockCreateCheckoutSession = jest.fn();
jest.mock('../../services/stripe', () => ({
  createCheckoutSession: (...args) => mockCreateCheckoutSession(...args),
}));

const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const contactSubmissionsRepo = require('../../db/repos/contactSubmissions');
const campaignVisitsRepo = require('../../db/repos/campaignVisits');
const {insertCampaign, insertPeriod} = require('../helpers/fixtures');

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function tokenFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error('No CSRF token in response');
  return match[1];
}

/** A visitor whose requests carry a browser User-Agent, so the bot filter leaves them alone. */
function visitor() {
  const agent = request.agent(app);
  agent.__get = (path) => agent.get(path).set('User-Agent', BROWSER_UA);
  return agent;
}

async function submitContactForm(agent, fields) {
  const home = await agent.__get('/').expect(200);
  return await agent.post('/contact')
    .set('User-Agent', BROWSER_UA)
    .type('form')
    .send({_csrf: tokenFrom(home.text), ...fields});
}

let campaign;

beforeEach(() => {
  db.__resetTestDb();
  mockSendContactEmail.mockClear().mockResolvedValue({});
  mockCreateCheckoutSession.mockReset()
    .mockResolvedValue({url: 'https://checkout.stripe.com/session', id: 'cs_test_1'});
  campaign = insertCampaign(db, {name: 'Watch Party Flyer', utm_campaign: 'flyer26'});
});

describe('campaign visit tracking over HTTP', () => {
  test('records a visit when a tagged link is opened', async () => {
    const agent = visitor();
    await agent.__get('/membership?utm_source=print&utm_medium=flyer&utm_campaign=flyer26').expect(200);

    const visits = await campaignVisitsRepo.listRecent(campaign.id);
    expect(visits).toHaveLength(1);
    expect(visits[0].landing_path).toBe('/membership');
    expect(visits[0].utm_source).toBe('print');
    expect(visits[0].utm_medium).toBe('flyer');
  });

  test('counts one visit per visitor no matter how often they reload', async () => {
    const agent = visitor();
    for (let i = 0; i < 3; i++) {
      await agent.__get('/membership?utm_campaign=flyer26').expect(200);
    }
    expect(await campaignVisitsRepo.countFor(campaign.id)).toBe(1);
  });

  test('counts separate visitors separately', async () => {
    await visitor().__get('/membership?utm_campaign=flyer26').expect(200);
    await visitor().__get('/membership?utm_campaign=flyer26').expect(200);
    expect(await campaignVisitsRepo.countFor(campaign.id)).toBe(2);
  });

  test('ignores a crawler', async () => {
    await request(app).get('/membership?utm_campaign=flyer26')
      .set('User-Agent', 'facebookexternalhit/1.1')
      .expect(200);
    expect(await campaignVisitsRepo.countFor(campaign.id)).toBe(0);
  });

  test('serves the page normally for an unknown campaign code', async () => {
    await visitor().__get('/membership?utm_campaign=not-a-campaign').expect(200);
    expect(await db.all('SELECT * FROM campaign_visits')).toHaveLength(0);
  });

  test('tracks a landing on the homepage too', async () => {
    await visitor().__get('/?utm_campaign=flyer26').expect(200);
    const visits = await campaignVisitsRepo.listRecent(campaign.id);
    expect(visits).toHaveLength(1);
    expect(visits[0].landing_path).toBe('/');
  });
});

describe('POST /contact attribution', () => {
  test('attributes a submission to the campaign the visitor arrived through', async () => {
    const agent = visitor();
    await agent.__get('/membership?utm_campaign=flyer26').expect(200);

    const res = await submitContactForm(agent, {
      name: 'Sam Fan',
      email: 'sam@example.com',
      message: 'When is the next watch party?',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/contact/success');

    const rows = await contactSubmissionsRepo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Sam Fan');
    expect(rows[0].campaign_id).toBe(campaign.id);
    expect(rows[0].email_status).toBe('sent');
    expect(mockSendContactEmail).toHaveBeenCalledTimes(1);
  });

  test('stores an unattributed submission when there was no campaign', async () => {
    const agent = visitor();
    const res = await submitContactForm(agent, {name: 'Sam', email: 'sam@example.com', message: 'hi'});
    expect(res.status).toBe(302);

    const rows = await contactSubmissionsRepo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].campaign_id).toBeNull();
  });

  test('still stores the submission when the notification email fails', async () => {
    mockSendContactEmail.mockRejectedValue(new Error('mailer down'));
    const agent = visitor();
    await agent.__get('/membership?utm_campaign=flyer26').expect(200);

    const res = await submitContactForm(agent, {name: 'Sam', email: 'sam@example.com', message: 'hi'});
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/contact/success');

    const rows = await contactSubmissionsRepo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].email_status).toBe('failed');
    expect(rows[0].campaign_id).toBe(campaign.id);
  });

  test('stores nothing when the form is incomplete', async () => {
    const agent = visitor();
    const res = await submitContactForm(agent, {name: 'Sam', email: '', message: 'hi'});
    expect(res.status).toBe(302);
    expect(await contactSubmissionsRepo.list()).toHaveLength(0);
  });
});

describe('POST /membership attribution', () => {
  beforeEach(() => {
    insertPeriod(db, {
      label: 'Test Season',
      start_date: '2000-01-01',
      end_date: '2099-12-31',
      individual_dues_cents: 1600,
      family_dues_cents: 2600,
    });
  });

  async function signUp(agent, fields) {
    const page = await agent.__get('/membership').expect(200);
    return await agent.post('/membership')
      .set('User-Agent', BROWSER_UA)
      .type('form')
      .send({_csrf: tokenFrom(page.text), ...fields});
  }

  test('stamps the campaign on the new member', async () => {
    const agent = visitor();
    await agent.__get('/membership?utm_source=print&utm_medium=flyer&utm_campaign=flyer26').expect(200);

    const res = await signUp(agent, {
      membership_type: 'individual',
      first_name: 'New',
      last_name: 'Member',
      email: 'new@example.com',
    });
    expect(res.status).toBe(303);

    const member = await db.get('SELECT * FROM members WHERE email = ?', 'new@example.com');
    expect(member).toBeTruthy();
    expect(member.campaign_id).toBe(campaign.id);
  });

  test('leaves campaign_id null for an untracked signup', async () => {
    const agent = visitor();
    const res = await signUp(agent, {
      membership_type: 'individual',
      first_name: 'Walk',
      last_name: 'In',
      email: 'walkin@example.com',
    });
    expect(res.status).toBe(303);

    const member = await db.get('SELECT * FROM members WHERE email = ?', 'walkin@example.com');
    expect(member.campaign_id).toBeNull();
  });

  test('attributes only the primary member of a family signup', async () => {
    const agent = visitor();
    await agent.__get('/membership?utm_campaign=flyer26').expect(200);

    const res = await signUp(agent, {
      membership_type: 'family',
      first_name: 'Head',
      last_name: 'OfFamily',
      email: 'family@example.com',
      'family_members[0][first_name]': 'Kid',
      'family_members[0][last_name]': 'One',
    });
    expect(res.status).toBe(303);

    const primary = await db.get('SELECT * FROM members WHERE email = ?', 'family@example.com');
    expect(primary.campaign_id).toBe(campaign.id);

    const subMembers = await db.all('SELECT * FROM members WHERE primary_member_id = ?', primary.id);
    expect(subMembers).toHaveLength(1);
    expect(subMembers[0].campaign_id).toBeNull();
  });

  test('keeps first-touch attribution when the visitor arrives twice from different campaigns', async () => {
    const second = insertCampaign(db, {name: 'Facebook Post', utm_campaign: 'fb26'});
    const agent = visitor();

    await agent.__get('/membership?utm_campaign=flyer26').expect(200);
    await agent.__get('/membership?utm_campaign=fb26').expect(200);

    const res = await signUp(agent, {
      membership_type: 'individual',
      first_name: 'First',
      last_name: 'Touch',
      email: 'first@example.com',
    });
    expect(res.status).toBe(303);

    const member = await db.get('SELECT * FROM members WHERE email = ?', 'first@example.com');
    expect(member.campaign_id).toBe(campaign.id);

    // Both campaigns still get credit for the visit itself.
    expect(await campaignVisitsRepo.countFor(campaign.id)).toBe(1);
    expect(await campaignVisitsRepo.countFor(second.id)).toBe(1);
  });
});
