# YSH — Yellowstone Sea Hawkers

Member-management web app: Express 5, Pug templates, better-sqlite3, Stripe payments, MailerSend email, canvas/PDFKit membership cards.

## Commands

```bash
npm run dev             # Start dev server (nodemon)
npm run lint            # ESLint
npm test                # Jest (~830 tests, --forceExit)
./robot/run_tests.sh    # Robot Framework end-to-end tests (~115 tests, Playwright)
./scripts/dev.sh        # Install deps + start dev server
./scripts/check.sh      # Full check: lint + Jest + Robot end-to-end — run this before declaring work done

node scripts/expire-memberships.js --dry-run   # Preview which memberships would be expired
node scripts/expire-memberships.js --max=N     # Expire them (ceiling defaults to 50)
node scripts/sync-schedule.js --dry-run        # Preview Seahawks games that would become events
node scripts/sync-schedule.js --season=2026    # Create/refresh game-day events from ESPN
```

`./robot/run_tests.sh` accepts pass-through args, so a single suite or tag can be run on
its own: `./robot/run_tests.sh --include reports` or
`./robot/run_tests.sh robot/tests/admin_council_report.robot`.

## Project structure

```
server.js                    # Express app entry point
db/database.js               # Singleton better-sqlite3 connection (data/ysh.db)
db/schema.js                 # Canonical DDL (SQLite syntax; single source of truth)
db/migrate.js                # Runs schema.js DDL (CREATE IF NOT EXISTS)
db/seed.js                   # Seed data (bios, announcements, gallery, settings)
db/audit-context.js          # AsyncLocalStorage actor propagation (getActor, runWithActor)
db/pg-translate.js           # SQLite→PostgreSQL SQL dialect translation helpers
db/repos/                    # Data-access layer (one file per table)
  members.js                 #   CRUD + audit logging for members
  memberAttention.js         #   "needs attention" signal predicates (stalled signups/renewals)
  payments.js                #   CRUD + audit logging for payments
  cards.js                   #   membership_cards
  auditLog.js                #   insert() + list() for audit_log table
  campaigns.js               #   campaigns + attribution stats
  campaignVisits.js          #   campaign_visits (no audit rows — high-volume system writes)
  contactSubmissions.js      #   stored contact-form messages
  events.js                  #   game-day events (ESPN-synced or manual)
  checkIns.js                #   per-person event check-ins + raffle tickets
  announcements.js bios.js gallery.js emailLog.js settings.js
routes/                      # Express routers (index, admin, stripe)
services/                    # Business logic
  members.js stripe.js email.js card.js  # core domain services
  activation.js              #   THE place a member is activated for a membership period
  admin.js                   #   admin-specific operations
  attention.js               #   thresholds + current period for the needs-attention filter
  auth.js                    #   password hashing / OTP
  campaigns.js               #   UTM link building, QR (PNG/SVG), campaign validation
  checkIn.js                 #   household check-in: enrollment per person, ticket rules
  content.js                 #   announcements, bios, gallery CRUD
  councilReport.js           #   Central Council membership report (.xlsx, template injection)
  csv.js                     #   CSV export helpers
  dashboard.js               #   stats aggregation for admin dashboard
  events.js                  #   America/Denver local date/time helpers, event form parsing
  logger.js                  #   Winston logger (logs/ directory)
  membershipExpiry.js        #   nightly lapsed-member expiry (writes status='expired')
  nflSchedule.js             #   Seahawks schedule sync from ESPN's public API → events
  payments.js                #   payment processing / history
  renewal.js                 #   renewal token generation + bulk reminders
  scheduler.js               #   node-cron registration, armed by EXPIRY_JOB_ENABLED / SCHEDULE_SYNC_ENABLED
  sender.js                  #   Sender.net subscriber list sync (one-way, YSH → Sender)
  storage.js                 #   file upload/delete (S3-compatible)
middleware/                  # Express middleware
  auth.js                    #   requireAdmin, requireSuperAdmin, captureActor (ALS)
  campaign.js                #   captureCampaign — ?utm_campaign= → first-touch session + visit
  locals.js                  #   site settings + flash into res.locals
  captcha.js                 #   hCaptcha verification
  requestLogger.js           #   Morgan + Winston request logging
scripts/                     # CLI tools (create-admin, sync-sender, dev.sh, check.sh)
  repair-offline-renewals.js #   backfills members whose offline payment never stamped a period
views/                       # Pug templates (layout.pug base)
public/                      # Static assets (css, js, img)
assets/                      # Non-served binary assets (Council .xlsx report template)
test/                        # Jest tests mirroring source structure
  helpers/db.js              #   In-memory SQLite factory with full schema
  helpers/setupDb.js         #   Resettable DB proxy (used by jest.mock)
  helpers/fixtures.js        #   buildMember, insertMember, insertSetting, insertCard,
                             #   buildStripeSession, buildAdmin, insertAdmin, insertPayment
robot/                       # Robot Framework end-to-end tests (Browser/Playwright)
  tests/                     #   One suite per area (admin_*.robot, public.robot)
  resources/                 #   common.resource (server/db/browser setup), admin.resource (login, download)
  libraries/                 #   ServerManager.py, DatabaseManager.py, XlsxInspector.py
```

## Code style

- CommonJS (`require`/`module.exports`), no ESM
- ESLint 9 flat config (`eslint.config.js`), extends `@eslint/js` recommended
- Prefix unused params with `_` (e.g. `_next`, `_e`)
- No TypeScript, no semicolons-optional — semicolons are used throughout

## Client-side JS in views

**Inline event handler attributes do not work.** helmet sends `script-src-attr 'none'`, so
`onchange="this.form.submit()"` and `onclick="return confirm(...)"` in a Pug template never
fire, and nothing appears in the console to say why. This has silently broken three
features (the report period filter, the members list period/status filters, and the
confirmation on the Demote button).

Put the behavior in `public/js/admin.js` instead, driven by a data attribute — that file is
served from `'self'`, which the CSP allows. Two hooks already exist:

- `data-auto-submit` on a form control submits its form on change
- `data-confirm="Are you sure?"` on a form confirms before submit
- `data-spinner="Saving…"` on a form disables the submit button and swaps in a spinner on submit.
  It is opt-in, so any form that sends email or records money should carry it. It checks
  `e.defaultPrevented`, so it can share a form with `data-confirm` — a cancelled dialog leaves the
  button usable.
- `data-dialog-open="#id"` on a button opens that `dialog.modal` with `showModal()`; anything with
  `data-dialog-close` inside it closes it, as does a backdrop click or Escape. Render
  `data-dialog-open-on-load` on the dialog to reopen it after a redirect (the void-payment form does
  this so a refused submit lands back in the form). The modal is the confirmation — don't stack
  `data-confirm` on a form inside one.

Inline `<style>` and `style=` attributes are fine; `style-src` includes `'unsafe-inline'`.
Only scripts are restricted. When adding a filter control, cover it with a Robot test that
actually changes the control — a test that navigates straight to `?filter=value` passes
whether or not the control works.

## Testing patterns

Three layers: Jest unit/repo tests, Jest HTTP integration tests through supertest, and Robot Framework
end-to-end tests in a real browser. `./scripts/check.sh` runs all of them.

### Jest

- Tests live in `test/` mirroring source paths (e.g. `test/services/members.test.js`)
- DB mocking: `jest.mock('../../db/database', () => require('../helpers/setupDb'))` — provides an in-memory SQLite proxy that resets between tests via `db.__resetTestDb()`
- External services (Stripe, MailerSend) are mocked with `jest.fn()` at the module level
- Fixtures: use `insertMember(db, overrides)` from `test/helpers/fixtures.js` to create test data.
  `insertMember` ignores `role` — use `insertAdmin(db, overrides)` for an admin
- For HTTP-level tests, `server.js` exports the Express app: `request.agent(app)` plus the real
  OTP login flow works because `services/auth.js` issues a fixed `000000` OTP when `NODE_ENV=test`.
  See `test/routes/admin-council-report-http.test.js`

### Robot Framework

- `./robot/run_tests.sh` starts a real server on a random port against `data/ysh-robot.db`
- Every suite uses the same header: `Suite Setup Start Test Server`, `Suite Teardown Stop Test Server`,
  `Test Setup Reset Test State`, then `Force Tags`
- Seed data through `DatabaseManager.py` keywords (`Seed Member`, `Seed Bio`, `Enroll Member`,
  `Get Current Period Id`), not through the UI
- `Login As Admin` from `admin.resource` handles the OTP flow; `Download Via Click` returns the path
  of a downloaded file
- `XlsxInspector.py` asserts on generated workbooks (`Xlsx Cell Should Be`,
  `Xlsx Should Match Template Formatting`)

## Database

- SQLite via better-sqlite3, WAL mode, foreign keys ON
- Schema defined in `db/schema.js`, applied by `db/migrate.js`
- Tables: members, payments, announcements, gallery_images, bios, site_settings, emails_log, membership_cards, admins, audit_log, membership_periods, membership_years, campaigns, campaign_visits, contact_submissions, events, check_ins
- `audit_log` captures table_name, record_id, action (INSERT/UPDATE/DELETE), actor_id, actor_email, old_values (JSON), new_values (JSON), changed_at
- `created_by`/`updated_by` FK columns on all mutable tables; actor propagated via AsyncLocalStorage in `db/audit-context.js`
- Sensitive fields (`otp_hash`, `renewal_token`) are stripped from audit JSON snapshots
- `data/` directory is `gitignored` (runtime DB, session store, generated cards)
- Adding a column: put it in `db/schema.js` for fresh installs, then add an idempotent ALTER to **both**
  arms of `db/migrate.js` — `pgAlters` (`ADD COLUMN IF NOT EXISTS`) and the SQLite `auditAlters` list
  (wrapped in the existing per-statement try/catch)
- `members.campaign_id` is the one exception: it lives only in the migrate ALTERs (and is mirrored in
  `test/helpers/db.js`), because `members` is created before `campaigns` while `campaigns.created_by`
  references `members`, and PostgreSQL rejects a forward `REFERENCES` at `CREATE TABLE` time
- `members.status = 'expired'` is written by `services/membershipExpiry.js` (nightly, plus
  `scripts/expire-memberships.js`), which expires members with no `membership_years` row for any
  period whose `end_date` is still in the future. It aborts when no period is open — otherwise the
  rule would match the entire roster — and refuses to expire more than `--max` members in one run.
  Because it runs on a schedule, `status` lags reality between runs: code that must be exact should
  still test enrollment, not `status`. Family sub-members inherit their primary's enrollment.
- `payments.status` allows `pending`/`completed`/`failed`/`refunded`/`voided`. `failed` is written only
  by the Stripe failure webhooks (`checkout.session.expired`, `payment_intent.payment_failed`), and
  `payments.failure_reason` holds Stripe's message. Nothing writes `refunded`.
- `voided` is the soft delete for a mistaken offline payment (issue #108), written only by
  `paymentRepo.voidById` via the super-admin Void control on the member page. The row stays, with a
  mandatory `void_reason` (`refunded`/`voided`/`duplicate`/`other`, note required for `other`) and
  `voided_at`, so the audit trail and any `membership_years.payment_id` citation survive; the dashboard
  total drops it because `sumCompletedCents` only ever counted `completed`. Stripe rows are refused —
  voiding one locally would silently drift from Stripe without refunding anything. Adding `voided` to
  the CHECK meant rebuilding `payments` in SQLite (`migratePaymentsStatusCheck` in `db/migrate.js`,
  foreign keys off around it because `membership_years` cites payments) and a DROP/ADD of
  `payments_status_check` in `pgAlters`.
- `POST /members/:id/payments` refuses an identical completed payment (member, amount, method) recorded
  within the last minute (`paymentsService.isRecentOfflineDuplicate`). The `data-spinner` on the form
  only stops a double-click; this is what stops a refresh or a slow network from activating and
  mailing the member twice. `membershipYears.enroll` re-points an enrollment whose payment was voided
  at the next payment it is handed, so voiding a wrong-amount payment and recording the right one
  leaves the period citing the real money.
- Game-day check-in (issue #114): `events` rows are watch parties, created by `services/nflSchedule.js`
  (matched on `external_id`, the ESPN game id) or by hand. A sync only refreshes `event_date` and
  `kickoff_at` on existing rows — name, location, notes and `cancelled` belong to admins. `event_date`
  is the **America/Denver** date (a 6:20 PM MT kickoff is the next day in UTC); use
  `services/events.js#localDate`, not `toISOString().slice(0, 10)`. `check_ins` is unique on
  (event, member); `services/checkIn.js` is the only writer. It tests enrollment for the event's season
  (sub-members through their primary, lifetime always) and forces `tickets_issued = 0` for anyone not
  enrolled. The unmerged `feature/member-portal` branch had its own `events` table — this one replaces it
- Campaign tracking is documented in `docs/campaign-tracking.md`
- The Needs attention member filter is documented in `docs/needs-attention-signals.md` — read it
  before changing a signal predicate or threshold, and note that neither Jest nor Robot exercises
  `pg-translate`, so those queries need a manual PostgreSQL check

## Activating a member

`services/activation.js` is the only place a member becomes active for a membership period.
Every caller — the Stripe webhook, the admin offline-payment form, admin member create/edit and
`scripts/repair-offline-renewals.js` — goes through it. Do not re-implement the sequence in a route.

- `activateForPeriod({ memberId, period, paymentId, clearRenewalToken, membershipYear })` sets
  `status`, `expiry_date` and `membership_year` and writes a `membership_years` enrollment row for
  the **primary and every family member**, resolving up to the primary when handed a sub-member id.
  It returns the rows re-fetched after the writes. With no open period it flips status only and
  returns `period: null` so the caller can warn instead of leaving a half-activated member.
- `deliverActivation({ primary, members, receipt, generateCards, sendEmails })` is the outbound
  half: cards, the welcome + receipt emails and the Sender sync. Split out so paths that only fix
  data (an admin edit, a bulk repair) never mail anybody.
- Derive the membership year from `period.start_date.slice(0, 4)`, never
  `new Date(period.start_date).getFullYear()` — a bare `YYYY-MM-DD` parses as UTC midnight and
  reports the previous year west of Greenwich.
- Activation on the offline-payment route is **not** gated on the member's prior status. Gating it
  that way is what caused renewals paid by an already-active member to skip the family cascade and
  the membership year entirely — which is also why the form's Activate box defaults to checked.
- With no open period, callers must refuse the activation rather than flip status and deliver: an
  active member with no expiry or enrollment, mailed last season's card, is worse than an
  unactivated one.
- Both calls belong inside a log-and-continue `try`/`catch` on the Stripe webhook — the payment is
  already recorded by then, so throwing turns a paid session into a retry loop.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs lint + tests on PRs to `main`. Requires canvas native deps (libcairo2-dev, etc.).
