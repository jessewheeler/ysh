/**
 * In-process fan-out of live auction events over Server-Sent Events (issue #119).
 *
 * Every open auction page holds one GET /auctions/:id/stream response; this module keeps those
 * responses and writes events to them. That is correct only while one Node process serves every
 * connection — true on Render today, where the web service has a persistent disk and so cannot
 * scale past one instance. If that changes, live pushes would reach only the clients on the
 * instance that took the bid (bids themselves stay correct); the fix is PostgreSQL LISTEN/NOTIFY
 * inside this module. See docs/auction.md.
 *
 * Admin dashboards subscribe on a separate channel and receive events with bidder names; the
 * public channel only ever carries paddle numbers.
 */

const HEARTBEAT_MS = 20 * 1000;
const STREAM_PADDING = `:${' '.repeat(2048)}\n\n`;
const MAX_CONNECTIONS = Number(process.env.AUCTION_SSE_MAX) || 1000;

// auctionId -> Set<{ res, bidderId, admin }>
const channels = new Map();
let eventId = 0;
let heartbeat = null;

function connectionCount() {
  let n = 0;
  for (const set of channels.values()) n += set.size;
  return n;
}

function frame(event, data) {
  eventId += 1;
  return `id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function write(conn, chunk) {
  try {
    conn.res.write(chunk);
  } catch (_e) {
    // A dead socket is dropped when its 'close' event fires.
  }
}

function ensureHeartbeat() {
  if (heartbeat) return;
  // A ping every 20s keeps Render's proxy (and phone carriers) from timing out an idle stream.
  // It's a named event, not a comment, so the page can tell a quiet stream from a blocked one
  // and fall back to polling. unref() so the timer never holds Jest or a script open.
  heartbeat = setInterval(() => {
    for (const set of channels.values()) {
      for (const conn of set) write(conn, 'event: ping\ndata: {}\n\n');
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
}

/**
 * Registers an open stream. Returns an unsubscribe function, or null when the server is at its
 * connection cap (the caller answers 503 and the browser retries).
 */
function subscribe(auctionId, res, { bidderId = null, admin = false } = {}) {
  if (connectionCount() >= MAX_CONNECTIONS) return null;
  const key = Number(auctionId);
  if (!channels.has(key)) channels.set(key, new Set());
  const conn = { res, bidderId: bidderId == null ? null : Number(bidderId), admin };
  channels.get(key).add(conn);
  ensureHeartbeat();
  return () => {
    const set = channels.get(key);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) channels.delete(key);
    if (channels.size === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
}

/** Sends an event to every public (non-admin) page watching an auction. */
function broadcast(auctionId, event, data) {
  const set = channels.get(Number(auctionId));
  if (!set) return;
  const chunk = frame(event, data);
  for (const conn of set) if (!conn.admin) write(conn, chunk);
}

/** Sends an event to every admin dashboard watching an auction. */
function broadcastAdmin(auctionId, event, data) {
  const set = channels.get(Number(auctionId));
  if (!set) return;
  const chunk = frame(event, data);
  for (const conn of set) if (conn.admin) write(conn, chunk);
}

/** Sends an event only to one bidder's open pages (every tab and device they're signed in on). */
function sendToBidder(auctionId, bidderId, event, data) {
  const set = channels.get(Number(auctionId));
  if (!set) return;
  const chunk = frame(event, data);
  for (const conn of set) if (!conn.admin && conn.bidderId === Number(bidderId)) write(conn, chunk);
}

/** Writes one event to a single stream (the snapshot sent when it opens). */
function sendTo(res, event, data) {
  write({ res }, frame(event, data));
}

/**
 * Turns a request into an event stream for an auction: headers, the reconnect delay, a
 * `snapshot` event with the current state, then live events until the browser goes away.
 * Responds 503 at the connection cap, which the browser's EventSource retries.
 */
function open(_req, res, auctionId, { bidderId = null, admin = false, snapshot }) {
  const unsubscribe = subscribe(auctionId, res, { bidderId, admin });
  if (!unsubscribe) {
    res.status(503).set('Retry-After', '10').end();
    return;
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tell any buffering proxy (nginx, some CDNs) to pass events straight through.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  // Some proxies and security software hold a response until a few KB arrive. Padding up
  // front gets the stream past them so events flow from the first one.
  res.write(STREAM_PADDING);
  sendTo(res, 'snapshot', snapshot);
  // res, not req: the response's 'close' is what reliably fires when the browser disconnects.
  res.on('close', unsubscribe);
}

/** Test helper: forget every connection. */
function _reset() {
  channels.clear();
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

module.exports = { STREAM_PADDING, open, subscribe, broadcast, broadcastAdmin, sendToBidder, sendTo, connectionCount, _reset, HEARTBEAT_MS };
