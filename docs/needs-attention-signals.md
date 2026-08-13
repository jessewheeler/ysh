# Needs-attention signals

The **Needs attention** view on `/admin/members` surfaces members who look like they
tried to join or renew and didn't finish, so the Membership Coordinator can call them.

Read this before changing a threshold or adding a signal. **Every signal is a proxy, not
a fact.** The app cannot observe intent, so each predicate infers "this person meant to
pay and something went wrong" from database state that is also consistent with other
explanations. The user guide is the place to describe what the badges mean to a
coordinator; this file is about what the queries actually prove.

## Where the code lives

| File | Role |
|---|---|
| `db/repos/memberAttention.js` | The seven predicates, the OR group, and per-row attribution. Single source of truth. |
| `services/attention.js` | Resolves settings + current period into the context the predicates bind. |
| `db/repos/members.js` | `viewClause` delegates the `needs-attention` case; `countByView` adds the pill count. |
| `routes/admin.js` | `view` / `signal` whitelists, badge attachment, CSV `Signals` column. |
| `views/admin/members/list.pug` | Pill, signal `<select>`, badges. |

## Who is eligible at all

Before any signal is considered, `eligibilityGate` excludes members who are **cancelled**,
**lifetime**, or **already enrolled in the current membership period**. Someone who has
paid for the season now open does not need outreach, whatever failed for them earlier.

Enrollment means a `membership_years` row for the current period. That row is written only
by a successful payment webhook, which makes it the authoritative record of "completed this
season" — and the only one of the three candidate definitions that survives contact with
real data.

**Two rejected definitions, both of which were actually tried:**

- **`status != 'active'`** — nothing in this codebase ever writes `status = 'expired'`;
  there is no expiry job. A lapsed member keeps `status = 'active'` with a stale
  `expiry_date`. This would exclude precisely the people `repeated_reminders` and
  `renewal_never_started` exist to find, turning both into dead code that quietly matches
  nobody forever.
- **The derived good-standing test** used by the `active` viewClause (`status='active'` and
  `is_lifetime` / null `expiry_date` / future `expiry_date`). It reads correctly and is
  wrong here for two independent reasons: most of the membership has a **null**
  `expiry_date` because it predates expiry tracking, and `expiry_date` records the period a
  member *last paid for*, so it can sit in the future while they have not paid for the
  season now open. In production this dropped 106 of 172 active members who had genuinely
  not renewed.

Both mistakes have regression tests (`a member with no expiry date but no current
enrollment is still eligible`, `a future expiry date does not excuse a missing current
enrollment`, `a lapsed member still carrying status=active is eligible`).

With no current period nobody can be enrolled, so the gate degrades to excluding only
cancelled and lifetime members — a wider list rather than a silently empty one. The gate
binds its parameter before the OR group's, which matters because `translateParams` numbers
`$n` positionally.

Note that `repeated_reminders` and `renewal_never_started` **also** carry their own
current-period check, now partly redundant with the gate. Keep it: `signalsForIds`
evaluates each predicate *without* the gate, so per-signal attribution depends on each
predicate standing alone.

## The signals

Each is a self-contained boolean SQL predicate correlated on `members.id`, all ANDed with
the eligibility gate above.

| key | proves | does *not* prove |
|---|---|---|
| `repeated_reminders` | ≥ N `renewal_reminder` rows in `emails_log` and no current-period `membership_years` row. Primaries only, non-lifetime. | That they saw the emails. This is the closest thing to the "going to spam" signal, but MailerSend accepting a send is not delivery — see *No bounce data* below. |
| `payment_failed` | A `payments` row with `status='failed'` and no `completed` row since. | Anything, unless the Stripe failure webhooks are subscribed. See *Deploy coupling*. |
| `stale_pending_payment` | A `pending` payment older than the threshold with no `completed` row since. | That the card was declined. Closing the tab looks identical. |
| `pending_no_payment` | A `pending` member older than the threshold with zero `payments` rows. | Which of the two causes applied: `createCheckoutSession` threw, or they abandoned the form before submitting. |
| `duplicate_pending` | Two `pending` primaries sharing an email, case-insensitively. | Which row is canonical. Merge before calling. |
| `email_send_failed` | An `emails_log` row with `status='failed'` and no successful send to the same address since. Matched on `to_email` as well as `member_id`, because `otp` and `contact` rows carry a null `member_id` — see the two guards below. | That the address is permanently bad, only that the last attempt failed. |
| `renewal_never_started` | Unexpired `renewal_token`, `expiry_date` already past, fewer than N reminders, no current-period enrollment. | That they never clicked the link — see below. |

### Why `renewal_never_started` is gated the way it is

The obvious version of this signal — "has an unexpired `renewal_token` and hasn't
renewed" — is useless. `services/renewal.js:generateRenewalToken` **re-extends
`renewal_token_expires_at` on every send**, so an unexpired token is true for everyone
who has ever received a single reminder. That predicate would return the entire
needs-renewal population.

Two gates make it meaningful:

- `expiry_date < today` — they are actually lapsed, not merely approaching renewal. That
  is what distinguishes this from the existing **Needs renewal** pill.
- reminder count `< minReminders` — the strict complement of `repeated_reminders`, so
  the two signals partition the population instead of double-badging the same people.

There is also no "token consumed" flag anywhere: `findByRenewalToken` checks only
expiry, and the token is cleared only by a successful webhook. So a member who opened
the renewal page and bailed at Stripe is indistinguishable from one who never clicked —
except that `POST /renew/:token` creates a `pending` payment row, which trips
`stale_pending_payment` instead. That is the intended division of labor.

## Two passes, and why

`attentionClause(ctx)` builds the OR group for filtering. `signalsForIds(ids, ctx)` then
re-evaluates each predicate individually over just the returned ids to produce badges.

The obvious alternative — adding `CASE WHEN <predicate> THEN 1 ELSE 0 END` columns to
`members.search()` — does not work. `search()` builds **one** param array and binds it
to both its `COUNT(*)` query and its `SELECT` query. Select-list params would be present
in one and absent from the other, so the count would desync from the rows.

Reusing the same predicate *text* for both passes is what guarantees a badge can never
disagree with the filter that selected the row. `test/repos/memberAttention.test.js` has
a test asserting exactly that: every row the filter returns has at least one badge.

## Dialect rules

These queries run under both better-sqlite3 and PostgreSQL, and `db/pg-translate.js`
translates far less than it looks like it does. It handles only `datetime('now')`,
`date('now')`, one specific `date('now', '+' || ? || ' days')` shape,
`strftime(..., 'now')`, `INSERT OR IGNORE`, and `?` → `$n`.

So:

- **All date boundaries are computed in JS and bound as parameters.** `created_at` and
  `expiry_date` are TEXT columns; comparing them to a SQL date function fails on
  PostgreSQL with a text-vs-date type error. This is what caused the PR #69 revert.
- **`CASE WHEN ... THEN 1 ELSE 0 END`, never a bare `EXISTS`, in a select list.** `EXISTS`
  returns a PostgreSQL boolean and a SQLite integer, and that difference leaks into the
  CSV export as `true` vs `1`.
- **No `GROUP_CONCAT`.** There is no `string_agg` translation, which is a second reason
  the signal list is assembled in JS rather than SQL.
- **No `strftime` with non-`'now'` arguments, no `julianday`, no `IFNULL`, no boolean
  literals.**
- The `IN (...)` list in `signalsForIds` is chunked at 400 ids because the CSV export
  path runs unlimited and SQLite caps a statement at 999 bound parameters. The predicate
  params ride along on every chunk, so the real budget is smaller than it looks.

Jest runs in-memory SQLite and Robot runs a SQLite file, so **neither test layer
exercises `pg-translate`**. Verify PostgreSQL manually against Render before shipping
changes here.

## Settings

Read by `services/attention.js`, with fallbacks if unset or non-numeric:

| key | default | effect |
|---|---|---|
| `attention_reminder_count` | 2 | Reminders before flagging. Lowering widens the list. Also raises the `renewal_never_started` ceiling, since the two partition on this value. |
| `attention_pending_payment_hours` | 24 | Grace period before an unfinished checkout counts as abandoned. |
| `attention_lookback_days` | 180 | Bounds every signal, so the list is an outreach queue rather than the club's full history. |

## Deploy coupling

`payment_failed` has **no data source** unless `checkout.session.expired` and
`payment_intent.payment_failed` are subscribed on the Stripe webhook endpoint. Before
this feature, `payments.status` allowed `'failed'` but no code path ever wrote it.

`services/stripe.js` also sets `payment_intent_data: { metadata }` on session creation.
Without it a `payment_intent.payment_failed` event cannot be traced to a member, because
the event carries the PaymentIntent rather than the checkout session. Payments created
before that change will log a warning and no-op.

## Why `email_send_failed` has two extra guards

Both were added after the naive version misfired on production data, and both have
regression tests. Do not simplify this predicate without re-reading this section.

**1. The `to_email` fallback is restricted to primaries.** The fallback exists because
`otp` and `contact` rows carry a null `member_id`. But family sub-members share the
primary's email address, so an unattributed failure matched *every* member of the family.
The original production symptom was a primary plus three sub-members all badged from two
`card_delivery` failures against one address. Adding `members.primary_member_id IS NULL` to
the fallback branch flags the one person you would actually call. A sub-member whose own
send failed still matches on `e.member_id`, which is precise and needs no such guard.

**2. A later success to the same address clears the failure.** `payment_failed` suppresses
itself once a payment completes; this now does the same via a nested `NOT EXISTS` for a
`sent` row with `created_at > e.created_at` for the same address. Without it, one
account-level provider problem badges members for the whole lookback window even though
every send since has worked — the production failures were all
`Your trial domain reached its email quota limit. #MS42222`, which said nothing about the
members it flagged.

The recovery check matches on **address**, not `member_id`, because deliverability is a
property of the address. A later success to a different address proves nothing about this
one, and a success recorded with a null `member_id` still counts. Note the ordering
consequence: a success *before* the failure does not excuse it, so a member whose mail
worked and then broke stays flagged.

## No bounce data

`email_send_failed` catches only sends **MailerSend rejected outright**, recorded when
`services/email.js` writes `status='failed'`. There is no MailerSend webhook in this
app, so a message that was accepted and then bounced, or was delivered into a spam
folder, is invisible. That is why the badge reads "Email send failed" rather than
"bounced" — do not relabel it without adding the webhook first.

Adding a MailerSend webhook is the highest-value extension here, since suspected spam
filtering is the Coordinator's actual concern and `repeated_reminders` is only a proxy
for it.

## Deliberately excluded

Two signals were designed and left out. They are real problems — `routes/stripe.js`
swallows the relevant errors into `logger.error` — but they describe **data to repair**
rather than **people to call**, and on day one they would return a historical backlog
that buries the outreach list:

- **Completed payment with no current-period `membership_years` row** — the enroll block
  at `routes/stripe.js:43-67` failed. The member paid and is not enrolled.
- **Enrolled with no `membership_cards` row for the year** — card generation at
  `routes/stripe.js:79-92` failed. The member paid and has no card.

If these are added later, put them behind their own filter or admin report rather than
folding them into this pill.
