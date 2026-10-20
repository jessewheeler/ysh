const hub = require('../../services/auctionHub');

function fakeRes() {
  return { chunks: [], write(c) { this.chunks.push(c); }, text() { return this.chunks.join(''); } };
}

afterEach(() => hub._reset());

test('broadcast reaches every public page on that auction only', () => {
  const a = fakeRes();
  const b = fakeRes();
  const other = fakeRes();
  const admin = fakeRes();
  hub.subscribe(1, a);
  hub.subscribe(1, b, { bidderId: 7 });
  hub.subscribe(2, other);
  hub.subscribe(1, admin, { admin: true });

  hub.broadcast(1, 'bid', { item_id: 3, current_bid_cents: 2500 });

  expect(a.text()).toMatch(/^id: \d+\nevent: bid\ndata: \{"item_id":3,"current_bid_cents":2500\}\n\n$/);
  expect(b.text()).toContain('event: bid');
  expect(other.text()).toBe('');
  expect(admin.text()).toBe('');
});

test('broadcastAdmin reaches only admin dashboards', () => {
  const pub = fakeRes();
  const admin = fakeRes();
  hub.subscribe(1, pub);
  hub.subscribe(1, admin, { admin: true });
  hub.broadcastAdmin(1, 'admin_bid', { bidder_name: 'Alice' });
  expect(admin.text()).toContain('Alice');
  expect(pub.text()).toBe('');
});

test('sendToBidder reaches every tab of that bidder and nobody else', () => {
  const tab1 = fakeRes();
  const tab2 = fakeRes();
  const someoneElse = fakeRes();
  const anon = fakeRes();
  hub.subscribe(1, tab1, { bidderId: 7 });
  hub.subscribe(1, tab2, { bidderId: '7' });
  hub.subscribe(1, someoneElse, { bidderId: 8 });
  hub.subscribe(1, anon);

  hub.sendToBidder(1, 7, 'outbid', { item_id: 3 });

  expect(tab1.text()).toContain('event: outbid');
  expect(tab2.text()).toContain('event: outbid');
  expect(someoneElse.text()).toBe('');
  expect(anon.text()).toBe('');
});

test('unsubscribe stops delivery and drops the connection count', () => {
  const a = fakeRes();
  const off = hub.subscribe(1, a);
  expect(hub.connectionCount()).toBe(1);
  off();
  hub.broadcast(1, 'bid', {});
  expect(a.text()).toBe('');
  expect(hub.connectionCount()).toBe(0);
});

test('a socket that throws on write does not stop the others', () => {
  const broken = { write() { throw new Error('EPIPE'); } };
  const ok = fakeRes();
  hub.subscribe(1, broken);
  hub.subscribe(1, ok);
  expect(() => hub.broadcast(1, 'bid', {})).not.toThrow();
  expect(ok.text()).toContain('event: bid');
});

test('heartbeats keep idle streams open', () => {
  jest.useFakeTimers();
  try {
    const a = fakeRes();
    hub.subscribe(1, a);
    jest.advanceTimersByTime(hub.HEARTBEAT_MS);
    expect(a.text()).toBe(': ping\n\n');
  } finally {
    hub._reset();
    jest.useRealTimers();
  }
});
