jest.mock('../../../db/database', () => require('../../helpers/setupDb'));

const db = require('../../../db/database');
const campaignsRepo = require('../../../db/repos/campaigns');
const campaignVisitsRepo = require('../../../db/repos/campaignVisits');
const contactSubmissionsRepo = require('../../../db/repos/contactSubmissions');
const {insertMember, insertCampaign, insertContactSubmission, insertFamilyMembership} = require('../../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('db/repos/campaigns', () => {
  it('creates a campaign and writes an audit entry', async () => {
    const created = await campaignsRepo.create({
      name: 'Watch Party Flyer',
      utm_campaign: 'flyer26',
      utm_source: 'print',
      utm_medium: 'flyer',
    });

    expect(created.id).toBeDefined();
    expect(created.utm_campaign).toBe('flyer26');
    expect(created.is_active).toBe(1);
    expect(created.target_path).toBe('/membership');

    const audit = await db.all("SELECT * FROM audit_log WHERE table_name = 'campaigns'");
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('INSERT');
  });

  it('updates a campaign and audits the change', async () => {
    const created = await campaignsRepo.create({name: 'A', utm_campaign: 'a26'});
    const updated = await campaignsRepo.update(created.id, {
      name: 'B',
      utm_campaign: 'b26',
      utm_source: 'facebook',
      target_path: '/',
    });

    expect(updated.name).toBe('B');
    expect(updated.utm_campaign).toBe('b26');
    expect(updated.target_path).toBe('/');

    const audit = await db.all("SELECT * FROM audit_log WHERE table_name = 'campaigns' AND action = 'UPDATE'");
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].old_values).name).toBe('A');
    expect(JSON.parse(audit[0].new_values).name).toBe('B');
  });

  // Constraint assertions run through the synchronous better-sqlite3 handle rather than the
  // async repo. The suite has pre-existing async leakage (hence --forceExit in npm test): a
  // stray continuation from another test file can call __resetTestDb between two awaits, which
  // wiped the first row and made an awaited version of this test flake. A single synchronous
  // block has no await points for anything to interleave into.
  it('rejects a duplicate campaign code', () => {
    insertCampaign(db, {utm_campaign: 'dupe', name: 'A'});
    expect(() => insertCampaign(db, {utm_campaign: 'dupe', name: 'B'}))
      .toThrow(/UNIQUE constraint failed/);
  });

  describe('findByUtmCampaign', () => {
    it('finds an active campaign', async () => {
      insertCampaign(db, {utm_campaign: 'flyer26'});
      const found = await campaignsRepo.findByUtmCampaign('flyer26');
      expect(found).toBeTruthy();
      expect(found.utm_campaign).toBe('flyer26');
    });

    it('ignores an inactive campaign', async () => {
      insertCampaign(db, {utm_campaign: 'retired', is_active: 0});
      expect(await campaignsRepo.findByUtmCampaign('retired')).toBeUndefined();
    });

    it('returns nothing for an unknown code', async () => {
      expect(await campaignsRepo.findByUtmCampaign('nope')).toBeUndefined();
    });
  });

  it('setActive flips the flag and audits it', async () => {
    const created = await campaignsRepo.create({name: 'A', utm_campaign: 'a26'});
    const off = await campaignsRepo.setActive(created.id, false);
    expect(off.is_active).toBe(0);
    expect(await campaignsRepo.findByUtmCampaign('a26')).toBeUndefined();

    const on = await campaignsRepo.setActive(created.id, true);
    expect(on.is_active).toBe(1);
    expect(await campaignsRepo.findByUtmCampaign('a26')).toBeTruthy();
  });

  describe('listWithStats', () => {
    it('counts visits, signups and contacts per campaign', async () => {
      const a = insertCampaign(db, {utm_campaign: 'a26', name: 'A'});
      const b = insertCampaign(db, {utm_campaign: 'b26', name: 'B'});

      await campaignVisitsRepo.record({campaignId: a.id, landingPath: '/membership'});
      await campaignVisitsRepo.record({campaignId: a.id, landingPath: '/'});
      insertMember(db, {email: 'one@example.com'});
      await db.run('UPDATE members SET campaign_id = ? WHERE email = ?', a.id, 'one@example.com');
      await contactSubmissionsRepo.create({
        name: 'C', email: 'c@example.com', message: 'hi', campaign_id: a.id,
      });

      const stats = await campaignsRepo.listWithStats();
      const statsA = stats.find(c => c.id === a.id);
      const statsB = stats.find(c => c.id === b.id);

      expect(statsA.visit_count).toBe(2);
      expect(statsA.signup_count).toBe(1);
      expect(statsA.contact_count).toBe(1);
      expect(statsB.visit_count).toBe(0);
      expect(statsB.signup_count).toBe(0);
      expect(statsB.contact_count).toBe(0);
    });

    it('counts a family signup once, not once per family member', async () => {
      const campaign = insertCampaign(db, {utm_campaign: 'fam26'});
      const {primary} = insertFamilyMembership(db, {
        primaryMember: {email: 'primary@example.com'},
        familyMembers: [
          {first_name: 'Kid', last_name: 'One', email: 'kid1@example.com'},
          {first_name: 'Kid', last_name: 'Two', email: 'kid2@example.com'},
        ],
      });
      // Attribution lands on the primary; sub-members would be double counting.
      await db.run('UPDATE members SET campaign_id = ? WHERE id = ?', campaign.id, primary.id);

      const stats = await campaignsRepo.listWithStats();
      expect(stats.find(c => c.id === campaign.id).signup_count).toBe(1);
    });
  });

  describe('statsFor and listSignups', () => {
    it('returns the same counts for a single campaign', async () => {
      const campaign = insertCampaign(db, {utm_campaign: 'a26'});
      await campaignVisitsRepo.record({campaignId: campaign.id});
      insertMember(db, {email: 'signup@example.com', first_name: 'Signed', last_name: 'Up'});
      await db.run('UPDATE members SET campaign_id = ? WHERE email = ?', campaign.id, 'signup@example.com');

      const stats = await campaignsRepo.statsFor(campaign.id);
      expect(stats.visit_count).toBe(1);
      expect(stats.signup_count).toBe(1);
      expect(stats.contact_count).toBe(0);

      const signups = await campaignsRepo.listSignups(campaign.id);
      expect(signups).toHaveLength(1);
      expect(signups[0].email).toBe('signup@example.com');
    });

    it('returns zeroes for a campaign with no activity', async () => {
      const campaign = insertCampaign(db, {utm_campaign: 'quiet'});
      expect(await campaignsRepo.statsFor(campaign.id)).toEqual({
        visit_count: 0, signup_count: 0, contact_count: 0,
      });
    });
  });
});

describe('db/repos/campaignVisits', () => {
  it('records a visit without writing an audit entry', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'a26'});
    await campaignVisitsRepo.record({
      campaignId: campaign.id,
      landingPath: '/membership',
      referrer: 'https://facebook.com/somepage',
      utmSource: 'facebook',
      utmMedium: 'post',
    });

    const visits = await campaignVisitsRepo.listRecent(campaign.id);
    expect(visits).toHaveLength(1);
    expect(visits[0].landing_path).toBe('/membership');
    expect(visits[0].utm_source).toBe('facebook');

    // Visits are high-volume system writes — no audit spam.
    const audit = await db.all("SELECT * FROM audit_log WHERE table_name = 'campaign_visits'");
    expect(audit).toHaveLength(0);
  });

  it('caps listRecent at the requested limit', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'a26'});
    for (let i = 0; i < 5; i++) {
      await campaignVisitsRepo.record({campaignId: campaign.id, landingPath: `/p${i}`});
    }
    expect(await campaignVisitsRepo.listRecent(campaign.id, 3)).toHaveLength(3);
    expect(await campaignVisitsRepo.countFor(campaign.id)).toBe(5);
  });

  it('cascades away when its campaign is deleted', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'a26'});
    await campaignVisitsRepo.record({campaignId: campaign.id});
    await db.run('DELETE FROM campaigns WHERE id = ?', campaign.id);
    expect(await campaignVisitsRepo.countFor(campaign.id)).toBe(0);
  });
});

describe('db/repos/contactSubmissions', () => {
  it('stores a submission with campaign attribution and audits it', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'a26'});
    const row = await contactSubmissionsRepo.create({
      name: 'Sam Fan',
      email: 'sam@example.com',
      message: 'When is the next watch party?',
      campaign_id: campaign.id,
    });

    expect(row.id).toBeDefined();
    expect(row.campaign_id).toBe(campaign.id);
    expect(row.email_status).toBe('sent');

    const audit = await db.all("SELECT * FROM audit_log WHERE table_name = 'contact_submissions'");
    expect(audit).toHaveLength(1);
  });

  it('stores an unattributed submission', async () => {
    const row = await contactSubmissionsRepo.create({
      name: 'Sam', email: 'sam@example.com', message: 'hi',
    });
    expect(row.campaign_id).toBeNull();
  });

  it('records a failed email send', async () => {
    const row = await contactSubmissionsRepo.create({
      name: 'Sam', email: 'sam@example.com', message: 'hi', email_status: 'failed',
    });
    expect(row.email_status).toBe('failed');
  });

  it('rejects an email_status outside the allowed set', () => {
    // Synchronous for the same reason as the duplicate-code test above.
    expect(() => insertContactSubmission(db, {email_status: 'bogus'}))
      .toThrow(/CHECK constraint failed/);
  });

  it('lists submissions newest first with the campaign joined in', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'a26', name: 'Flyer'});
    await contactSubmissionsRepo.create({name: 'First', email: 'a@example.com', message: 'one'});
    await contactSubmissionsRepo.create({
      name: 'Second', email: 'b@example.com', message: 'two', campaign_id: campaign.id,
    });

    const rows = await contactSubmissionsRepo.list();
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('Second');
    expect(rows[0].campaign_name).toBe('Flyer');
    expect(rows[1].campaign_name).toBeNull();
    expect(await contactSubmissionsRepo.count()).toBe(2);
  });

  it('keeps the submission when its campaign is deleted', async () => {
    const campaign = insertCampaign(db, {utm_campaign: 'a26'});
    await contactSubmissionsRepo.create({
      name: 'Sam', email: 'sam@example.com', message: 'hi', campaign_id: campaign.id,
    });
    await db.run('DELETE FROM campaigns WHERE id = ?', campaign.id);

    const rows = await contactSubmissionsRepo.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].campaign_id).toBeNull();
  });
});
