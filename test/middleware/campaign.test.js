jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const {captureCampaign, normalizeReferrer} = require('../../middleware/campaign');
const campaignVisitsRepo = require('../../db/repos/campaignVisits');
const {insertCampaign} = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

/** Minimal Express-request stand-in. */
function buildReq(overrides = {}) {
  const headers = overrides.headers || {};
  return {
    method: 'GET',
    path: '/membership',
    query: {},
    session: {},
    get(name) {
      return headers[name.toLowerCase()];
    },
    ...overrides,
  };
}

async function run(req) {
  const next = jest.fn();
  await captureCampaign(req, {}, next);
  expect(next).toHaveBeenCalledTimes(1);
  return req;
}

describe('middleware/campaign captureCampaign', () => {
  it('sets the session campaign and records a visit on first touch', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    const req = await run(buildReq({query: {utm_campaign: 'flyer26', utm_source: 'print'}}));

    expect(req.session.campaign_id).toBe(campaign.id);
    expect(req.session.campaign_seen).toEqual([campaign.id]);

    const visits = await campaignVisitsRepo.listRecent(campaign.id);
    expect(visits).toHaveLength(1);
    expect(visits[0].landing_path).toBe('/membership');
    expect(visits[0].utm_source).toBe('print');
  });

  it('matches the campaign code case-insensitively', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    const req = await run(buildReq({query: {utm_campaign: 'FLYER26'}}));
    expect(req.session.campaign_id).toBe(campaign.id);
  });

  it('records only one visit per session per campaign', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    const session = {};

    await run(buildReq({query: {utm_campaign: 'flyer26'}, session}));
    await run(buildReq({query: {utm_campaign: 'flyer26'}, session}));
    await run(buildReq({query: {utm_campaign: 'flyer26'}, session}));

    expect(await campaignVisitsRepo.countFor(campaign.id)).toBe(1);
  });

  it('keeps the first-touch campaign but still counts the later visit', async () => {
    const first = insertCampaign(db, {utm_campaign: 'flyer26'});
    const second = insertCampaign(db, {utm_campaign: 'fb26'});
    const session = {};

    await run(buildReq({query: {utm_campaign: 'flyer26'}, session}));
    await run(buildReq({query: {utm_campaign: 'fb26'}, session}));

    expect(session.campaign_id).toBe(first.id);
    expect(await campaignVisitsRepo.countFor(first.id)).toBe(1);
    expect(await campaignVisitsRepo.countFor(second.id)).toBe(1);
  });

  it('ignores an unknown campaign code', async () => {
    const req = await run(buildReq({query: {utm_campaign: 'does-not-exist'}}));
    expect(req.session.campaign_id).toBeUndefined();
    const visits = await db.all('SELECT * FROM campaign_visits');
    expect(visits).toHaveLength(0);
  });

  it('ignores an inactive campaign', async () => {
    insertCampaign(db, {utm_campaign: 'retired', is_active: 0});
    const req = await run(buildReq({query: {utm_campaign: 'retired'}}));
    expect(req.session.campaign_id).toBeUndefined();
    expect(await db.all('SELECT * FROM campaign_visits')).toHaveLength(0);
  });

  it('does nothing without a utm_campaign param', async () => {
    insertCampaign(db, {utm_campaign: 'flyer26'});
    const req = await run(buildReq({query: {utm_source: 'print'}}));
    expect(req.session.campaign_id).toBeUndefined();
    expect(await db.all('SELECT * FROM campaign_visits')).toHaveLength(0);
  });

  it('ignores non-GET requests', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    const req = await run(buildReq({method: 'POST', query: {utm_campaign: 'flyer26'}}));
    expect(req.session.campaign_id).toBeUndefined();
    expect(await campaignVisitsRepo.countFor(campaign.id)).toBe(0);
  });

  it.each(['/admin/dashboard', '/stripe/webhook'])('ignores %s', async (path) => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    const req = await run(buildReq({path, query: {utm_campaign: 'flyer26'}}));
    expect(req.session.campaign_id).toBeUndefined();
    expect(await campaignVisitsRepo.countFor(campaign.id)).toBe(0);
  });

  it.each([
    'facebookexternalhit/1.1',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Twitterbot/1.0',
    'curl/8.4.0',
  ])('skips bot user agent %s', async (ua) => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    const req = await run(buildReq({
      query: {utm_campaign: 'flyer26'},
      headers: {'user-agent': ua},
    }));

    expect(req.session.campaign_id).toBeUndefined();
    expect(await campaignVisitsRepo.countFor(campaign.id)).toBe(0);
  });

  it('still tracks an ordinary browser user agent', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    await run(buildReq({
      query: {utm_campaign: 'flyer26'},
      headers: {'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1.15'},
    }));
    expect(await campaignVisitsRepo.countFor(campaign.id)).toBe(1);
  });

  it('strips the query string from the stored referrer', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    await run(buildReq({
      query: {utm_campaign: 'flyer26'},
      headers: {referer: 'https://www.facebook.com/some/post?fbclid=SECRET&tracking=junk'},
    }));

    const visits = await campaignVisitsRepo.listRecent(campaign.id);
    expect(visits[0].referrer).toBe('https://www.facebook.com/some/post');
  });

  it('takes the first value when a param is repeated', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    const req = await run(buildReq({query: {utm_campaign: ['flyer26', 'other']}}));
    expect(req.session.campaign_id).toBe(campaign.id);
  });

  it('does not throw when there is no session', async () => {
    insertCampaign(db, {utm_campaign: 'flyer26'});
    const req = buildReq({query: {utm_campaign: 'flyer26'}, session: undefined});
    const next = jest.fn();
    await expect(captureCampaign(req, {}, next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('never blocks the request when tracking throws', async () => {
    insertCampaign(db, {utm_campaign: 'flyer26'});
    const spy = jest.spyOn(campaignVisitsRepo, 'record').mockRejectedValue(new Error('db down'));
    const warn = jest.fn();

    const req = buildReq({query: {utm_campaign: 'flyer26'}, logger: {warn}});
    const next = jest.fn();
    await captureCampaign(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Campaign attribution failed', {error: 'db down'});
    spy.mockRestore();
  });
});

describe('middleware/campaign normalizeReferrer', () => {
  it('keeps origin and path only', () => {
    expect(normalizeReferrer('https://example.com/a/b?c=d#e')).toBe('https://example.com/a/b');
  });

  it('returns null for a missing referrer', () => {
    expect(normalizeReferrer(undefined)).toBeNull();
    expect(normalizeReferrer('')).toBeNull();
  });

  it('degrades gracefully on an unparseable referrer', () => {
    expect(normalizeReferrer('not a url?x=1')).toBe('not a url');
  });

  it('truncates a very long referrer', () => {
    const long = `https://example.com/${'a'.repeat(500)}`;
    expect(normalizeReferrer(long).length).toBe(200);
  });
});
