jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/email', () => ({
  sendOutbidEmail: jest.fn().mockResolvedValue({}),
  sendAuctionWinnerEmail: jest.fn().mockResolvedValue({}),
}));

const db = require('../../db/database');
const email = require('../../services/email');
const hub = require('../../services/auctionHub');
const notifier = require('../../services/auctionNotifier');
const auctionBids = require('../../services/auctionBids');
const { insertAuction, insertAuctionItem, insertBidder } = require('../helpers/fixtures');

let auction, item, alice, bob;
const t = () => db.__getCurrentDb();

async function bidAndNotify(bidder, amount, target = item) {
  const result = await auctionBids.placeBid({
    auctionId: auction.id, itemId: target.id, bidderId: bidder.id, amountRaw: String(amount), shippingAck: true,
  });
  expect(result.ok).toBe(true);
  await notifier.onBidPlaced(result);
  return result;
}

function fakeRes() {
  return { chunks: [], write(c) { this.chunks.push(c); }, events() {
    return this.chunks.join('').split('\n\n').filter(Boolean)
      .map(f => ({ event: (/event: (.+)/.exec(f) || [])[1], data: JSON.parse((/data: (.+)/.exec(f) || [null, 'null'])[1]) }));
  } };
}

beforeEach(() => {
  db.__resetTestDb();
  hub._reset();
  jest.clearAllMocks();
  delete process.env.AUCTION_OUTBID_EMAIL_MINUTES;
  auction = insertAuction(t());
  item = insertAuctionItem(t(), { auction_id: auction.id, title: 'Helmet', starting_bid_cents: 2000 });
  alice = insertBidder(t(), { email: 'alice@example.com', name: 'Alice' });
  bob = insertBidder(t(), { email: 'bob@example.com', name: 'Bob' });
});

afterAll(() => hub._reset());

describe('onBidPlaced', () => {
  test('broadcasts the new price with paddle numbers only, and names to admins', async () => {
    const pub = fakeRes();
    const admin = fakeRes();
    hub.subscribe(auction.id, pub);
    hub.subscribe(auction.id, admin, { admin: true });

    await bidAndNotify(alice, 20);

    const [bid] = pub.events();
    expect(bid.event).toBe('bid');
    expect(bid.data).toMatchObject({ item_id: item.id, current_bid_cents: 2000, min_next_cents: 2500, high_paddle: 1, bid_count: 1 });
    expect(JSON.stringify(bid.data)).not.toMatch(/Alice|alice@|bidder_id/);

    const [adminBid] = admin.events();
    expect(adminBid.event).toBe('admin_bid');
    expect(adminBid.data.bid).toMatchObject({ bidder_name: 'Alice', paddle_number: 1, amount_cents: 2000 });
    expect(adminBid.data.totals).toMatchObject({ committedCents: 2000, bids: 1 });
  });

  test('tells only the outbid bidder, live and by email, with the shipping notice', async () => {
    const aliceTab = fakeRes();
    const bobTab = fakeRes();
    hub.subscribe(auction.id, aliceTab, { bidderId: alice.id });
    hub.subscribe(auction.id, bobTab, { bidderId: bob.id });

    await bidAndNotify(alice, 20);
    expect(email.sendOutbidEmail).not.toHaveBeenCalled();

    await bidAndNotify(bob, 30);
    const outbid = aliceTab.events().find(e => e.event === 'outbid');
    expect(outbid.data).toMatchObject({ item_id: item.id, item_title: 'Helmet', current_bid_cents: 3000, min_next_cents: 3500 });
    expect(bobTab.events().some(e => e.event === 'outbid')).toBe(false);

    expect(email.sendOutbidEmail).toHaveBeenCalledTimes(1);
    const args = email.sendOutbidEmail.mock.calls[0][0];
    expect(args.bidder.email).toBe('alice@example.com');
    expect(args).toMatchObject({ currentBidCents: 3000, minNextCents: 3500 });
    expect(args.itemUrl).toMatch(new RegExp(`/auctions/${auction.id}/items/${item.id}$`));
    expect(args.auction.shipping_notice).toMatch(/shipping and handling/i);
  });

  test('throttles outbid emails per item per bidder', async () => {
    await bidAndNotify(alice, 20);
    await bidAndNotify(bob, 25);
    await bidAndNotify(alice, 30);
    await bidAndNotify(bob, 35); // Alice outbid again within the window: no second email
    expect(email.sendOutbidEmail.mock.calls.map(c => c[0].bidder.name)).toEqual(['Alice', 'Bob']);

    // Once the window has passed she hears about it again.
    t().prepare('UPDATE auction_outbid_notices SET last_sent_at = ? WHERE bidder_id = ?')
      .run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), alice.id);
    await bidAndNotify(alice, 40);
    await bidAndNotify(bob, 45);
    expect(email.sendOutbidEmail.mock.calls.filter(c => c[0].bidder.name === 'Alice')).toHaveLength(2);
    expect(t().prepare('SELECT sent_count FROM auction_outbid_notices WHERE bidder_id = ?').get(alice.id).sent_count).toBe(2);
  });

  test('the throttle is per item: being outbid on another item still emails', async () => {
    const jersey = insertAuctionItem(t(), { auction_id: auction.id, title: 'Jersey' });
    await bidAndNotify(alice, 20);
    await bidAndNotify(bob, 25);
    await bidAndNotify(alice, 20, jersey);
    await bidAndNotify(bob, 25, jersey);
    expect(email.sendOutbidEmail.mock.calls.map(c => c[0].item.title)).toEqual(['Helmet', 'Jersey']);
  });

  test('a failing email does not throw into the caller', async () => {
    email.sendOutbidEmail.mockRejectedValueOnce(new Error('MailerSend down'));
    await bidAndNotify(alice, 20);
    await expect(bidAndNotify(bob, 25)).resolves.toBeDefined();
  });
});

describe('closing', () => {
  function close() {
    t().prepare('UPDATE auctions SET ends_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), auction.id);
  }

  test('emails each winner once with everything they won, and tells open pages it closed', async () => {
    const jersey = insertAuctionItem(t(), { auction_id: auction.id, title: 'Jersey', starting_bid_cents: 1000 });
    insertAuctionItem(t(), { auction_id: auction.id, title: 'Unsold' });
    await bidAndNotify(alice, 20);
    await bidAndNotify(alice, 10, jersey);
    const pub = fakeRes();
    hub.subscribe(auction.id, pub);
    close();

    const results = await notifier.closeDueAuctions(new Date());
    expect(results).toEqual([{ auctionId: auction.id, sent: 1, failed: 0 }]);
    expect(email.sendAuctionWinnerEmail).toHaveBeenCalledTimes(1);
    const { bidder, items } = email.sendAuctionWinnerEmail.mock.calls[0][0];
    expect(bidder.email).toBe('alice@example.com');
    expect(items.map(i => i.title).sort()).toEqual(['Helmet', 'Jersey']);
    expect(pub.events().map(e => e.event)).toContain('closed');

    // A second run finds nothing to do.
    expect(await notifier.closeDueAuctions(new Date())).toEqual([]);
    expect(email.sendAuctionWinnerEmail).toHaveBeenCalledTimes(1);
  });

  test('does nothing for an auction still open', async () => {
    await bidAndNotify(alice, 20);
    expect(await notifier.closeDueAuctions(new Date())).toEqual([]);
  });

  test('a failed winner email is retried by sendWinnerEmails, and only that one', async () => {
    const jersey = insertAuctionItem(t(), { auction_id: auction.id, title: 'Jersey' });
    await bidAndNotify(alice, 20);
    await bidAndNotify(bob, 20, jersey);
    close();
    email.sendAuctionWinnerEmail.mockImplementationOnce(() => Promise.reject(new Error('down')));

    const [first] = await notifier.closeDueAuctions(new Date());
    expect(first).toMatchObject({ sent: 1, failed: 1 });

    email.sendAuctionWinnerEmail.mockClear();
    expect(await notifier.sendWinnerEmails(auction.id)).toEqual({ sent: 1, failed: 0 });
    expect(email.sendAuctionWinnerEmail).toHaveBeenCalledTimes(1);
    expect(await notifier.sendWinnerEmails(auction.id)).toEqual({ sent: 0, failed: 0 });
  });

  test('no outbid email once bidding has closed', async () => {
    const res = await notifier.maybeSendOutbidEmail({
      auction: { ...auction, ends_at: new Date(Date.now() - 1).toISOString() },
      item: { id: item.id, current_bid_cents: 2500, starting_bid_cents: 2000 },
      bidderId: alice.id,
    });
    expect(res).toBe(false);
    expect(email.sendOutbidEmail).not.toHaveBeenCalled();
  });
});
