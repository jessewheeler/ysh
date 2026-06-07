# YSH — Yellowstone Sea Hawkers

Member-management web app: Express 5, Pug templates, better-sqlite3, Stripe payments, MailerSend email, canvas/PDFKit membership cards.

## Commands

```bash
npm run dev          # Start dev server (nodemon)
npm run lint         # ESLint
npm test             # Jest (~360 tests, --forceExit)
./scripts/dev.sh     # Install deps + start dev server
./scripts/check.sh   # Lint + test
./robot/run_tests.sh # Robot Framework E2E (Playwright); installs deps, runs all suites
```

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
  payments.js                #   CRUD + audit logging for payments
  cards.js                   #   membership_cards
  auditLog.js                #   insert() + list() for audit_log table
  announcements.js bios.js gallery.js emailLog.js settings.js
routes/                      # Express routers (index, admin, stripe)
services/                    # Business logic
  members.js stripe.js email.js card.js  # core domain services
  admin.js                   #   admin-specific operations
  auth.js                    #   password hashing / OTP
  content.js                 #   announcements, bios, gallery CRUD
  csv.js                     #   CSV export helpers
  dashboard.js               #   stats aggregation for admin dashboard
  logger.js                  #   Winston logger (logs/ directory)
  payments.js                #   payment processing / history
  renewal.js                 #   renewal token generation + bulk reminders
  storage.js                 #   file upload/delete (S3-compatible)
middleware/                  # Express middleware
  auth.js                    #   requireAdmin, requireSuperAdmin, captureActor (ALS)
  locals.js                  #   site settings + flash into res.locals
  captcha.js                 #   hCaptcha verification
  requestLogger.js           #   Morgan + Winston request logging
scripts/                     # CLI tools (create-admin, dev.sh, check.sh)
views/                       # Pug templates (layout.pug base)
public/                      # Static assets (css, js, img)
test/                        # Jest tests mirroring source structure
  helpers/db.js              #   In-memory SQLite factory with full schema
  helpers/setupDb.js         #   Resettable DB proxy (used by jest.mock)
  helpers/fixtures.js        #   buildMember, insertMember, insertSetting, insertCard,
                             #   buildStripeSession, buildAdmin, insertAdmin, insertPayment
```

## Code style

- CommonJS (`require`/`module.exports`), no ESM
- ESLint 9 flat config (`eslint.config.js`), extends `@eslint/js` recommended
- Prefix unused params with `_` (e.g. `_next`, `_e`)
- No TypeScript, no semicolons-optional — semicolons are used throughout

## Frontend (Pug + CSP)

- **No inline `<script>` in views.** `server.js` sets a strict Helmet CSP — `scriptSrc` is `'self'` + Stripe/hCaptcha
  only (NO `'unsafe-inline'`). Inline scripts are silently blocked in prod. Put client JS in `public/js/<page>.js` and
  reference it with `script(src="/js/<page>.js")` (see `membership.js`, `nav.js`, `donate.js`). `styleSrc` does allow
  `'unsafe-inline'`.
- Forms POST through global CSRF middleware (`server.js`): include
  `input(type="hidden" name="_csrf" value=(typeof csrfToken !== 'undefined' ? csrfToken : ''))`. The Stripe webhook (
  `/stripe/*`) is the only CSRF-exempt POST (verified by signature instead).
- Flash messages: set `req.session.flash_error` / `flash_success` then redirect; `middleware/locals.js` exposes + clears
  them.

## Testing patterns

- Tests live in `test/` mirroring source paths (e.g. `test/services/members.test.js`)
- DB mocking: `jest.mock('../../db/database', () => require('../helpers/setupDb'))` — provides an in-memory SQLite proxy that resets between tests via `db.__resetTestDb()`
- External services (Stripe, MailerSend) are mocked with `jest.fn()` at the module level
- Fixtures: use `insertMember(db, overrides)` from `test/helpers/fixtures.js` to create test data
- Keep route validation in a service (e.g. `services/donations.js#validateDonation`) so unit tests exercise the real
  logic instead of re-implementing it

### E2E tests (Robot Framework)

- Suites in `robot/tests/*.robot`; shared keywords in `robot/resources/`; `robot/libraries/ServerManager.py` (spawns
  `node server.js` on a random port with fake Stripe/Mailer keys + `data/ysh-robot.db`) and `DatabaseManager.py` (
  `Get Row Count`, `Query Sql`, `Reset Database`).
- Run via `./robot/run_tests.sh`; results in `robot/results/` (`output.xml`, `report.html`). `Reset Test State` resets
  DB + browser per test.
- **Gotchas:** a cell starting with `#` is parsed as a Robot comment — use the `id=foo` selector strategy, not `#foo`.
  Multi-match CSS trips Browser-library strict mode — assert with `Get Element Count` instead of
  `Wait For Elements State`. UI assertions that count elements are brittle: adding a dashboard `.stat-card` broke
  `admin_auth.robot` (it asserts the exact count).
- A crashed run can leave a stray `node server.js` holding `data/ysh-robot.db` open → lock contention/flaky cascades on
  the next run. Kill leftover plain `node server.js` (NOT the dev `nodemon`) before re-running.

## Database

- SQLite via better-sqlite3, WAL mode, foreign keys ON
- Schema defined in `db/schema.js`, applied by `db/migrate.js`
- Tables: members, payments, announcements, gallery_images, bios, site_settings, emails_log, membership_cards, admins, audit_log
- `audit_log` captures table_name, record_id, action (INSERT/UPDATE/DELETE), actor_id, actor_email, old_values (JSON), new_values (JSON), changed_at
- `created_by`/`updated_by` FK columns on all mutable tables; actor propagated via AsyncLocalStorage in `db/audit-context.js`
- Sensitive fields (`otp_hash`, `renewal_token`) are stripped from audit JSON snapshots
- `data/` directory is `gitignored` (runtime DB, session store, generated cards)

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs lint + tests on PRs to `main`. Requires canvas native deps (libcairo2-dev, etc.).
