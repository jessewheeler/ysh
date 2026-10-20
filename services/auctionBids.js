/**
 * Placing and removing silent auction bids (issue #119).
 *
 * The item row carries the current high bid. A bid moves it with a compare-and-swap against
 * the snapshot it validated (auctionItems.casHighBid), and the same statement checks the
 * auction is open, so the hard close at ends_at holds even for a request already in flight.
 */
const db = require('../db/database');
const itemsRepo = require('../db/repos/auctionItems');
const bidsRepo = require('../db/repos/auctionBids');
const biddersRepo = require('../db/repos/auctionBidders');
const auditLog = require('../db/repos/auditLog');
const { getActor } = require('../db/audit-context');
const auctions = require('./auctions');

const MAX_ATTEMPTS = 3;

// The SQLite adapter runs an async transaction as BEGIN … await fn() … COMMIT on its one shared
// connection, so two bids landing together would issue a second BEGIN inside the first and fail
// with "cannot start a transaction within a transaction". Bid writes are queued one at a time
// on SQLite (local development and tests). PostgreSQL gives each transaction its own pooled
// client, so it needs no queue.
let sqliteQueue = Promise.resolve();
function inTransaction(fn) {
  if (db.dialect !== 'sqlite') return db.transaction(fn);
  const run = sqliteQueue.then(() => db.transaction(fn));
  sqliteQueue = run.catch(() => {});
  return run;
}

class BidConflict extends Error {}

const MESSAGES = {
  invalid_amount: 'Enter your bid as a whole number of dollars.',
  not_found: 'That item could not be found.',
  not_started: 'Bidding has not opened yet.',
  closed: 'Bidding has closed.',
  withdrawn: 'This item has been withdrawn from the auction.',
  not_verified: 'Please sign in to bid.',
  blocked: 'Your bidding privileges for this auction have been suspended. Please contact the club.',
  already_high: 'You are already the high bidder on this item.',
  ack_required: 'Please confirm that shipping and handling costs are your responsibility.',
  conflict: 'Bidding is busy on this item. Please try again.',
};

function money(cents) {
  return `$${(cents / 100).toLocaleString('en-US')}`;
}

function refuse(code, extra = {}) {
  return { ok: false, code, message: extra.message || MESSAGES[code], ...extra };
}

/**
 * Places a bid. Resolves to
 *   { ok: true, item, bid, paddle, previousHighBidderId, auctionId }
 * or { ok: false, code, message, minNextCents? }. Never throws for a rule violation.
 */
async function placeBid({ auctionId, itemId, bidderId, amountRaw, shippingAck, now = new Date() }) {
  const cents = auctions.parseWholeDollars(amountRaw);
  if (!cents) return refuse('invalid_amount');

  const bidder = await biddersRepo.get(bidderId);
  if (!bidder || !bidder.verified_at) return refuse('not_verified');
  if (bidder.blocked_at) return refuse('blocked');

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const item = await itemsRepo.getWithAuction(itemId);
    if (!item || Number(item.auction_id) !== Number(auctionId) || item.auction_status !== 'published') {
      return refuse('not_found');
    }
    const auction = {
      status: item.auction_status, starts_at: item.auction_starts_at, ends_at: item.auction_ends_at,
    };
    const ph = auctions.phase(auction, now);
    if (ph === 'upcoming') return refuse('not_started');
    if (ph === 'closed') return refuse('closed');
    if (item.withdrawn) return refuse('withdrawn');
    if (item.high_bidder_id != null && Number(item.high_bidder_id) === Number(bidderId)) {
      return refuse('already_high');
    }

    const minNext = auctions.minNextCents(item, item.auction_min_increment_cents);
    if (cents < minNext) {
      return refuse('too_low', {
        message: `Your bid must be at least ${money(minNext)}.`,
        minNextCents: minNext,
      });
    }

    let paddle = await bidsRepo.getPaddle(item.auction_id, bidderId);
    if (!paddle) {
      if (!shippingAck) return refuse('ack_required');
      paddle = await bidsRepo.assignPaddle(item.auction_id, bidderId, now.toISOString());
    }

    const nowIso = now.toISOString();
    try {
      // Database calls only inside the transaction: the SQLite adapter shares one connection,
      // so awaiting real I/O here would let another request's statements run inside it.
      const bid = await inTransaction(async () => {
        const swapped = await itemsRepo.casHighBid({
          itemId: item.id,
          expectedCents: item.current_bid_cents,
          expectedBidderId: item.high_bidder_id,
          newCents: cents,
          bidderId,
          nowIso,
        });
        if (!swapped) throw new BidConflict();
        return bidsRepo.insert({ itemId: item.id, bidderId, amountCents: cents, placedAt: nowIso });
      });
      const updated = await itemsRepo.get(item.id);
      return {
        ok: true,
        auctionId: item.auction_id,
        item: { ...updated, high_paddle: paddle.paddle_number },
        bid,
        paddle,
        previousHighBidderId: item.high_bidder_id == null ? null : Number(item.high_bidder_id),
        minNextCents: auctions.minNextCents(updated, item.auction_min_increment_cents),
      };
    } catch (err) {
      // Someone else's bid landed first (or the window closed): re-read and re-check.
      if (err instanceof BidConflict || /unique|duplicate/i.test(err.message)) continue;
      throw err;
    }
  }
  return refuse('conflict');
}

/**
 * Admin removal of a bad bid. Stamps it removed with a reason and recomputes the item's high
 * bid from what's left. Returns { ok, item, bid } or { ok: false, message }.
 */
async function removeBid({ bidId, reason, now = new Date() }) {
  const why = String(reason || '').trim();
  if (!why) return { ok: false, message: 'A reason is required to remove a bid.' };
  const actor = getActor();
  const old = await bidsRepo.get(bidId);
  if (!old) return { ok: false, message: 'Bid not found.' };
  if (old.removed_at) return { ok: false, message: 'That bid was already removed.' };
  const oldItem = await itemsRepo.get(old.item_id);

  const removed = await inTransaction(async () => {
    const changed = await bidsRepo.softRemove(bidId, { reason: why, removedBy: actor.id, nowIso: now.toISOString() });
    if (!changed) return false;
    await itemsRepo.recomputeHigh(old.item_id);
    return true;
  });
  if (!removed) return { ok: false, message: 'That bid was already removed.' };

  const bid = await bidsRepo.get(bidId);
  const item = await itemsRepo.get(old.item_id);
  await auditLog.insert({ tableName: 'auction_bids', recordId: bidId, action: 'UPDATE', actor, oldValues: old, newValues: bid });
  await auditLog.insert({ tableName: 'auction_items', recordId: item.id, action: 'UPDATE', actor, oldValues: oldItem, newValues: item });
  return { ok: true, item, bid };
}

module.exports = { placeBid, removeBid, MESSAGES };
