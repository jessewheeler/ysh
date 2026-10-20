jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const auctionBids = require('../../services/auctionBids');
const itemsRepo = require('../../db/repos/auctionItems');
const { runWithActor } = require('../../db/audit-context');
const { insertAuction, insertAuctionItem, insertBidder, insertAdmin } = require('../helpers/fixtures');

let auction;
let item;
let alice;
let bob;

function bid(bidder, amount, extra = {}) {
  return auctionBids.placeBid({
    auctionId: auction.id, itemId: item.id, bidderId: bidder.id, amountRaw: String(amount), shippingAck: true, ...extra,
  });
}

function itemRow() {
  return db.__getCurrentDb().prepare('SELECT * FROM auction_items WHERE id = ?').get(item.id);
}

beforeEach(() => {
  db.__resetTestDb();
  const t = db.__getCurrentDb();
  auction = insertAuction(t);
  item = insertAuctionItem(t, { auction_id: auction.id, starting_bid_cents: 2000 });
  alice = insertBidder(t, { email: 'alice@example.com', name: 'Alice' });
  bob = insertBidder(t, { email: 'bob@example.com', name: 'Bob' });
});

describe('placeBid', () => {
  test('the first bid must meet the starting bid', async () => {
    const low = await bid(alice, 19);
    expect(low).toMatchObject({ ok: false, code: 'too_low', minNextCents: 2000 });

    const ok = await bid(alice, 20);
    expect(ok.ok).toBe(true);
    expect(itemRow()).toMatchObject({ current_bid_cents: 2000, high_bidder_id: alice.id, bid_count: 1 });
    expect(ok.previousHighBidderId).toBeNull();
  });

  test('later bids must beat the current bid by the increment', async () => {
    await bid(alice, 20);
    expect(await bid(bob, 24)).toMatchObject({ ok: false, code: 'too_low', minNextCents: 2500 });
    const ok = await bid(bob, 25);
    expect(ok).toMatchObject({ ok: true, previousHighBidderId: alice.id, minNextCents: 3000 });
    expect(itemRow()).toMatchObject({ current_bid_cents: 2500, high_bidder_id: bob.id, bid_count: 2 });
  });

  test.each(['', 'abc', '20.50', '-5', '0', '10000000'])('refuses the amount %p', async (amount) => {
    expect((await bid(alice, amount)).code).toBe('invalid_amount');
  });

  test('accepts "$1,250" style amounts', async () => {
    expect((await bid(alice, '$1,250')).ok).toBe(true);
    expect(itemRow().current_bid_cents).toBe(125000);
  });

  test('the high bidder cannot outbid themselves', async () => {
    await bid(alice, 20);
    expect((await bid(alice, 50)).code).toBe('already_high');
  });

  test('refuses before the auction opens', async () => {
    const t = db.__getCurrentDb();
    t.prepare('UPDATE auctions SET starts_at = ? WHERE id = ?').run(new Date(Date.now() + 60000).toISOString(), auction.id);
    expect((await bid(alice, 20)).code).toBe('not_started');
  });

  test('hard close: a bid at exactly ends_at is refused, a millisecond earlier is accepted', async () => {
    const endsAt = new Date(auction.ends_at);
    expect((await bid(alice, 20, { now: endsAt })).code).toBe('closed');
    expect((await bid(alice, 20, { now: new Date(endsAt.getTime() - 1) })).ok).toBe(true);
  });

  test('the SQL guard refuses a bid if the auction closed after it was validated', async () => {
    // Validation passes (the injected clock says it's open) but the write's own clock says closed.
    const swapped = await itemsRepo.casHighBid({
      itemId: item.id, expectedCents: null, expectedBidderId: null, newCents: 2000, bidderId: alice.id,
      nowIso: new Date(new Date(auction.ends_at).getTime() + 1).toISOString(),
    });
    expect(swapped).toBe(false);
    expect(itemRow().bid_count).toBe(0);
  });

  test('refuses on a draft auction as if it did not exist', async () => {
    db.__getCurrentDb().prepare("UPDATE auctions SET status = 'draft' WHERE id = ?").run(auction.id);
    expect((await bid(alice, 20)).code).toBe('not_found');
  });

  test('refuses an item from another auction', async () => {
    const other = insertAuction(db.__getCurrentDb(), { title: 'Other' });
    const res = await auctionBids.placeBid({ auctionId: other.id, itemId: item.id, bidderId: alice.id, amountRaw: '20', shippingAck: true });
    expect(res.code).toBe('not_found');
  });

  test('refuses a withdrawn item', async () => {
    db.__getCurrentDb().prepare('UPDATE auction_items SET withdrawn = 1 WHERE id = ?').run(item.id);
    expect((await bid(alice, 20)).code).toBe('withdrawn');
  });

  test('refuses an unverified or blocked bidder', async () => {
    const t = db.__getCurrentDb();
    const unverified = insertBidder(t, { email: 'u@example.com', verified_at: null });
    const blocked = insertBidder(t, { email: 'b@example.com', blocked_at: new Date().toISOString() });
    expect((await bid(unverified, 20)).code).toBe('not_verified');
    expect((await bid(blocked, 20)).code).toBe('blocked');
  });

  test('the first bid in an auction needs the shipping acknowledgement; later ones do not', async () => {
    expect((await bid(alice, 20, { shippingAck: false })).code).toBe('ack_required');
    expect(itemRow().bid_count).toBe(0);

    await bid(alice, 20, { shippingAck: true });
    const second = insertAuctionItem(db.__getCurrentDb(), { auction_id: auction.id, title: 'Jersey' });
    const res = await auctionBids.placeBid({ auctionId: auction.id, itemId: second.id, bidderId: alice.id, amountRaw: '20', shippingAck: false });
    expect(res.ok).toBe(true);
    const paddle = db.__getCurrentDb().prepare('SELECT * FROM auction_paddles WHERE bidder_id = ?').get(alice.id);
    expect(paddle.shipping_ack_at).toBeTruthy();
  });

  test('paddle numbers count up per auction and restart in another auction', async () => {
    const a = await bid(alice, 20);
    const b = await bid(bob, 25);
    expect(a.paddle.paddle_number).toBe(1);
    expect(b.paddle.paddle_number).toBe(2);

    const t = db.__getCurrentDb();
    const other = insertAuction(t, { title: 'Spring' });
    const otherItem = insertAuctionItem(t, { auction_id: other.id });
    const c = await auctionBids.placeBid({ auctionId: other.id, itemId: otherItem.id, bidderId: bob.id, amountRaw: '20', shippingAck: true });
    expect(c.paddle.paddle_number).toBe(1);
  });

  test('a stale read retries: a higher bid still lands after someone else got in first', async () => {
    const realGet = itemsRepo.getWithAuction;
    const stale = await realGet(item.id);
    // Someone else bids between our read and our write.
    await bid(bob, 25);
    const spy = jest.spyOn(itemsRepo, 'getWithAuction').mockResolvedValueOnce(stale);

    const res = await bid(alice, 40);
    expect(res.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.previousHighBidderId).toBe(bob.id);
    expect(itemRow()).toMatchObject({ current_bid_cents: 4000, high_bidder_id: alice.id, bid_count: 2 });
    spy.mockRestore();
  });

  test('a stale read retries: a bid that is now too low gets the new minimum', async () => {
    const stale = await itemsRepo.getWithAuction(item.id);
    await bid(bob, 25);
    const spy = jest.spyOn(itemsRepo, 'getWithAuction').mockResolvedValueOnce(stale);

    const res = await bid(alice, 25);
    expect(res).toMatchObject({ ok: false, code: 'too_low', minNextCents: 3000 });
    expect(itemRow()).toMatchObject({ current_bid_cents: 2500, high_bidder_id: bob.id, bid_count: 1 });
    spy.mockRestore();
  });

  test('simultaneous bids: exactly one wins at the same amount, and the item stays consistent', async () => {
    const t = db.__getCurrentDb();
    const racers = [alice, bob, ...[1, 2, 3].map(i => insertBidder(t, { email: `r${i}@example.com` }))];
    const same = await Promise.all(racers.map(b => bid(b, 20)));
    expect(same.filter(r => r.ok)).toHaveLength(1);

    await Promise.all(racers.map((b, i) => bid(b, 100 + i * 10)));
    const row = itemRow();
    const live = t.prepare('SELECT amount_cents FROM auction_bids WHERE item_id = ? AND removed_at IS NULL ORDER BY amount_cents DESC').all(item.id);
    expect(row.bid_count).toBe(live.length);
    expect(row.current_bid_cents).toBe(live[0].amount_cents);
  });

  test('records the bid row', async () => {
    await bid(alice, 20);
    const rows = db.__getCurrentDb().prepare('SELECT * FROM auction_bids').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item_id: item.id, bidder_id: alice.id, amount_cents: 2000, removed_at: null });
  });
});

describe('removeBid', () => {
  let admin;
  beforeEach(() => {
    admin = insertAdmin(db.__getCurrentDb(), { email: 'admin@ysh.test' });
  });

  const asAdmin = fn => runWithActor({ id: admin.id, email: 'admin@ysh.test' }, fn);
  const bidIds = () => db.__getCurrentDb().prepare('SELECT id FROM auction_bids ORDER BY amount_cents').all().map(r => r.id);

  test('requires a reason', async () => {
    await bid(alice, 20);
    const res = await asAdmin(() => auctionBids.removeBid({ bidId: bidIds()[0], reason: '  ' }));
    expect(res).toMatchObject({ ok: false });
  });

  test('removing the high bid falls back to the next live bid', async () => {
    await bid(alice, 20);
    await bid(bob, 30);
    const [, bobBid] = bidIds();
    const res = await asAdmin(() => auctionBids.removeBid({ bidId: bobBid, reason: 'Typo' }));
    expect(res.ok).toBe(true);
    expect(itemRow()).toMatchObject({ current_bid_cents: 2000, high_bidder_id: alice.id, bid_count: 1 });

    const row = db.__getCurrentDb().prepare('SELECT * FROM auction_bids WHERE id = ?').get(bobBid);
    expect(row).toMatchObject({ removed_reason: 'Typo', removed_by: admin.id });
    expect(row.removed_at).toBeTruthy();
  });

  test('removing the only bid clears the high bid, and lets the next bid start from the starting bid', async () => {
    await bid(alice, 50);
    await asAdmin(() => auctionBids.removeBid({ bidId: bidIds()[0], reason: 'Retracted' }));
    expect(itemRow()).toMatchObject({ current_bid_cents: null, high_bidder_id: null, bid_count: 0 });
    // The same amount can be bid again: the live-amount unique index ignores removed bids.
    expect((await bid(bob, 50)).ok).toBe(true);
  });

  test('a second removal is refused', async () => {
    await bid(alice, 20);
    const id = bidIds()[0];
    await asAdmin(() => auctionBids.removeBid({ bidId: id, reason: 'x' }));
    expect((await asAdmin(() => auctionBids.removeBid({ bidId: id, reason: 'x' }))).ok).toBe(false);
  });

  test('writes audit rows for the bid and the item', async () => {
    await bid(alice, 20);
    await asAdmin(() => auctionBids.removeBid({ bidId: bidIds()[0], reason: 'Typo' }));
    const tables = db.__getCurrentDb()
      .prepare("SELECT table_name, actor_email FROM audit_log WHERE table_name IN ('auction_bids', 'auction_items')").all();
    expect(tables).toEqual(expect.arrayContaining([
      { table_name: 'auction_bids', actor_email: 'admin@ysh.test' },
      { table_name: 'auction_items', actor_email: 'admin@ysh.test' },
    ]));
  });
});
