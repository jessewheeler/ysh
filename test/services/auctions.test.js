jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const auctions = require('../../services/auctions');
const { insertAuction } = require('../helpers/fixtures');

beforeEach(() => db.__resetTestDb());

describe('phase', () => {
  const a = { status: 'published', starts_at: '2026-11-01T18:00:00.000Z', ends_at: '2026-11-02T03:00:00.000Z' };
  test.each([
    ['2026-11-01T17:59:59.999Z', 'upcoming'],
    ['2026-11-01T18:00:00.000Z', 'live'],
    ['2026-11-02T02:59:59.999Z', 'live'],
    ['2026-11-02T03:00:00.000Z', 'closed'],
  ])('at %s it is %s', (now, expected) => {
    expect(auctions.phase(a, new Date(now))).toBe(expected);
  });

  test('a draft is a draft whatever the time', () => {
    expect(auctions.phase({ ...a, status: 'draft' }, new Date('2026-11-01T20:00:00Z'))).toBe('draft');
  });
});

describe('parseAuctionForm', () => {
  const body = {
    title: ' Holiday Auction ', starts_at: '2026-12-01T18:00', ends_at: '2026-12-05T20:00',
    min_increment: '10', shipping_notice: 'Bidder pays shipping.', status: 'published',
  };

  test('converts Montana times to UTC and dollars to cents', () => {
    const { errors, fields } = auctions.parseAuctionForm(body);
    expect(errors).toEqual([]);
    expect(fields).toMatchObject({
      title: 'Holiday Auction',
      starts_at: '2026-12-02T01:00:00.000Z',
      ends_at: '2026-12-06T03:00:00.000Z',
      min_increment_cents: 1000,
      shipping_notice: 'Bidder pays shipping.',
      status: 'published',
    });
  });

  test('a blank shipping notice falls back to the default', () => {
    const { fields } = auctions.parseAuctionForm({ ...body, shipping_notice: '  ' });
    expect(fields.shipping_notice).toBe(auctions.DEFAULT_SHIPPING_NOTICE);
    expect(auctions.DEFAULT_SHIPPING_NOTICE).toMatch(/shipping and handling/i);
  });

  test('requires the end after the start', () => {
    const { errors } = auctions.parseAuctionForm({ ...body, ends_at: '2026-12-01T18:00' });
    expect(errors).toContain('The auction must end after it starts.');
  });

  test('requires a title and both times, and a whole-dollar increment', () => {
    const { errors } = auctions.parseAuctionForm({ min_increment: '2.50' });
    expect(errors).toEqual(expect.arrayContaining([
      'Title is required.', 'Start time is required.', 'End time is required.',
      'Minimum increment must be a whole number of dollars, at least $1.',
    ]));
  });

  test('anything but "published" is a draft', () => {
    expect(auctions.parseAuctionForm({ ...body, status: 'live' }).fields.status).toBe('draft');
  });
});

describe('parseItemForm', () => {
  test('starting bid is whole dollars', () => {
    expect(auctions.parseItemForm({ title: 'Helmet', starting_bid: '150' }).fields.starting_bid_cents).toBe(15000);
    expect(auctions.parseItemForm({ title: 'Helmet', starting_bid: '0' }).errors).toHaveLength(1);
    expect(auctions.parseItemForm({ title: '', starting_bid: '5' }).errors).toEqual(['Item title is required.']);
  });
});

describe('publicItemState', () => {
  test('carries the paddle number but never the bidder id', () => {
    const state = auctions.publicItemState(
      { id: 3, current_bid_cents: 2500, starting_bid_cents: 2000, bid_count: 2, high_bidder_id: 9, high_paddle: 4, withdrawn: 0 },
      500
    );
    expect(state).toEqual({
      item_id: 3, current_bid_cents: 2500, starting_bid_cents: 2000, min_next_cents: 3000,
      bid_count: 2, high_paddle: 4, withdrawn: false,
    });
  });
});

describe('getNavAuction', () => {
  test('returns the published auction that has not ended, with its phase', async () => {
    const t = db.__getCurrentDb();
    insertAuction(t, { title: 'Ended', ends_at: new Date(Date.now() - 1000).toISOString(), starts_at: new Date(Date.now() - 5000).toISOString() });
    insertAuction(t, { title: 'Draft', status: 'draft' });
    insertAuction(t, { title: 'Live' });
    const nav = await auctions.getNavAuction();
    expect(nav).toMatchObject({ title: 'Live', phase: 'live' });
  });

  test('null when nothing is published', async () => {
    expect(await auctions.getNavAuction()).toBeNull();
  });
});
