/**
 * HTTP integration tests for the silent auction admin (issue #119), including multi-photo
 * upload through the real /admin multer middleware and a regression check that single-image
 * forms (the gallery) still work after it changed to upload.fields().
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/email', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue({}),
  sendOutbidEmail: jest.fn().mockResolvedValue({}),
  sendAuctionWinnerEmail: jest.fn().mockResolvedValue({}),
}));
// Force the local-disk upload path so nothing tries to reach Backblaze.
jest.mock('../../services/storage', () => ({
  isConfigured: () => false,
  uploadFile: jest.fn(),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const auctionBids = require('../../services/auctionBids');
const { insertAdmin, insertAuction, insertAuctionItem, insertBidder } = require('../helpers/fixtures');

// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const uploadsDir = path.join(__dirname, '..', '..', 'data', 'uploads');
let createdFiles = [];

function tokenFrom(html) {
  const match = html.match(/name="csrf-token" content="([^"]+)"/) || html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error('No CSRF token in response');
  return match[1];
}

async function loginAsAdmin() {
  const agent = request.agent(app);
  const page = await agent.get('/admin/login');
  await agent.post('/admin/login').type('form').send({ _csrf: tokenFrom(page.text), email: 'admin@ysh.test' });
  const verify = await agent.get('/admin/login/verify');
  await agent.post('/admin/login/verify').type('form').send({ _csrf: tokenFrom(verify.text), code: '000000' }).expect(302);
  return agent;
}

/** A fresh CSRF token from any admin page (the layout renders it in a meta tag). */
async function token(agent, url = '/admin/auctions') {
  return tokenFrom((await agent.get(url).expect(200)).text);
}

const t = () => db.__getCurrentDb();

beforeEach(() => {
  db.__resetTestDb();
  insertAdmin(t(), { email: 'admin@ysh.test' });
  createdFiles = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
});

afterEach(() => {
  // Remove files this test uploaded to data/uploads.
  if (!fs.existsSync(uploadsDir)) return;
  for (const f of fs.readdirSync(uploadsDir)) {
    if (!createdFiles.includes(f)) fs.unlinkSync(path.join(uploadsDir, f));
  }
});

test('requires an admin', async () => {
  await request(app).get('/admin/auctions').expect(302).expect('location', '/admin/login');
});

test('creating an auction stores Montana times as UTC and shows them back as entered', async () => {
  const agent = await loginAsAdmin();
  const csrf = await token(agent, '/admin/auctions/new');
  const res = await agent.post('/admin/auctions').type('form').send({
    _csrf: csrf, title: 'Holiday Auction', starts_at: '2026-12-01T18:00', ends_at: '2026-12-05T20:00',
    min_increment: '5', shipping_notice: 'Winner pays shipping and handling.', status: 'draft',
  }).expect(302);
  const row = t().prepare('SELECT * FROM auctions').get();
  expect(res.headers.location).toBe(`/admin/auctions/${row.id}/items`);
  expect(row).toMatchObject({ starts_at: '2026-12-02T01:00:00.000Z', ends_at: '2026-12-06T03:00:00.000Z', min_increment_cents: 500 });

  const edit = await agent.get(`/admin/auctions/${row.id}/edit`).expect(200);
  expect(edit.text).toContain('value="2026-12-01T18:00"');
  expect(edit.text).toContain('value="2026-12-05T20:00"');
});

test('the new-auction form is prefilled with the default shipping notice', async () => {
  const agent = await loginAsAdmin();
  const res = await agent.get('/admin/auctions/new').expect(200);
  expect(res.text).toMatch(/Shipping and handling costs are the winning bidder(&#39;|')s responsibility/);
});

test('an invalid auction form re-renders with the errors', async () => {
  const agent = await loginAsAdmin();
  const res = await agent.post('/admin/auctions').type('form')
    .send({ _csrf: await token(agent), title: '', starts_at: '2026-12-05T18:00', ends_at: '2026-12-01T18:00' })
    .expect(400);
  expect(res.text).toContain('Title is required.');
  expect(res.text).toContain('The auction must end after it starts.');
});

test('an item can be created with several photos; non-images are skipped', async () => {
  const auction = insertAuction(t());
  const agent = await loginAsAdmin();
  const csrf = await token(agent, `/admin/auctions/${auction.id}/items/new`);
  const res = await agent.post(`/admin/auctions/${auction.id}/items`)
    .field('_csrf', csrf)
    .field('title', 'Signed Helmet')
    .field('description', 'Legion of Boom era.')
    .field('starting_bid', '150')
    .attach('photos', PNG, 'front.png')
    .attach('photos', PNG, 'back.jpg')
    .attach('photos', Buffer.from('%PDF-1.4'), 'certificate.pdf')
    .expect(302);

  const item = t().prepare('SELECT * FROM auction_items').get();
  expect(res.headers.location).toBe(`/admin/auctions/${auction.id}/items/${item.id}`);
  expect(item).toMatchObject({ title: 'Signed Helmet', starting_bid_cents: 15000 });
  const photos = t().prepare('SELECT * FROM auction_item_photos WHERE item_id = ? ORDER BY sort_order').all(item.id);
  expect(photos).toHaveLength(2);
  expect(photos[0].url).toMatch(/^\/uploads\/.+\.png$/);

  const page = await agent.get(res.headers.location).expect(200);
  expect(page.text).toContain('certificate.pdf (not a JPG, PNG, GIF or WebP image)');
});

test('photos can be reordered and removed', async () => {
  const auction = insertAuction(t());
  const item = insertAuctionItem(t(), { auction_id: auction.id });
  t().prepare("INSERT INTO auction_item_photos (item_id, url, sort_order) VALUES (?, '/uploads/a.png', 1), (?, '/uploads/b.png', 2)").run(item.id, item.id);
  const [a, b] = t().prepare('SELECT id FROM auction_item_photos ORDER BY sort_order').all();
  const agent = await loginAsAdmin();
  const base = `/admin/auctions/${auction.id}/items/${item.id}`;

  await agent.post(`${base}/photos/${b.id}/move`).type('form').send({ _csrf: await token(agent, base), dir: 'up' }).expect(302);
  expect(t().prepare('SELECT url FROM auction_item_photos ORDER BY sort_order').all().map(r => r.url)).toEqual(['/uploads/b.png', '/uploads/a.png']);

  await agent.post(`${base}/photos/${a.id}/delete`).type('form').send({ _csrf: await token(agent, base) }).expect(302);
  expect(t().prepare('SELECT url FROM auction_item_photos').all().map(r => r.url)).toEqual(['/uploads/b.png']);
  expect(require('../../services/storage').deleteFile).toHaveBeenCalledWith('/uploads/a.png');
});

test('regression: single-image admin forms still upload after the multer change', async () => {
  const agent = await loginAsAdmin();
  const csrf = await token(agent, '/admin/gallery/new');
  await agent.post('/admin/gallery')
    .field('_csrf', csrf)
    .field('caption', 'Tailgate')
    .attach('image', PNG, 'tailgate.png')
    .expect(302);
  const row = t().prepare('SELECT * FROM gallery_images').get();
  expect(row.filename).toMatch(/^\/uploads\/.+\.png$/);
});

describe('with bids', () => {
  let auction, item, alice, bob;
  beforeEach(async () => {
    auction = insertAuction(t());
    item = insertAuctionItem(t(), { auction_id: auction.id, title: 'Helmet', starting_bid_cents: 2000 });
    alice = insertBidder(t(), { email: 'alice@example.com', name: 'Alice Able', phone: '406-555-0001' });
    bob = insertBidder(t(), { email: 'bob@example.com', name: 'Bob Baker', phone: '406-555-0002' });
    await auctionBids.placeBid({ auctionId: auction.id, itemId: item.id, bidderId: alice.id, amountRaw: '20', shippingAck: true });
    await auctionBids.placeBid({ auctionId: auction.id, itemId: item.id, bidderId: bob.id, amountRaw: '30', shippingAck: true });
  });

  test('the dashboard shows totals, the bid feed with names, and the leaderboard', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.get(`/admin/auctions/${auction.id}/dashboard`).expect(200);
    expect(res.text).toContain('$30');
    expect(res.text).toContain('#2 Bob Baker');
    expect(res.text).toContain('Committed (high bids)');
    expect(res.text).toContain('id="item-leaderboard"');
  });

  test('the main admin dashboard links to the live auction', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.get('/admin/dashboard').expect(200);
    expect(res.text).toContain(`/admin/auctions/${auction.id}/dashboard`);
    expect(res.text).toContain('Auction (live): 2 bids');
  });

  test('removing a bid needs a reason and restores the previous high bid', async () => {
    const agent = await loginAsAdmin();
    const bobBid = t().prepare('SELECT id FROM auction_bids WHERE bidder_id = ?').get(bob.id).id;
    const bidsPage = `/admin/auctions/${auction.id}/items/${item.id}/bids`;

    await agent.post(`/admin/auctions/${auction.id}/bids/${bobBid}/remove`).type('form')
      .send({ _csrf: await token(agent, bidsPage), reason: '' }).expect(302);
    expect(t().prepare('SELECT removed_at FROM auction_bids WHERE id = ?').get(bobBid).removed_at).toBeNull();

    await agent.post(`/admin/auctions/${auction.id}/bids/${bobBid}/remove`).type('form')
      .send({ _csrf: await token(agent, bidsPage), reason: 'Bidder typo' }).expect(302);
    expect(t().prepare('SELECT * FROM auction_items WHERE id = ?').get(item.id))
      .toMatchObject({ current_bid_cents: 2000, high_bidder_id: alice.id });
    const page = await agent.get(bidsPage).expect(200);
    expect(page.text).toContain('Bidder typo');
    expect(page.text).toContain('The high bid is now $20.');
  });

  test('an item with bids cannot be deleted', async () => {
    const agent = await loginAsAdmin();
    const base = `/admin/auctions/${auction.id}/items/${item.id}`;
    await agent.post(`${base}/delete`).type('form').send({ _csrf: await token(agent, base) }).expect(302);
    expect(t().prepare('SELECT COUNT(*) AS n FROM auction_items').get().n).toBe(1);
  });

  test('the winners CSV lists the high bidder with contact details', async () => {
    insertAuctionItem(t(), { auction_id: auction.id, title: 'Unsold Jersey' });
    const agent = await loginAsAdmin();
    const res = await agent.get(`/admin/auctions/${auction.id}/winners.csv`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.split('\n');
    expect(lines[0]).toBe('Item,Starting bid,Winning bid,Bids,Bidder #,Name,Email,Phone,Member #,Winner emailed');
    expect(lines).toContain('Helmet,20.00,30.00,2,2,Bob Baker,bob@example.com,406-555-0002,,');
    expect(lines.some(l => l.startsWith('Unsold Jersey,20.00,,0,'))).toBe(true);
  });

  test('Send Winner Emails is refused while bidding is open, then emails each winner once', async () => {
    const email = require('../../services/email');
    const agent = await loginAsAdmin();
    const winners = `/admin/auctions/${auction.id}/winners`;
    await agent.post(`/admin/auctions/${auction.id}/send-winner-emails`).type('form')
      .send({ _csrf: await token(agent, winners) }).expect(302);
    expect(email.sendAuctionWinnerEmail).not.toHaveBeenCalled();

    t().prepare('UPDATE auctions SET ends_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), auction.id);
    await agent.post(`/admin/auctions/${auction.id}/send-winner-emails`).type('form')
      .send({ _csrf: await token(agent, winners) }).expect(302);
    expect(email.sendAuctionWinnerEmail).toHaveBeenCalledTimes(1);
    expect(email.sendAuctionWinnerEmail.mock.calls[0][0].bidder.email).toBe('bob@example.com');
    const page = await agent.get(winners).expect(200);
    expect(page.text).toContain('Sent 1 winner email.');
    expect(t().prepare('SELECT winners_notified_at FROM auctions WHERE id = ?').get(auction.id).winners_notified_at).toBeTruthy();
  });

  test('blocking a bidder stops their next bid', async () => {
    const agent = await loginAsAdmin();
    const page = `/admin/auctions/${auction.id}/bidders`;
    const list = await agent.get(page).expect(200);
    expect(list.text).toContain('Alice Able');
    await agent.post(`${page}/${alice.id}/block`).type('form').send({ _csrf: await token(agent, page) }).expect(302);
    const res = await auctionBids.placeBid({ auctionId: auction.id, itemId: item.id, bidderId: alice.id, amountRaw: '50', shippingAck: true });
    expect(res.code).toBe('blocked');
  });
});
