jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const migrate = require('../../db/migrate');
const {insertCampaign, insertCampaignVisit} = require('../helpers/fixtures');

/** 'YYYY-MM-DD HH:MM:SS', the shape datetime('now') writes. */
function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
}

beforeEach(() => {
  db.__resetTestDb();
});

describe('db/migrate campaign visit retention', () => {
  it('deletes visits older than two years and keeps newer ones', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    insertCampaignVisit(db, {campaign_id: campaign.id, landing_path: '/ancient', created_at: daysAgo(3 * 365)});
    insertCampaignVisit(db, {campaign_id: campaign.id, landing_path: '/old', created_at: daysAgo(731)});
    insertCampaignVisit(db, {campaign_id: campaign.id, landing_path: '/recent', created_at: daysAgo(729)});
    insertCampaignVisit(db, {campaign_id: campaign.id, landing_path: '/today', created_at: daysAgo(0)});

    await migrate();

    const remaining = await db.all('SELECT landing_path FROM campaign_visits ORDER BY landing_path');
    expect(remaining.map(r => r.landing_path)).toEqual(['/recent', '/today']);
  });

  it('leaves an empty table alone', async () => {
    await migrate();
    expect(await db.all('SELECT * FROM campaign_visits')).toHaveLength(0);
  });

  it('does not touch contact submissions or attributed members', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'flyer26'});
    await db.run(
      `INSERT INTO contact_submissions (name, email, message, campaign_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      'Old Contact', 'old@example.com', 'from years ago', campaign.id, daysAgo(3 * 365)
    );

    await migrate();

    // Only visits are pruned — the conversions they produced are the historical record.
    expect(await db.all('SELECT * FROM contact_submissions')).toHaveLength(1);
    expect(await db.all('SELECT * FROM campaigns')).toHaveLength(1);
  });
});
