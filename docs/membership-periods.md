# Membership Periods + Pricing Management — Design

> Design record for the membership-period / pricing / electronic-surcharge feature.
> Status: planned (branch `feature/membership-pricing-management`).

## Context

YSH's membership "year" was hardcoded as an August→July cycle, encoded by a single
`membership_expiry_date` site setting (`YYYY-08-01`) stamped onto every member on activation. The club
now wants a **defined membership period of up to ~15 months that opens in April and runs through the
following July** — early (April) joiners simply get more months for the same flat price; the expiry is
the period's fixed end date.

The club also needs to **manage these dates and the Individual/Family prices** themselves, and add a
**flat electronic-payment surcharge** (covering card-processing fees) that applies to Stripe payments
only — not to cash/check.

Two pre-existing bugs this work also fixes:

- The admin Settings page exposed a single `dues_amount_cents` field that **nothing read** — signup/
  renewal code reads `individual_dues_amount_cents` / `family_dues_amount_cents`. Admins **could not
  change prices** through the UI.
- There was no concept of a payment surcharge anywhere.

## Decisions

- Dedicated `membership_periods` table; `membership_years` junction (member ↔ period).
- **Flat** surcharge fee; **no proration** (flat price regardless of join month within the period).
- Currency-style **dollar** inputs in the UI; **cents** in the DB (convert at the route/service boundary).
- **Periods overlap — there is no single "active" period.** Each period starts in April and ends
  ~15 months later (the following July), so consecutive seasons coexist: e.g. **2026–27**
  (Apr 2026 → Jul 2027) and **2027–28** (Apr 2027 → Jul 2028) are *both* open during Apr–Jul 2027.
  "Which period is current" is **derived by date**, not a boolean flag. The period a new
  signup/renewal enrolls into = `getCurrent()` = the open period (today within `[start_date,
  end_date]`) with the **latest `start_date`** (the just-opened early-bird season). Members already
  enrolled in the older overlapping period stay valid until *its* `end_date`.

## Data model

### `membership_periods` (new — in `db/schema.js` SCHEMA constant)

```
id                          INTEGER PK
label                       TEXT      -- e.g. "2026–27 Season"
start_date                  TEXT      -- period opens, e.g. 2026-04-01
end_date                    TEXT      -- expiry stamped on members, e.g. 2027-07-31
individual_dues_cents       INTEGER NOT NULL
family_dues_cents           INTEGER NOT NULL
electronic_surcharge_cents  INTEGER NOT NULL DEFAULT 0   -- flat fee on Stripe payments
created_at, updated_at, created_by, updated_by           -- match audit pattern on other tables
```

No `is_active` flag — periods overlap and "current" is computed by date. Multiple rows with
overlapping `[start_date, end_date]` windows are **expected and valid**.

### `membership_years` (new junction — member ↔ period enrollment history)

The relationship is many-to-many over time (a member enrolls in successive periods), so it's a junction
table rather than a single FK column. It is the source of truth for "which seasons is this member paid
through" and provides enrollment history.

```
id                    INTEGER PK
member_id             INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE
membership_period_id  INTEGER NOT NULL REFERENCES membership_periods(id)
payment_id            INTEGER REFERENCES payments(id)   -- nullable; links the dues payment if any
created_at, created_by
UNIQUE(member_id, membership_period_id)                  -- one enrollment row per member per period
```

The legacy `members.membership_year` integer column is **kept** (populated from the period's start
year) for existing displays/CSV exports; the junction is the relational source of truth. A member's
"current period" = the junction row whose period is currently open.

### Migration (`db/migrate.js`) — both dialects, idempotent

- New tables are created by `db.exec(SCHEMA)` (SQLite) and `toPgSchema(SCHEMA)` (PG) — both
  `CREATE TABLE IF NOT EXISTS`. No new column on `members`.
- **Backfill** (run once, guarded by "no rows in membership_periods"): create one period from the
  existing settings (`individual_dues_amount_cents`, `family_dues_amount_cents`,
  `membership_expiry_date` as `end_date`, `start_date` ≈ prior April, surcharge 0), then enroll every
  `status='active'` member in that period. Keeps live deployments working with zero manual steps.

## Backend

### `db/repos/membershipPeriods.js` (new)

CRUD following the existing repo pattern (e.g. `db/repos/settings.js`), each mutation calling
`auditLog.insert(...)`: `list()` (ordered `start_date DESC`), `get(id)`, `create(data)`,
`update(id, data)`, and `getCurrent(asOf = today)` — the open period (`start_date <= asOf <= end_date`)
with the **latest `start_date`**, or `null` if none open. No `setActive` (date-driven).

### `db/repos/membershipYears.js` (new junction repo)

`enroll(memberId, periodId, paymentId)` (idempotent upsert on the UNIQUE pair), `isEnrolled(memberId,
periodId)`, `findByMember(memberId)`, `findByPeriod(periodId)` — `auditLog.insert(...)` on enroll.

### `services/membershipPeriods.js` (new)

- `validatePeriod(input)` — required label, valid dates, `end_date > start_date`, non-negative cents.
  Accepts **dollar** amounts and converts to integer cents (`Math.round(parseFloat(dollars) * 100)`,
  mirroring the offline-payment route). Validation lives in the service so unit tests exercise real
  logic (like `services/donations.js#validateDonation`).
- `duesForType(period, membershipType)` → individual vs family cents.
- `surchargeFor(period, method)` → `electronic_surcharge_cents` for Stripe, `0` for cash/check.
- `centsToDollars(cents)` — formatting helper for rendering values back into the form.

### Signup + renewal pricing (`routes/index.js`)

Replace the `individual_dues_amount_cents` / `family_dues_amount_cents` settings reads (GET/POST
`/membership`, GET/POST `/renew/:token`) with `membershipPeriods.getCurrent()` + `duesForType()`.
Stripe is electronic, so pass dues **and** surcharge to checkout. Show a clear "membership currently
closed" path when `getCurrent()` is `null`.

### Stripe checkout (`services/stripe.js`)

- Add `surchargeCents` and `periodId` params to `createCheckoutSession(...)`.
- When `surchargeCents > 0`, add a **second `line_items` entry** "Electronic payment fee" (transparent
  on the Stripe receipt); record the payment row's `amount_cents` as **dues + surcharge**.
- Add `period_id` to session `metadata` so the webhook stamps the exact period paid for.

### Webhook activation (`routes/stripe.js`)

Replace the `membership_expiry_date` settings read with the period from `session.metadata.period_id`
(fallback `getCurrent()`): set `expiry_date = period.end_date` and `membership_year` from the period on
primary + family members, and **enroll each member** via `membershipYears.enroll(id, periodId,
paymentId)`.

### Renewal eligibility (`db/repos/members.js#findNeedingRenewal` + `services/renewal.js`)

Replace the `membership_year < currentYear` guard with a `NOT EXISTS` subquery against
`membership_years` for the **current** period id (due if no enrollment row for `getCurrent()`) plus the
existing expiry-window condition; `services/renewal.js` passes `getCurrent().id` (skip when no period
is open). Reminder window (`renewal_reminder_days_before`) stays a site setting. Overlap case: when the
new season opens in April, members still covered by the prior overlapping period only surface once
their own `expiry_date` enters the reminder window.

## Admin UI

### Membership Periods management (super_admin)

- Routes in `routes/admin.js`: `GET /admin/periods` (list, newest-first, highlighting the computed
  **current** open period), `GET/POST /admin/periods/new`, `GET/POST /admin/periods/:id/edit`. Guarded
  by `requireSuperAdmin`, validated via `services/membershipPeriods.validatePeriod`, flash + redirect.
  **No activate action** — periods become current by date; overlap is allowed (validation must not
  reject overlapping windows). Admin can pre-stage next season with a future April `start_date`.
- New views under `views/admin/periods/` (`list.pug`, `form.pug`) styled like
  `views/admin/settings.pug`; nav link in the admin layout.
- **Currency-style fee inputs:** Individual dues, Family dues, and the surcharge render as **dollar**
  fields (`type="number" step="0.01" min="0"`, `$` prefix), pre-filled via `centsToDollars()`. The
  route converts dollars→cents through `validatePeriod`. Backend/DB stay in integer cents.

### Settings page cleanup (`views/admin/settings.pug` + `routes/admin.js`)

Remove the dead `dues_amount_cents` field and the `membership_expiry_date` field (now period-derived);
drop both keys from the allowed-keys array. Keep `renewal_reminder_days_before`. Add a note linking to
`/admin/periods`.

### Offline payment + manual activation (`routes/admin.js`)

Where admin activation currently reads `membership_expiry_date`, use `getCurrent()`'s `end_date` and
**enroll** the member(s) via `membershipYears.enroll(...)`. Prefill the offline-payment amount (already
a dollar input) with the current period's dues for the member's type (**no surcharge** — cash/check).

## Public UI

`views/membership.pug` and `views/renew.pug`: render dues from the current period and show the flat
electronic fee as a line item with the total (e.g. "Dues $26.00 + $1.50 electronic payment fee =
$27.50"). Prices are server-rendered; no CSP-sensitive inline scripts (`public/js/membership.js` keeps
only its family-section toggle).

## Seed (`db/seed.js`)

Insert one `membership_periods` row spanning the current date (e.g. last April → next-year July) so
`getCurrent()` resolves in dev, with the current $16 / $26 prices and a default surcharge, via
`INSERT OR IGNORE`. Stop seeding `individual_dues_amount_cents` / `family_dues_amount_cents` /
`membership_expiry_date` (superseded). Keep `max_family_members` and `renewal_reminder_days_before`.

## Implementation order (TDD)

Built **test-first** — each step: write the listed test(s) first (red), then minimum implementation
(green), then refactor + `npm run lint`. The schema/migration foundation lands first so the in-memory
test DB (built from `SCHEMA`) has the new tables. Run the full `npm test` after each major step.

0. **Schema/migration foundation.** Add both tables to `db/schema.js` and the backfill to
   `db/migrate.js`; add fixtures `insertPeriod(db, overrides)` and `enrollMember(db, memberId,
   periodId)` to `test/helpers/fixtures.js`. (`test/helpers/db.js` builds from `SCHEMA`.)
1. `db/repos/membershipPeriods.js` ← `test/repos/membershipPeriods.test.js` (CRUD, audit rows, and
   `getCurrent()` date logic: overlapping windows pick the latest `start_date`; future period excluded
   until it opens; `null` when none open).
2. `db/repos/membershipYears.js` ← `test/repos/membershipYears.test.js` (enroll idempotency, UNIQUE
   pair, `isEnrolled`, audit on enroll).
3. `services/membershipPeriods.js` ← `test/services/membershipPeriods.test.js` (`validatePeriod` incl.
   dollars→cents + bad-date/negative cases, `duesForType`, `surchargeFor`, `centsToDollars`).
4. `services/stripe.js` changes ← update `test/services/stripe.test.js` (surcharge line item,
   `period_id` metadata, total `amount_cents`).
5. `members.js#findNeedingRenewal` + `services/renewal.js` ← update `test/services/renewal.test.js`
   (+ `test/routes/renewal.test.js`) for enrollment-based eligibility (junction `NOT EXISTS`).
6. Webhook activation (`routes/stripe.js`) ← update the stripe webhook/payments route test (enrollment
   row + `expiry_date = period.end_date`).
7. Admin periods routes (`routes/admin.js`) ← `test/routes/admin-periods.test.js` (list/create/edit,
   overlapping windows allowed, dollar-input parsing, super_admin gating).
8. Admin offline-payment/manual-activation + signup/renewal pricing routes ← extend
   `test/routes/admin-members.test.js` and the membership route tests (enrollment + current-period
   pricing).
9. Views (`admin/periods/*`, settings cleanup, `membership.pug`/`renew.pug`) — exercised via the route
   tests; smoke-checked in verification.

## Documentation deliverables

- **This file** (`docs/membership-periods.md`) — the durable design record.
- **`CLAUDE.md`**: add `membership_periods` + `membership_years` to the Tables list; add the new
  repos/service/views to Project structure; note that money is dollars in the UI / cents in the DB and
  that membership pricing/dates now live in `membership_periods` (not site settings); bump the Jest
  test-count comment.
- **`db/seed.js`**: comment noting the seeded period supersedes the old dues/expiry settings.
- **`README.md`** (if it lists admin features): add Membership Periods management.

## Verification

1. `npm run lint && npm test` — all green (incl. new suites).
2. `npm run dev`, super_admin → `/admin/periods`: create a period spanning today (e.g.
   2025-04-01 → 2026-07-31, $16/$26, $1.50 surcharge); confirm it is marked **current**. Add an
   overlapping period (2026-04-01 → 2027-07-31); confirm both save and the later-starting one becomes
   current when its start date is reached.
3. `/membership` shows dues + $1.50 fee + total for Individual and Family, priced from the current
   period.
4. Stripe **test** checkout → Stripe page shows dues + the electronic fee line; after the webhook the
   member is `active`, `expiry_date = period.end_date`, and a `membership_years` row links
   member→period.
5. Offline payment in admin → amount prefilled, **no** surcharge, expiry = period end, enrollment row
   created.
6. A member enrolled in the current period is excluded from `findNeedingRenewal`; one with no
   enrollment for it is included.

## Out of scope

Proration/partial-period pricing; percentage-based surcharge; auto-generating next season's period row
(admin creates each period; it becomes current automatically by date).
