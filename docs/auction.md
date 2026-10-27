# Silent auction

Issue #119. An admin sets up an auction with a bidding window and items (photos, a starting bid,
a description). Anyone can bid once they've proved they own an email address. Pages update live,
so a bidder sees when they've been outbid. Payment isn't taken online: admins contact the winners.

## Pieces

| Piece | Where |
|---|---|
| Tables | `auctions`, `auction_items`, `auction_item_photos`, `auction_bidders`, `auction_paddles`, `auction_bids`, `auction_outbid_notices` (`db/schema.js`) |
| Rules: phase, form parsing, minimum bid | `services/auctions.js` |
| Placing and removing bids | `services/auctionBids.js` |
| Live updates | `services/auctionHub.js` (fan-out), `services/auctionNotifier.js` (what to send) |
| Admin dashboard numbers | `services/auctionDashboard.js` |
| Montana time ↔ UTC | `services/timezone.js` |
| Public pages and bidder sign-in | `routes/auctions.js`, `views/auctions/`, `public/js/auction.js` |
| Admin | `routes/adminAuctions.js` (mounted at `/admin/auctions`), `views/admin/auctions/`, `public/js/admin-auction.js` |

## Time

Admins type the start and end as Montana wall-clock time in `datetime-local` inputs.
`denverInputToUtcIso` converts them, and the database stores UTC ISO strings
(`starts_at`, `ends_at`, `placed_at`, and so on). Those columns have no SQL default, so they stay
TEXT in PostgreSQL. They are only ever compared against ISO strings computed in JavaScript, never
`datetime('now')`, because that comparison doesn't survive the translation to PostgreSQL (see the
PR #69 revert). DST edge cases:
- A time in the spring-forward gap rolls an hour later.
- The repeated hour on the fall-back night means the first (MDT) occurrence.

## Bidding

- Bids are whole dollars.
- The first bid on an item must be at least the starting bid. Each later bid must beat the
  current one by the auction's minimum increment.
- The current high bidder can't bid again on that item. There is no proxy (maximum) bidding.
- A bidder's first bid in an auction gives them a **paddle**, the anonymous "Bidder #N" shown
  publicly. Getting a paddle requires ticking the shipping and handling acknowledgement, which is
  stored in `auction_paddles.shipping_ack_at`.
- **Hard close.** Every item ends at `ends_at`. A bid is a single compare-and-swap
  `UPDATE auction_items … WHERE current_bid_cents = <what we read> AND high_bidder_id = <what we read>
  AND <auction is open now>` (`auctionItems.casHighBid`). That makes it safe against two people
  bidding at once, and it refuses a bid at or after `ends_at` even if the request was already in
  flight. If the swap loses, the bid re-reads the item and re-checks, up to three times. A higher
  bid still lands; one that has become too low gets the new minimum back.
- In SQLite the transaction body must stay free of real I/O (email, storage, fetch). The adapter
  shares one connection, so awaiting anything else lets other requests' statements run inside the
  transaction.

An admin can remove a bad bid with a reason. The row stays, marked removed. The item's high bid
is recomputed from the remaining live bids, and the audit log records who did it. Nobody is
emailed.

## Shipping and handling

Each auction has a `shipping_notice`, prefilled with `DEFAULT_SHIPPING_NOTICE`. It is shown on:
- the auction page
- every item page
- the bid confirmation (both the HTML page and the JSON response)
- the outbid and winner emails

## Bidder sign-in

A bidder signs in with their name, email and phone (phone is required so winners can be reached).
They get a 6-digit code by email. It is the same scheme as admin login: `services/auth.js`
`issueOtp`/`checkOtp` over the `auction_bidders` table, with code `000000` under development and
test. Name and phone are saved only after the code is verified, so typing someone else's email
can't rename them. A bidder whose email matches a member is linked through
`auction_bidders.member_id`.

There is no captcha. The board dropped it after the 2026-10-26 test: the emailed code already
proves the address, and the limits below cap abuse.

Rate limits are set for a crowd sharing one venue Wi-Fi address (`server.js`). Only form posts
count, and page loads don't.
- Sign-in posts: 150 per IP address per 15 minutes.
- Codes sent to one email: 5 per 15 minutes.
- Bids: 20 per minute, counted per signed-in bidder rather than per IP address.

The admin login limit (10 per IP address) would lock a room out after a handful of sign-ins.

The bid form posts normally without JavaScript. With JavaScript, `public/js/auction.js` posts it
with `fetch()` and first fetches a fresh token from `GET /auctions/csrf`. The CSRF token rotates
after every POST, so without that a second bid, or a bid from a second tab, would fail. A JSON
request that fails CSRF gets `403 {code: 'csrf'}` rather than the usual redirect.

## Live updates and the single-instance assumption

Every open auction page holds a `GET /auctions/:id/stream` Server-Sent Events response.
`services/auctionHub.js` keeps those responses in memory and writes events to them:

| Event | Who gets it | Payload |
|---|---|---|
| `snapshot` | the new connection | current state, sent on every (re)connect |
| `bid` | every public page | price, minimum next bid, count, high paddle — never a bidder id, name or email |
| `outbid` | only the previous high bidder's pages | item, new price, minimum to retake the lead |
| `item` | every public page | an item was withdrawn |
| `auction` | everyone | the window was edited |
| `closed` | everyone | sent by the close job |
| `admin_bid` / `admin_refresh` | admin dashboards (`/admin/auctions/:id/stream`) | totals, the leaderboard row and the bid with the bidder's name |

A `ping` event goes out every 20 seconds so Render's proxy doesn't cut idle streams, and the
stream opens with 2 KB of padding to get past proxies that buffer small responses. Phones
reconnect when the page becomes visible again, and the snapshot catches them up.

**Polling fallback.** At the 2026-10-26 test the stream never reached a work PC behind a proxy:
the countdown ran but prices only changed on refresh. `public/js/auction.js` now falls back to
polling `GET /auctions/:id/state` (the same snapshot, as JSON) every 10 seconds when no snapshot
arrives within 10 seconds or the stream goes quiet for 60, and keeps retrying the stream. While
polling it works out the outbid banner from the item's high paddle. Bid history rows aren't
added while polling; they appear on the next page load. Add `?live=poll` to an auction URL to
force polling (the Robot test does).

**This works only while one Node process serves every connection.** That is true today:
`render.yaml` runs a single instance with a persistent disk, and Render can't scale a disk-backed
service. If the app ever runs on more than one instance, live pushes would reach only the clients
connected to the instance that took the bid. Bids, emails and page refreshes would stay correct.
The fix then is PostgreSQL `LISTEN/NOTIFY` inside `auctionHub.js`: each instance publishes on bid
and relays notifications to its own connections. Nothing outside that module would change.

Don't put compression middleware in front of the stream routes, because it buffers events.

## Emails

- **Outbid** (`auction_outbid`): sent to the bidder who lost the lead on every outbid, **except on
  closing day** (the Montana date of `ends_at`), when bidding is heaviest and the emails would
  pile up (`services/auctions.js#outbidEmailsOpen`; board decision at the 2026-10-26 test). The
  auction and item pages say so (`outbidNotice` mixin), and so does the email. An auction that
  opens on its closing day sends none. `AUCTION_OUTBID_EMAIL_MINUTES` (default 0) can still
  throttle to one per item per window. The row in `auction_outbid_notices` is claimed before
  sending, so two racing bids send one email. Not sent after the close or on an admin removal.
- **Winner** (`auction_winner`): one per winning bidder, listing what they won. It is sent by the
  close job, or by **Send Winner Emails** on the admin Winners page. An item is marked
  `winner_emailed_at` only after its email goes out, so re-running sends just the failures.

## Close job

Set `AUCTION_CLOSE_JOB_ENABLED=true` (override the schedule with `AUCTION_CLOSE_JOB_CRON`; the
default is every minute). Each run:
1. Finds published auctions past `ends_at` with no `winners_notified_at`.
2. Claims each one.
3. Broadcasts `closed`.
4. Emails the winners.

Bidding closes on time whether or not the job runs.

## Manual PostgreSQL check

Neither Jest nor Robot exercises `pg-translate`, so after changing these queries, try them against
PostgreSQL:
- the compare-and-swap UPDATE with its correlated `EXISTS`
- `COALESCE(x, -1) = $n`
- the paddle `MAX()+1` insert
- `INSERT … ON CONFLICT DO NOTHING` on `auction_outbid_notices` (no `id` column, so it must keep
  the `ON CONFLICT` that stops the adapter appending `RETURNING id`)
- the partial unique index on live bid amounts
- the `emails_log_email_type_check` swap in `pgAlters`
