# YSH — Yellowstone Sea Hawkers

Member-management web app: Express 5, Pug templates, better-sqlite3, Stripe payments, MailerSend email, canvas/PDFKit membership cards.

## Commands

```bash
npm run dev             # Start dev server (nodemon)
npm run lint            # ESLint
npm test                # Jest (~530 tests, --forceExit)
./robot/run_tests.sh    # Robot Framework end-to-end tests (~57 tests, Playwright)
./scripts/dev.sh        # Install deps + start dev server
./scripts/check.sh      # Full check: lint + Jest + Robot end-to-end — run this before declaring work done
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
  councilReport.js           #   Central Council membership report (.xlsx, template injection)
  csv.js                     #   CSV export helpers
  dashboard.js               #   stats aggregation for admin dashboard
  logger.js                  #   Winston logger (logs/ directory)
  payments.js                #   payment processing / history
  renewal.js                 #   renewal token generation + bulk reminders
  sender.js                  #   Sender.net subscriber list sync (one-way, YSH → Sender)
  storage.js                 #   file upload/delete (S3-compatible)
middleware/                  # Express middleware
  auth.js                    #   requireAdmin, requireSuperAdmin, captureActor (ALS)
  locals.js                  #   site settings + flash into res.locals
  captcha.js                 #   hCaptcha verification
  requestLogger.js           #   Morgan + Winston request logging
scripts/                     # CLI tools (create-admin, sync-sender, dev.sh, check.sh)
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
- Tables: members, payments, announcements, gallery_images, bios, site_settings, emails_log, membership_cards, admins, audit_log, membership_periods, membership_years
- `audit_log` captures table_name, record_id, action (INSERT/UPDATE/DELETE), actor_id, actor_email, old_values (JSON), new_values (JSON), changed_at
- `created_by`/`updated_by` FK columns on all mutable tables; actor propagated via AsyncLocalStorage in `db/audit-context.js`
- Sensitive fields (`otp_hash`, `renewal_token`) are stripped from audit JSON snapshots
- `data/` directory is `gitignored` (runtime DB, session store, generated cards)
- Adding a column: put it in `db/schema.js` for fresh installs, then add an idempotent ALTER to **both**
  arms of `db/migrate.js` — `pgAlters` (`ADD COLUMN IF NOT EXISTS`) and the SQLite `auditAlters` list
  (wrapped in the existing per-statement try/catch)

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs lint + tests on PRs to `main`. Requires canvas native deps (libcairo2-dev, etc.).
