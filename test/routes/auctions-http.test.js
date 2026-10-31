/**
 * HTTP integration tests for the public silent auction pages (issue #119): the real Express
 * app, sessions, CSRF and Pug rendering, against the in-memory SQLite proxy.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/email', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue({}),
  sendBidderOtpEmail: jest.fn().mockResolvedValue({}),
  sendOutbidEmail: jest.fn().mockResolvedValue({}),
  sendAuctionWinnerEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const { insertAuction, insertAuctionItem, insertBidder, insertAdmin } = require('../helpers/fixtures');

const NOTICE = 'Shipping and handling costs are the winning bidder\'s responsibility.';

function tokenFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error('No CSRF token in response');
  return match[1];
}

async function csrf(agent) {
  return (await agent.get('/auctions/csrf').expect(200)).body.token;
}

/** Signs a bidder in through the real emailed-code flow (the code is 000000 in test). */
async function loginAsBidder({ email = 'barb@example.com', name = 'Barb Bidder', phone = '406-555-0100', returnTo } = {}) {
  const agent = request.agent(app);
  const page = await agent.get(`/auctions/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`).expect(200);
  await agent.post('/auctions/login').type('form')
    .send({ _csrf: tokenFrom(page.text), email, name, phone })
    .expect(302).expect('location', '/auctions/login/verify');
  const verify = await agent.get('/auctions/login/verify').expect(200);
  const res = await agent.post('/auctions/login/verify').type('form')
    .send({ _csrf: tokenFrom(verify.text), code: '000000' })
    .expect(302);
  return { agent, location: res.headers.location };
}

let auction;
let item;

beforeEach(() => {
  db.__resetTestDb();
  const t = db.__getCurrentDb();
  auction = insertAuction(t, { shipping_notice: NOTICE });
  item = insertAuctionItem(t, { auction_id: auction.id, title: 'Signed Helmet', starting_bid_cents: 2000 });
});

describe('pages', () => {
  test('the Charitable Work menu links to a published auction and the landing page shows the shipping notice', async () => {
    const home = await request(app).get('/').expect(200);
    const charitableMenu = home.text.match(/<ul class="dropdown-menu" id="menu-charitable">([\s\S]*?)<\/ul>/);
    expect(charitableMenu[1]).toContain(`href="/auctions/${auction.id}"`);
    expect(home.text).not.toContain('nav-live-badge');

    const res = await request(app).get(`/auctions/${auction.id}`).expect(200);
    expect(res.text).toContain('Holiday Silent Auction');
    // A live auction has no "Live" pill; the countdown says it.
    expect(res.text).not.toContain('auction-badge');
    expect(res.text).toContain('Signed Helmet');
    // The shipping notice is on item pages only.
    expect(res.text).not.toContain(NOTICE);
  });

  test('/auctions redirects to the current auction', async () => {
    await request(app).get('/auctions').expect(302).expect('location', `/auctions/${auction.id}`);
  });

  test('the item page shows the shipping notice, starting bid and a sign-in link', async () => {
    const res = await request(app).get(`/auctions/${auction.id}/items/${item.id}`).expect(200);
    expect(res.text).toContain(NOTICE);
    expect(res.text).toContain('$20');
    expect(res.text).toContain('Sign in to bid');
    expect(res.text).not.toContain('data-bid-form');
  });

  test('a draft auction is a 404 to the public but previewable by an admin', async () => {
    const t = db.__getCurrentDb();
    const draft = insertAuction(t, { title: 'Secret Draft', status: 'draft' });
    await request(app).get(`/auctions/${draft.id}`).expect(404);

    insertAdmin(t, { email: 'admin@ysh.test' });
    const agent = request.agent(app);
    const login = await agent.get('/admin/login');
    await agent.post('/admin/login').type('form').send({ _csrf: tokenFrom(login.text), email: 'admin@ysh.test' });
    const verify = await agent.get('/admin/login/verify');
    await agent.post('/admin/login/verify').type('form').send({ _csrf: tokenFrom(verify.text), code: '000000' });
    const res = await agent.get(`/auctions/${draft.id}`).expect(200);
    expect(res.text).toContain('Draft preview');
  });

  test('a closed auction shows no bid form', async () => {
    db.__getCurrentDb().prepare('UPDATE auctions SET ends_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), auction.id);
    const { agent } = await loginAsBidder();
    const res = await agent.get(`/auctions/${auction.id}/items/${item.id}`).expect(200);
    expect(res.text).toContain('Bidding closed');
    expect(res.text).not.toContain('data-bid-form');
  });

  test('withdrawn items are hidden', async () => {
    db.__getCurrentDb().prepare('UPDATE auction_items SET withdrawn = 1 WHERE id = ?').run(item.id);
    const res = await request(app).get(`/auctions/${auction.id}`).expect(200);
    expect(res.text).not.toContain('Signed Helmet');
    await request(app).get(`/auctions/${auction.id}/items/${item.id}`).expect(404);
  });
});

describe('bidder sign-in', () => {
  test('emails a code with an auction subject and signs the bidder in', async () => {
    const email = require('../../services/email');
    const { agent, location } = await loginAsBidder({ returnTo: `/auctions/${auction.id}/items/${item.id}` });
    expect(location).toBe(`/auctions/${auction.id}/items/${item.id}`);
    // In test the code is logged rather than mailed, like admin login.
    expect(email.sendOtpEmail).not.toHaveBeenCalled();

    const row = db.__getCurrentDb().prepare('SELECT * FROM auction_bidders WHERE email = ?').get('barb@example.com');
    expect(row).toMatchObject({ name: 'Barb Bidder', phone: '406-555-0100' });
    expect(row.verified_at).toBeTruthy();

    const page = await agent.get(`/auctions/${auction.id}/items/${item.id}`).expect(200);
    expect(page.text).toContain('data-bid-form');
  });

  test('the bidder email function uses an auction subject, not the admin one', () => {
    const src = require('fs').readFileSync(require.resolve('../../services/email'), 'utf8');
    const fn = src.slice(src.indexOf('async function sendBidderOtpEmail'), src.indexOf('async function sendRenewalReminderEmail'));
    expect(fn).toContain('Your YSH Auction Sign-In Code');
    expect(fn).not.toMatch(/Admin/);
  });

  test('links a bidder to the member with the same email', async () => {
    const t = db.__getCurrentDb();
    t.prepare("INSERT INTO members (first_name, last_name, email, status) VALUES ('Mo', 'Member', 'mo@example.com', 'active')").run();
    await loginAsBidder({ email: 'mo@example.com', name: 'Mo Member' });
    const bidder = t.prepare('SELECT * FROM auction_bidders WHERE email = ?').get('mo@example.com');
    expect(bidder.member_id).toBeTruthy();
  });

  test('requires a name and a phone number', async () => {
    const agent = request.agent(app);
    const page = await agent.get('/auctions/login');
    const res = await agent.post('/auctions/login').type('form')
      .send({ _csrf: tokenFrom(page.text), email: 'x@example.com', name: '', phone: '' })
      .expect(400);
    expect(res.text).toContain('Your name is required.');
    expect(res.text).toContain('A phone number is required');
  });

  test('a wrong code does not sign in, and the pending name is not saved over a verified one', async () => {
    insertBidder(db.__getCurrentDb(), { email: 'v@example.com', name: 'Real Name' });
    const agent = request.agent(app);
    const page = await agent.get('/auctions/login');
    await agent.post('/auctions/login').type('form')
      .send({ _csrf: tokenFrom(page.text), email: 'v@example.com', name: 'Impostor', phone: '406-555-9999' });
    const verify = await agent.get('/auctions/login/verify');
    await agent.post('/auctions/login/verify').type('form')
      .send({ _csrf: tokenFrom(verify.text), code: '111111' })
      .expect(302).expect('location', '/auctions/login/verify');
    const row = db.__getCurrentDb().prepare('SELECT * FROM auction_bidders WHERE email = ?').get('v@example.com');
    expect(row.name).toBe('Real Name');
  });
});

describe('bidding', () => {
  const bidUrl = () => `/auctions/${auction.id}/items/${item.id}/bids`;

  test('an anonymous form post is sent to sign in and comes back afterwards', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    await agent.post(bidUrl()).type('form')
      .set('Referer', `http://127.0.0.1/auctions/${auction.id}/items/${item.id}`)
      .send({ _csrf: token, amount: '20', shipping_ack: '1' })
      .expect(302).expect('location', '/auctions/login');

    const page = await agent.get('/auctions/login').expect(200);
    await agent.post('/auctions/login').type('form')
      .send({ _csrf: tokenFrom(page.text), email: 'late@example.com', name: 'Late', phone: '406-555-0101' });
    const verify = await agent.get('/auctions/login/verify');
    await agent.post('/auctions/login/verify').type('form')
      .send({ _csrf: tokenFrom(verify.text), code: '000000' })
      .expect(302).expect('location', `/auctions/${auction.id}/items/${item.id}`);
  });

  test('an anonymous JSON bid gets a 401 with a login URL', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    const res = await agent.post(bidUrl()).set('Accept', 'application/json').set('x-csrf-token', token)
      .type('form').send({ amount: '20' }).expect(401);
    expect(res.body).toMatchObject({ ok: false, code: 'login_required' });
    expect(res.body.loginUrl).toMatch(/^\/auctions\/login/);
  });

  test('a no-JS bid redirects back with a confirmation that repeats the shipping notice', async () => {
    const { agent } = await loginAsBidder();
    const page = await agent.get(`/auctions/${auction.id}/items/${item.id}`);
    await agent.post(bidUrl()).type('form')
      .send({ _csrf: tokenFrom(page.text), amount: '25', shipping_ack: '1' })
      .expect(302).expect('location', `/auctions/${auction.id}/items/${item.id}`);
    const after = await agent.get(`/auctions/${auction.id}/items/${item.id}`).expect(200);
    expect(after.text).toContain('is the high bid.');
    expect(after.text).toContain('You are Bidder #1');
    expect(after.text.split(NOTICE).length - 1).toBeGreaterThanOrEqual(2);
    expect(after.text).toContain('$25');
  });

  test('without the shipping acknowledgement the first bid is refused', async () => {
    const { agent } = await loginAsBidder();
    const token = await csrf(agent);
    const res = await agent.post(bidUrl()).set('Accept', 'application/json').set('x-csrf-token', token)
      .type('form').send({ amount: '25' }).expect(409);
    expect(res.body.code).toBe('ack_required');
  });

  test('JSON bids work repeatedly by re-fetching the token, as a second tab would', async () => {
    const { agent } = await loginAsBidder();
    const other = await loginAsBidder({ email: 'other@example.com', name: 'Other' });

    const first = await agent.post(bidUrl()).set('Accept', 'application/json').set('x-csrf-token', await csrf(agent))
      .type('form').send({ amount: '20', shipping_ack: '1' }).expect(200);
    expect(first.body).toMatchObject({ ok: true, paddle: 1, shipping_notice: NOTICE });
    expect(first.body.state).toMatchObject({ current_bid_cents: 2000, min_next_cents: 2500, high_paddle: 1 });
    expect(first.body.state).not.toHaveProperty('high_bidder_id');

    await other.agent.post(bidUrl()).set('Accept', 'application/json').set('x-csrf-token', await csrf(other.agent))
      .type('form').send({ amount: '30', shipping_ack: '1' }).expect(200);

    const second = await agent.post(bidUrl()).set('Accept', 'application/json').set('x-csrf-token', await csrf(agent))
      .type('form').send({ amount: '32' }).expect(409);
    expect(second.body).toMatchObject({ code: 'too_low', min_next_cents: 3500 });

    const third = await agent.post(bidUrl()).set('Accept', 'application/json').set('x-csrf-token', await csrf(agent))
      .type('form').send({ amount: '35' }).expect(200);
    expect(third.body.state.current_bid_cents).toBe(3500);
  });

  test('a stale CSRF token on a JSON bid gets a 403, not a redirect', async () => {
    const { agent } = await loginAsBidder();
    const res = await agent.post(bidUrl()).set('Accept', 'application/json').set('x-csrf-token', 'stale')
      .type('form').send({ amount: '20' }).expect(403);
    expect(res.body.code).toBe('csrf');
  });

  test('a bid after the close is refused', async () => {
    const { agent } = await loginAsBidder();
    db.__getCurrentDb().prepare('UPDATE auctions SET ends_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 1).toISOString(), auction.id);
    const res = await agent.post(bidUrl()).set('Accept', 'application/json').set('x-csrf-token', await csrf(agent))
      .type('form').send({ amount: '20', shipping_ack: '1' }).expect(409);
    expect(res.body.code).toBe('closed');
  });

  test('public bid history shows bidder numbers, never names or emails', async () => {
    const { agent } = await loginAsBidder({ email: 'secret.person@example.com', name: 'Secret Person' });
    await agent.post(bidUrl()).set('Accept', 'application/json').set('x-csrf-token', await csrf(agent))
      .type('form').send({ amount: '20', shipping_ack: '1' }).expect(200);
    const res = await request(app).get(`/auctions/${auction.id}/items/${item.id}`).expect(200);
    expect(res.text).toContain('Bidder #1');
    expect(res.text).not.toContain('Secret Person');
    expect(res.text).not.toContain('secret.person@example.com');
  });
});

describe('live updates (Server-Sent Events)', () => {
  const http = require('http');
  const hub = require('../../services/auctionHub');
  let server;
  let base;

  beforeAll(done => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });
  afterAll(done => {
    hub._reset();
    server.close(done);
  });

  /** Opens a stream and collects parsed events until `count` have arrived. */
  function openStream(path, cookie) {
    const events = [];
    let waiter = null;
    const req = http.get(`${base}${path}`, { headers: { Accept: 'text/event-stream', ...(cookie ? { Cookie: cookie } : {}) } });
    const ready = new Promise((resolve, reject) => {
      req.on('response', res => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          buf += chunk;
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const ev = /event: (.+)/.exec(frame);
            const data = /data: (.+)/.exec(frame);
            if (ev && data) events.push({ event: ev[1], data: JSON.parse(data[1]) });
            if (waiter && waiter.check()) waiter.resolve();
          }
        });
        resolve(res);
      });
      req.on('error', reject);
    });
    return {
      ready,
      events,
      until(pred, ms = 3000) {
        if (pred(events)) return Promise.resolve();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`timed out; got ${JSON.stringify(events.map(e => e.event))}`)), ms);
          waiter = { check: () => pred(events), resolve: () => { clearTimeout(timer); waiter = null; resolve(); } };
        });
      },
      close() { req.destroy(); },
    };
  }

  function cookieOf(agent) {
    return agent.jar.getCookies({ domain: '127.0.0.1', path: '/', script: false, secure: false })
      .map(c => `${c.name}=${c.value}`).join('; ');
  }

  test('sends stream headers and a snapshot, then each bid as it lands', async () => {
    const stream = openStream(`/auctions/${auction.id}/stream`);
    const res = await stream.ready;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['cache-control']).toContain('no-cache');
    expect(res.headers['x-accel-buffering']).toBe('no');

    await stream.until(ev => ev.some(e => e.event === 'snapshot'));
    const snapshot = stream.events.find(e => e.event === 'snapshot').data;
    expect(snapshot.auction).toMatchObject({ id: auction.id, phase: 'live' });
    expect(snapshot.items).toEqual([expect.objectContaining({ item_id: item.id, current_bid_cents: null, min_next_cents: 2000 })]);
    expect(snapshot.my_paddle).toBeNull();

    const { agent } = await loginAsBidder({ email: 'secret.person@example.com', name: 'Secret Person' });
    await agent.post(`/auctions/${auction.id}/items/${item.id}/bids`).set('Accept', 'application/json')
      .set('x-csrf-token', await csrf(agent)).type('form').send({ amount: '20', shipping_ack: '1' }).expect(200);

    await stream.until(ev => ev.some(e => e.event === 'bid'));
    const bid = stream.events.find(e => e.event === 'bid').data;
    expect(bid).toMatchObject({ item_id: item.id, current_bid_cents: 2000, min_next_cents: 2500, high_paddle: 1, bid_count: 1 });
    expect(JSON.stringify(stream.events)).not.toMatch(/Secret Person|secret\.person|high_bidder_id/);
    stream.close();
  });

  test('the outbid bidder\'s stream gets an outbid event; the new leader\'s does not', async () => {
    const alice = await loginAsBidder({ email: 'alice@example.com', name: 'Alice' });
    const bob = await loginAsBidder({ email: 'bob@example.com', name: 'Bob' });
    const bidUrl = `/auctions/${auction.id}/items/${item.id}/bids`;
    await alice.agent.post(bidUrl).set('Accept', 'application/json').set('x-csrf-token', await csrf(alice.agent))
      .type('form').send({ amount: '20', shipping_ack: '1' }).expect(200);

    const aliceStream = openStream(`/auctions/${auction.id}/stream`, cookieOf(alice.agent));
    const bobStream = openStream(`/auctions/${auction.id}/stream`, cookieOf(bob.agent));
    await aliceStream.until(ev => ev.some(e => e.event === 'snapshot'));
    await bobStream.until(ev => ev.some(e => e.event === 'snapshot'));
    expect(aliceStream.events[0].data.my_paddle).toBe(1);

    await bob.agent.post(bidUrl).set('Accept', 'application/json').set('x-csrf-token', await csrf(bob.agent))
      .type('form').send({ amount: '30', shipping_ack: '1' }).expect(200);

    await aliceStream.until(ev => ev.some(e => e.event === 'outbid'));
    expect(aliceStream.events.find(e => e.event === 'outbid').data).toMatchObject({ item_id: item.id, current_bid_cents: 3000, min_next_cents: 3500 });
    await bobStream.until(ev => ev.some(e => e.event === 'bid'));
    expect(bobStream.events.some(e => e.event === 'outbid')).toBe(false);
    aliceStream.close();
    bobStream.close();
  });

  test('a draft auction has no public stream', async () => {
    const draft = insertAuction(db.__getCurrentDb(), { status: 'draft' });
    const stream = openStream(`/auctions/${draft.id}/stream`);
    expect((await stream.ready).statusCode).toBe(404);
    stream.close();
  });

  test('the admin stream needs an admin', async () => {
    const stream = openStream(`/admin/auctions/${auction.id}/stream`);
    const res = await stream.ready;
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
    stream.close();
  });

  test('closing streams frees their connections', async () => {
    const stream = openStream(`/auctions/${auction.id}/stream`);
    await stream.until(ev => ev.length > 0);
    expect(hub.connectionCount()).toBeGreaterThanOrEqual(1);
    stream.close();
    await new Promise(r => setTimeout(r, 100));
    expect(hub.connectionCount()).toBe(0);
  });
});

describe('changes from the 2026-10-26 bidding test', () => {
  test('bidder sign-in shows no captcha even when hCaptcha is configured', async () => {
    process.env.HCAPTCHA_SITE_KEY = 'site-key';
    try {
      const res = await request(app).get('/auctions/login').expect(200);
      expect(res.text).not.toContain('h-captcha');
    } finally {
      delete process.env.HCAPTCHA_SITE_KEY;
    }
  });

  test('a filled honeypot looks like success but sends nothing and creates no bidder', async () => {
    const emailSvc = require('../../services/email');
    emailSvc.sendBidderOtpEmail.mockClear();
    const agent = request.agent(app);
    const page = await agent.get('/auctions/login').expect(200);
    expect(page.text).toContain('name="website"');
    const res = await agent.post('/auctions/login').type('form').send({
      _csrf: tokenFrom(page.text), name: 'Spam Bot', email: 'victim@example.com', phone: '406-555-0100', website: 'http://spam.example',
    }).expect(302);
    expect(res.headers.location).toBe('/auctions/login');
    expect(emailSvc.sendBidderOtpEmail).not.toHaveBeenCalled();
    expect(db.__getCurrentDb().prepare('SELECT COUNT(*) AS n FROM auction_bidders').get().n).toBe(0);
  });

  test('only a signed-in bidder sees when outbid emails stop, and only on item pages', async () => {
    const t = db.__getCurrentDb();
    const botb = insertAuction(t, { starts_at: '2026-11-01T19:00:00.000Z', ends_at: '2099-11-08T23:00:00.000Z' });
    const ball = insertAuctionItem(t, { auction_id: botb.id, title: 'Game Ball' });
    const itemUrl = `/auctions/${botb.id}/items/${ball.id}`;

    const anonItem = await request(app).get(itemUrl).expect(200);
    expect(anonItem.text).not.toContain('data-outbid-notice');
    expect(anonItem.text).toContain('data-item-title="Game Ball"');

    const { agent } = await loginAsBidder();
    const itemPage = await agent.get(itemUrl).expect(200);
    expect(itemPage.text).toContain('data-outbid-notice');
    expect(itemPage.text).toMatch(/through Saturday, November 7\. On closing day, Sunday, November 8, the emails stop/);
    const page = await agent.get(`/auctions/${botb.id}`).expect(200);
    expect(page.text).not.toContain('data-outbid-notice');
  });

  test('the auction description keeps its paragraphs', async () => {
    const t = db.__getCurrentDb();
    t.prepare('UPDATE auctions SET description = ? WHERE id = ?').run('First paragraph.\r\n\r\nSecond paragraph.', auction.id);
    const res = await request(app).get(`/auctions/${auction.id}`).expect(200);
    expect(res.text).toMatch(/<div class="auction-description"><p>First paragraph\.<\/p><p>Second paragraph\.<\/p><\/div>/);
  });

  test('/state returns the stream snapshot as JSON, with my paddle only when signed in', async () => {
    const anon = await request(app).get(`/auctions/${auction.id}/state`).expect(200).expect('Content-Type', /json/);
    expect(anon.headers['cache-control']).toBe('no-store');
    expect(anon.body).toMatchObject({
      auction: { id: auction.id, phase: 'live' },
      items: [expect.objectContaining({ item_id: item.id, starting_bid_cents: 2000, high_paddle: null })],
      my_paddle: null,
    });
    expect(Date.parse(anon.body.server_now)).not.toBeNaN();

    const { agent } = await loginAsBidder({ returnTo: `/auctions/${auction.id}/items/${item.id}` });
    const page = await agent.get(`/auctions/${auction.id}/items/${item.id}`);
    await agent.post(`/auctions/${auction.id}/items/${item.id}/bids`).type('form')
      .send({ _csrf: tokenFrom(page.text), amount: '20', shipping_ack: '1' });
    const mine = await agent.get(`/auctions/${auction.id}/state`).expect(200);
    expect(mine.body.my_paddle).toBe(1);
    expect(mine.body.items[0].high_paddle).toBe(1);
  });

  test('/state is a 404 for a draft auction', async () => {
    const draft = insertAuction(db.__getCurrentDb(), { status: 'draft' });
    await request(app).get(`/auctions/${draft.id}/state`).expect(404);
  });
});
