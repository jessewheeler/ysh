/**
 * Silent auction rules shared by the public and admin routes (issue #119): an auction's phase,
 * form parsing, the minimum next bid and the public view of an item. Bidding itself lives in
 * services/auctionBids.js.
 */
const auctionsRepo = require('../db/repos/auctions');
const { denverInputToUtcIso } = require('./timezone');

const DEFAULT_SHIPPING_NOTICE =
  'Shipping and handling costs are the winning bidder\'s responsibility. Winners will be contacted '
  + 'to arrange payment and either local pickup in Billings or shipping at the bidder\'s expense.';

const DEFAULT_INCREMENT_CENTS = 500;

/** 'draft' | 'upcoming' | 'live' | 'closed' at `now`. */
function phase(auction, now = new Date()) {
  if (!auction || auction.status !== 'published') return 'draft';
  const nowIso = now.toISOString();
  if (nowIso < auction.starts_at) return 'upcoming';
  if (nowIso >= auction.ends_at) return 'closed';
  return 'live';
}

/** Whole dollars ("25", "$25", "25.00") -> cents, or null when not a positive whole number. */
function parseWholeDollars(raw, { max = 999999 } = {}) {
  const s = String(raw ?? '').trim().replace(/^\$/, '').replace(/,/g, '').replace(/\.0+$/, '');
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  if (n < 1 || n > max) return null;
  return n * 100;
}

function parseAuctionForm(body) {
  const errors = [];
  const title = String(body.title || '').trim();
  if (!title) errors.push('Title is required.');

  const startsAt = denverInputToUtcIso(body.starts_at);
  const endsAt = denverInputToUtcIso(body.ends_at);
  if (!startsAt) errors.push('Start time is required.');
  if (!endsAt) errors.push('End time is required.');
  if (startsAt && endsAt && endsAt <= startsAt) errors.push('The auction must end after it starts.');

  let increment = DEFAULT_INCREMENT_CENTS;
  if (String(body.min_increment ?? '').trim() !== '') {
    increment = parseWholeDollars(body.min_increment, { max: 100000 });
    if (!increment) errors.push('Minimum increment must be a whole number of dollars, at least $1.');
  }

  const fields = {
    title,
    description: String(body.description || '').trim() || null,
    status: body.status === 'published' ? 'published' : 'draft',
    starts_at: startsAt,
    ends_at: endsAt,
    min_increment_cents: increment || DEFAULT_INCREMENT_CENTS,
    shipping_notice: String(body.shipping_notice || '').trim() || DEFAULT_SHIPPING_NOTICE,
  };
  return { errors, fields };
}

function parseItemForm(body) {
  const errors = [];
  const title = String(body.title || '').trim();
  if (!title) errors.push('Item title is required.');
  const startingBid = parseWholeDollars(body.starting_bid);
  if (!startingBid) errors.push('Starting bid must be a whole number of dollars, at least $1.');
  const fields = {
    title,
    description: String(body.description || '').trim() || null,
    starting_bid_cents: startingBid,
  };
  const sort = parseInt(body.sort_order, 10);
  if (Number.isFinite(sort)) fields.sort_order = sort;
  return { errors, fields };
}

/** The least a new bid on `item` may be. `increment` comes from the item's auction. */
function minNextCents(item, incrementCents) {
  if (item.current_bid_cents == null) return item.starting_bid_cents;
  return item.current_bid_cents + incrementCents;
}

/**
 * What anyone may see about an item's bidding: amounts and the high bidder's paddle number,
 * never a bidder id, name or email.
 */
function publicItemState(item, incrementCents) {
  return {
    item_id: item.id,
    current_bid_cents: item.current_bid_cents,
    starting_bid_cents: item.starting_bid_cents,
    min_next_cents: minNextCents(item, incrementCents),
    bid_count: item.bid_count,
    high_paddle: item.high_paddle ?? null,
    withdrawn: !!item.withdrawn,
  };
}

// The nav link is looked up on every page render, so cache it briefly. Admin writes clear it.
const NAV_TTL_MS = 30 * 1000;
let navCache = { at: 0, value: null };

async function getNavAuction(now = new Date()) {
  if (process.env.NODE_ENV !== 'test' && Date.now() - navCache.at < NAV_TTL_MS) {
    const cached = navCache.value;
    // An auction that ended since it was cached drops out without waiting for the TTL.
    if (!cached || cached.ends_at > now.toISOString()) return cached ? { ...cached, phase: phase(cached, now) } : null;
  }
  const auction = await auctionsRepo.findNavCandidate(now.toISOString());
  navCache = { at: Date.now(), value: auction || null };
  return auction ? { ...auction, phase: phase(auction, now) } : null;
}

function invalidateNavCache() {
  navCache = { at: 0, value: null };
}

module.exports = {
  DEFAULT_SHIPPING_NOTICE,
  DEFAULT_INCREMENT_CENTS,
  phase,
  parseWholeDollars,
  parseAuctionForm,
  parseItemForm,
  minNextCents,
  publicItemState,
  getNavAuction,
  invalidateNavCache,
};
