jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const auctionBids = require('../../services/auctionBids');
const auctionDashboard = require('../../services/auctionDashboard');
const { runWithActor } = require('../../db/audit-context');
const { insertAuction, insertAuctionItem, insertBidder, insertAdmin } = require('../helpers/fixtures');

let auction, helmet, jersey, signed, alice, bob;

const place = (item, bidder, amount) => auctionBids.placeBid({
  auctionId: auction.id, itemId: item.id, bidderId: bidder.id, amountRaw: String(amount), shippingAck: true,
});

beforeEach(async () => {
  db.__resetTestDb();
  const t = db.__getCurrentDb();
  auction = insertAuction(t);
  helmet = insertAuctionItem(t, { auction_id: auction.id, title: 'Helmet', starting_bid_cents: 10000 });
  jersey = insertAuctionItem(t, { auction_id: auction.id, title: 'Jersey', starting_bid_cents: 5000 });
  signed = insertAuctionItem(t, { auction_id: auction.id, title: 'Signed ball', starting_bid_cents: 2000 });
  alice = insertBidder(t, { email: 'a@example.com', name: 'Alice' });
  bob = insertBidder(t, { email: 'b@example.com', name: 'Bob' });

  await place(helmet, alice, 100);
  await place(helmet, bob, 150);
  await place(jersey, alice, 60);
});

test('totals count high bids on items that are still in the auction', async () => {
  const stats = await auctionDashboard.getStats(auction.id);
  expect(stats.totals).toMatchObject({
    committedCents: 21000, bids: 3, bidders: 2, itemsWithBids: 2, items: 3, avgBidsPerItem: 1,
  });
  expect(stats.leaderboard.find(i => i.id === signed.id).current_bid_cents).toBeNull();
  expect(stats.leaderboard.find(i => i.id === helmet.id).over_starting_pct).toBe(50);
  expect(stats.topBidders.map(b => [b.name, b.cents])).toEqual([['Bob', 15000], ['Alice', 6000]]);
  expect(stats.recentBids[0]).toMatchObject({ item_title: 'Jersey', bidder_name: 'Alice', paddle_number: 1 });
});

test('removed bids and withdrawn items drop out', async () => {
  const t = db.__getCurrentDb();
  const admin = insertAdmin(t, { email: 'admin@ysh.test' });
  const bobBid = t.prepare('SELECT id FROM auction_bids WHERE bidder_id = ?').get(bob.id).id;
  await runWithActor({ id: admin.id, email: admin.email }, () => auctionBids.removeBid({ bidId: bobBid, reason: 'Typo' }));
  t.prepare('UPDATE auction_items SET withdrawn = 1 WHERE id = ?').run(jersey.id);

  const stats = await auctionDashboard.getStats(auction.id);
  expect(stats.totals).toMatchObject({ committedCents: 10000, bids: 1, items: 2, withdrawn: 1 });
  expect(stats.recentBids.map(b => b.bidder_name)).toEqual(['Alice', 'Alice']);
});

test('getSummary describes a live auction for the main dashboard', async () => {
  expect(await auctionDashboard.getSummary()).toMatchObject({ id: auction.id, phase: 'live', committedCents: 21000, bids: 3 });
});

test('getSummary is null when no auction is live or recently closed', async () => {
  db.__getCurrentDb().prepare('UPDATE auctions SET ends_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 8 * 86400000).toISOString(), auction.id);
  expect(await auctionDashboard.getSummary()).toBeNull();
});
