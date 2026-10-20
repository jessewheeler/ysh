/**
 * Numbers for the admin auction dashboard (issue #119). Everything counts live bids only —
 * a bid an admin removed doesn't count — and withdrawn items are left out of the totals.
 */
const auctionsRepo = require('../db/repos/auctions');
const itemsRepo = require('../db/repos/auctionItems');
const bidsRepo = require('../db/repos/auctionBids');
const biddersRepo = require('../db/repos/auctionBidders');
const db = require('../db/database');
const auctions = require('./auctions');

async function getStats(auctionId, now = new Date()) {
  const auction = await auctionsRepo.get(auctionId);
  if (!auction) return null;
  const [items, bidders, recentBids, outbidEmails] = await Promise.all([
    itemsRepo.listForAdmin(auctionId),
    biddersRepo.listByAuction(auctionId),
    bidsRepo.listRecentForAuction(auctionId, 25),
    db.get(
      `SELECT COALESCE(SUM(n.sent_count), 0) AS n FROM auction_outbid_notices n
       JOIN auction_items i ON i.id = n.item_id WHERE i.auction_id = ?`,
      auctionId
    ),
  ]);

  const active = items.filter(i => !i.withdrawn);
  const withBids = active.filter(i => i.current_bid_cents != null);
  const totalCommitted = withBids.reduce((sum, i) => sum + i.current_bid_cents, 0);
  const totalStarting = active.reduce((sum, i) => sum + i.starting_bid_cents, 0);
  const totalBids = active.reduce((sum, i) => sum + i.bid_count, 0);

  // Top bidders by what they're currently winning.
  const winningByBidder = new Map();
  for (const item of withBids) {
    const entry = winningByBidder.get(item.high_bidder_id) || {
      bidderId: item.high_bidder_id, name: item.high_bidder_name, paddle: item.high_paddle, items: 0, cents: 0,
    };
    entry.items += 1;
    entry.cents += item.current_bid_cents;
    winningByBidder.set(item.high_bidder_id, entry);
  }
  const topBidders = [...winningByBidder.values()].sort((a, b) => b.cents - a.cents).slice(0, 10);

  const leaderboard = active.map(i => ({
    ...i,
    over_starting_pct: i.current_bid_cents != null
      ? Math.round(((i.current_bid_cents - i.starting_bid_cents) / i.starting_bid_cents) * 100)
      : null,
  }));

  return {
    auction,
    phase: auctions.phase(auction, now),
    totals: {
      committedCents: totalCommitted,
      startingCents: totalStarting,
      bids: totalBids,
      bidders: bidders.length,
      itemsWithBids: withBids.length,
      items: active.length,
      withdrawn: items.length - active.length,
      avgBidsPerItem: active.length ? Math.round((totalBids / active.length) * 10) / 10 : 0,
      outbidEmails: Number(outbidEmails?.n || 0),
      winnerEmailsSent: withBids.filter(i => i.winner_emailed_at).length,
    },
    leaderboard,
    topBidders,
    recentBids,
  };
}

/**
 * One line for the main admin dashboard: the auction that's live now, or closed within the
 * last week. Null when there's nothing to show.
 */
async function getSummary(now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const auction = await db.get(
    `SELECT * FROM auctions WHERE status = 'published' AND starts_at <= ? AND ends_at > ?
     ORDER BY ends_at DESC LIMIT 1`,
    now.toISOString(), weekAgo
  );
  if (!auction) return null;
  const totals = await db.get(
    `SELECT COALESCE(SUM(current_bid_cents), 0) AS cents, COALESCE(SUM(bid_count), 0) AS bids
     FROM auction_items WHERE auction_id = ? AND withdrawn = 0`,
    auction.id
  );
  return {
    id: auction.id,
    title: auction.title,
    phase: auctions.phase(auction, now),
    committedCents: Number(totals.cents),
    bids: Number(totals.bids),
  };
}

module.exports = { getStats, getSummary };
