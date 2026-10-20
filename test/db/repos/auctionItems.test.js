jest.mock('../../../db/database', () => require('../../helpers/setupDb'));

const db = require('../../../db/database');
const itemsRepo = require('../../../db/repos/auctionItems');
const auctionsRepo = require('../../../db/repos/auctions');
const auctionBids = require('../../../services/auctionBids');
const { runWithActor } = require('../../../db/audit-context');
const { insertAuction, insertAuctionItem, insertBidder, insertAdmin } = require('../../helpers/fixtures');

let auction;
let admin;
const asAdmin = fn => runWithActor({ id: admin.id, email: admin.email }, fn);

beforeEach(() => {
  db.__resetTestDb();
  const t = db.__getCurrentDb();
  admin = insertAdmin(t, { email: 'admin@ysh.test' });
  auction = insertAuction(t);
});

test('create appends to the display order and writes an audit row', async () => {
  const a = await asAdmin(() => itemsRepo.create(auction.id, { title: 'A', starting_bid_cents: 1000 }));
  const b = await asAdmin(() => itemsRepo.create(auction.id, { title: 'B', starting_bid_cents: 1000 }));
  expect(b.sort_order).toBe(a.sort_order + 1);
  expect(a.created_by).toBe(admin.id);
  const audit = db.__getCurrentDb().prepare("SELECT * FROM audit_log WHERE table_name = 'auction_items' AND action = 'INSERT'").all();
  expect(audit).toHaveLength(2);
});

test('the starting bid is locked once an item has bids', async () => {
  const item = insertAuctionItem(db.__getCurrentDb(), { auction_id: auction.id, starting_bid_cents: 2000 });
  const bidder = insertBidder(db.__getCurrentDb());
  await auctionBids.placeBid({ auctionId: auction.id, itemId: item.id, bidderId: bidder.id, amountRaw: '20', shippingAck: true });

  const { item: updated, startingBidLocked } = await asAdmin(() =>
    itemsRepo.update(item.id, { title: 'Renamed', starting_bid_cents: 500 }));
  expect(startingBidLocked).toBe(true);
  expect(updated).toMatchObject({ title: 'Renamed', starting_bid_cents: 2000 });
});

test('an item with bids cannot be deleted; one without can, and reports its photo URLs', async () => {
  const t = db.__getCurrentDb();
  const sold = insertAuctionItem(t, { auction_id: auction.id });
  const empty = insertAuctionItem(t, { auction_id: auction.id, title: 'Empty' });
  const bidder = insertBidder(t);
  await auctionBids.placeBid({ auctionId: auction.id, itemId: sold.id, bidderId: bidder.id, amountRaw: '20', shippingAck: true });
  await asAdmin(() => itemsRepo.addPhoto(empty.id, 'https://cdn.example/a.jpg'));

  expect(await asAdmin(() => itemsRepo.remove(sold.id))).toBeNull();
  const removed = await asAdmin(() => itemsRepo.remove(empty.id));
  expect(removed.photoUrls).toEqual(['https://cdn.example/a.jpg']);
  expect(t.prepare('SELECT COUNT(*) AS n FROM auction_item_photos').get().n).toBe(0);
});

describe('photos', () => {
  let item;
  beforeEach(() => {
    item = insertAuctionItem(db.__getCurrentDb(), { auction_id: auction.id });
  });

  test('added in order; the first is the cover on the listing', async () => {
    await asAdmin(() => itemsRepo.addPhoto(item.id, '/uploads/1.jpg'));
    await asAdmin(() => itemsRepo.addPhoto(item.id, '/uploads/2.jpg'));
    expect((await itemsRepo.listPhotos(item.id)).map(p => p.url)).toEqual(['/uploads/1.jpg', '/uploads/2.jpg']);
    const [listed] = await itemsRepo.listByAuction(auction.id);
    expect(listed.cover_url).toBe('/uploads/1.jpg');
  });

  test('move swaps neighbours and ignores moves off either end', async () => {
    const p1 = await asAdmin(() => itemsRepo.addPhoto(item.id, '/uploads/1.jpg'));
    await asAdmin(() => itemsRepo.addPhoto(item.id, '/uploads/2.jpg'));
    const p3 = await asAdmin(() => itemsRepo.addPhoto(item.id, '/uploads/3.jpg'));

    expect(await itemsRepo.movePhoto(p3.id, 'up')).toBe(true);
    expect((await itemsRepo.listPhotos(item.id)).map(p => p.url)).toEqual(['/uploads/1.jpg', '/uploads/3.jpg', '/uploads/2.jpg']);
    expect(await itemsRepo.movePhoto(p1.id, 'up')).toBe(false);
  });

  test('delete returns the row so the file can be removed', async () => {
    const p = await asAdmin(() => itemsRepo.addPhoto(item.id, '/uploads/1.jpg'));
    expect((await asAdmin(() => itemsRepo.deletePhoto(p.id))).url).toBe('/uploads/1.jpg');
    expect(await itemsRepo.listPhotos(item.id)).toEqual([]);
  });
});

describe('auctions repo', () => {
  test('only a draft with no bids can be deleted', async () => {
    const t = db.__getCurrentDb();
    expect(await asAdmin(() => auctionsRepo.remove(auction.id))).toBeNull(); // published
    const draft = insertAuction(t, { status: 'draft' });
    expect((await asAdmin(() => auctionsRepo.remove(draft.id))).id).toBe(draft.id);
  });

  test('claimWinnersNotified is true for exactly one caller', async () => {
    const now = new Date().toISOString();
    expect(await auctionsRepo.claimWinnersNotified(auction.id, now)).toBe(true);
    expect(await auctionsRepo.claimWinnersNotified(auction.id, now)).toBe(false);
  });
});
