/**
 * What happens after an auction changes (issue #119): live updates over SSE, the throttled
 * outbid email, and closing an auction — the "closed" broadcast and one winner email per
 * winning bidder.
 *
 * The on* hooks run after the write has committed, so none of them may throw into the request
 * that called them: each logs and carries on.
 */
const auctionsRepo = require('../db/repos/auctions');
const itemsRepo = require('../db/repos/auctionItems');
const bidsRepo = require('../db/repos/auctionBids');
const biddersRepo = require('../db/repos/auctionBidders');
const auctions = require('./auctions');
const auctionDashboard = require('./auctionDashboard');
const hub = require('./auctionHub');
const { formatDenver, formatDenverShort } = require('./timezone');
const logger = require('./logger');

function outbidThrottleMs() {
  const minutes = Number(process.env.AUCTION_OUTBID_EMAIL_MINUTES);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 10) * 60 * 1000;
}

function baseUrl() {
  return process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

function email() {
  // Required lazily so tests that mock services/email per file see their mock.
  return require('./email');
}

/** Totals and one leaderboard row for the admin dashboard to patch in place. */
async function adminPayload(auctionId, itemId) {
  const stats = await auctionDashboard.getStats(auctionId);
  const row = stats.leaderboard.find(i => i.id === Number(itemId)) || null;
  return {
    totals: stats.totals,
    topBidders: stats.topBidders.map(t => ({ paddle: t.paddle, name: t.name, items: t.items, cents: t.cents })),
    item: row && {
      item_id: row.id,
      current_bid_cents: row.current_bid_cents,
      bid_count: row.bid_count,
      over_starting_pct: row.over_starting_pct,
      high_paddle: row.high_paddle,
      high_bidder_name: row.high_bidder_name,
    },
  };
}

/**
 * Emails the bidder who just lost the lead, at most once per item per throttle window.
 * Returns true when an email was sent.
 */
async function maybeSendOutbidEmail({ auction, item, bidderId, now = new Date() }) {
  if (auctions.phase(auction, now) !== 'live') return false;
  const claimed = await bidsRepo.claimOutbidNotice(
    item.id, bidderId, now.toISOString(), new Date(now.getTime() - outbidThrottleMs()).toISOString()
  );
  if (!claimed) return false;
  const bidder = await biddersRepo.get(bidderId);
  if (!bidder) return false;
  try {
    await email().sendOutbidEmail({
      bidder,
      auction,
      item,
      currentBidCents: item.current_bid_cents,
      minNextCents: auctions.minNextCents(item, auction.min_increment_cents),
      itemUrl: `${baseUrl()}/auctions/${auction.id}/items/${item.id}`,
      closesAt: formatDenver(auction.ends_at),
    });
    return true;
  } catch (err) {
    // Not retried: the throttle row is already claimed, and the live banner still reaches
    // anyone with the page open.
    logger.error('Outbid email failed', { error: err.message, bidderId, itemId: item.id });
    return false;
  }
}

async function handleBidPlaced(result) {
  const auction = await auctionsRepo.get(result.auctionId);
  const item = result.item;
  const state = auctions.publicItemState(item, auction.min_increment_cents);

  hub.broadcast(auction.id, 'bid', {
    ...state,
    amount_cents: result.bid.amount_cents,
    placed_at: result.bid.placed_at,
  });

  const bidder = await biddersRepo.get(result.bid.bidder_id);
  hub.broadcastAdmin(auction.id, 'admin_bid', {
    ...(await adminPayload(auction.id, item.id)),
    bid: {
      id: result.bid.id,
      item_id: item.id,
      item_title: item.title,
      amount_cents: result.bid.amount_cents,
      placed_at: result.bid.placed_at,
      placed_at_label: formatDenverShort(result.bid.placed_at),
      paddle_number: result.paddle.paddle_number,
      bidder_name: bidder ? bidder.name : '',
    },
  });

  const loser = result.previousHighBidderId;
  if (loser != null && Number(loser) !== Number(result.bid.bidder_id)) {
    hub.sendToBidder(auction.id, loser, 'outbid', {
      item_id: item.id,
      item_title: item.title,
      current_bid_cents: item.current_bid_cents,
      min_next_cents: state.min_next_cents,
      url: `/auctions/${auction.id}/items/${item.id}`,
    });
    // The admin dashboard's "Outbid emails sent" counter changes only once the email has gone.
    if (await maybeSendOutbidEmail({ auction, item, bidderId: loser })) {
      hub.broadcastAdmin(auction.id, 'admin_refresh', await adminPayload(auction.id, item.id));
    }
  }
}

/** Called by the bid route after a successful bid. Fire and forget. */
function onBidPlaced(result) {
  return handleBidPlaced(result).catch(err => {
    logger.error('Auction bid notification failed', { error: err.message, stack: err.stack });
  });
}

/** After an admin removes a bid: everyone sees the recomputed price. No emails. */
function onBidRemoved(auctionId, item) {
  return (async () => {
    const auction = await auctionsRepo.get(auctionId);
    const [listed] = (await itemsRepo.listByAuction(auctionId, { includeWithdrawn: true })).filter(i => i.id === item.id);
    const state = auctions.publicItemState(listed || item, auction.min_increment_cents);
    hub.broadcast(auctionId, 'bid', { ...state, removed: true });
    hub.broadcastAdmin(auctionId, 'admin_refresh', await adminPayload(auctionId, item.id));
  })().catch(err => logger.error('Auction removal notification failed', { error: err.message }));
}

/** After an item is withdrawn or reinstated. */
function onItemChanged(auctionId, item) {
  try {
    hub.broadcast(auctionId, 'item', { item_id: item.id, withdrawn: !!item.withdrawn });
  } catch (err) {
    logger.error('Auction item notification failed', { error: err.message });
  }
}

/** After an admin edits the auction (its window may have moved). */
function onAuctionChanged(auction) {
  try {
    const payload = { starts_at: auction.starts_at, ends_at: auction.ends_at, phase: auctions.phase(auction) };
    hub.broadcast(auction.id, 'auction', payload);
    hub.broadcastAdmin(auction.id, 'auction', payload);
  } catch (err) {
    logger.error('Auction change notification failed', { error: err.message });
  }
}

/**
 * Sends each winning bidder one email listing what they won, for items not yet emailed.
 * Safe to run again: an item is marked only after its winner's email goes out, so a retry
 * sends just the ones that failed. Returns { sent, failed }.
 */
async function sendWinnerEmails(auctionId) {
  const auction = await auctionsRepo.get(auctionId);
  if (!auction) return { sent: 0, failed: 0 };
  const pending = (await itemsRepo.listWinners(auctionId))
    .filter(i => !i.withdrawn && i.high_bidder_id != null && !i.winner_emailed_at);

  const byBidder = new Map();
  for (const item of pending) {
    if (!byBidder.has(item.high_bidder_id)) byBidder.set(item.high_bidder_id, []);
    byBidder.get(item.high_bidder_id).push(item);
  }

  let sent = 0;
  let failed = 0;
  for (const [bidderId, items] of byBidder) {
    const bidder = await biddersRepo.get(bidderId);
    if (!bidder) continue;
    try {
      await email().sendAuctionWinnerEmail({ bidder, auction, items });
      await itemsRepo.markWinnerEmailed(items.map(i => i.id), new Date().toISOString());
      sent++;
    } catch (err) {
      failed++;
      logger.error('Auction winner email failed', { error: err.message, bidderId, auctionId });
    }
  }
  logger.info('Auction winner emails', { auctionId, sent, failed });
  return { sent, failed };
}

/**
 * The close job (services/scheduler.js, every minute): for each published auction whose window
 * has ended and whose winners haven't been notified, claim it, tell open pages it closed, and
 * email the winners. Bidding itself closes on time whether or not this runs — the bid SQL
 * checks ends_at.
 */
async function closeDueAuctions(now = new Date()) {
  const due = await auctionsRepo.findClosedUnnotified(now.toISOString());
  const results = [];
  for (const auction of due) {
    if (!(await auctionsRepo.claimWinnersNotified(auction.id, now.toISOString()))) continue;
    hub.broadcast(auction.id, 'closed', { auction_id: auction.id });
    hub.broadcastAdmin(auction.id, 'closed', { auction_id: auction.id });
    auctions.invalidateNavCache();
    results.push({ auctionId: auction.id, ...(await sendWinnerEmails(auction.id)) });
  }
  return results;
}

module.exports = {
  onBidPlaced,
  onBidRemoved,
  onItemChanged,
  onAuctionChanged,
  maybeSendOutbidEmail,
  sendWinnerEmails,
  closeDueAuctions,
};
