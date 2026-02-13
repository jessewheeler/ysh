# YSH — Yellowstone Sea Hawkers

Member-management web app: Express 5, Pug templates, better-sqlite3, Stripe payments, SendGrid email, canvas/PDFKit membership cards.

## Commands

```bash
npm run dev          # Start dev server (nodemon)
npm run lint         # ESLint
npm test             # Jest (94 tests, --forceExit)
./scripts/dev.sh     # Install deps + start dev server
./scripts/check.sh   # Lint + test
```

## Project structure

```
server.js              # Express app entry point
db/database.js         # Singleton better-sqlite3 connection (data/ysh.db)
db/migrate.js          # Schema creation (CREATE IF NOT EXISTS)
db/seed.js             # Seed data (bios, announcements, gallery, settings)
routes/                # Express routers (index, admin, stripe)
services/              # Business logic (members, stripe, email, card)
middleware/            # auth (requireAdmin, requireSuperAdmin), locals (site settings + flash)
scripts/               # CLI tools (create-admin, dev.sh, check.sh)
views/                 # Pug templates (layout.pug base)
public/                # Static assets (css, js, img)
test/                  # Jest tests mirroring source structure
  helpers/db.js        # In-memory SQLite factory with full schema
  helpers/setupDb.js   # Resettable DB proxy (used by jest.mock)
  helpers/fixtures.js  # buildMember, insertMember, insertSetting, insertCard, buildStripeSession, buildAdmin, insertAdmin, insertPayment
```

## Code style

- CommonJS (`require`/`module.exports`), no ESM
- ESLint 9 flat config (`eslint.config.js`), extends `@eslint/js` recommended
- Prefix unused params with `_` (e.g. `_next`, `_e`)
- No TypeScript, no semicolons-optional — semicolons are used throughout

## Testing patterns

- Tests live in `test/` mirroring source paths (e.g. `test/services/members.test.js`)
- DB mocking: `jest.mock('../../db/database', () => require('../helpers/setupDb'))` — provides an in-memory SQLite proxy that resets between tests via `db.__resetTestDb()`
- External services (Stripe, SendGrid) are mocked with `jest.fn()` at the module level
- Fixtures: use `insertMember(db, overrides)` from `test/helpers/fixtures.js` to create test data

## Database

- SQLite via better-sqlite3, WAL mode, foreign keys ON
- Schema in `db/migrate.js`, tables: members, payments, announcements, gallery_images, bios, site_settings, emails_log, membership_cards, admins
- `data/` directory is `gitignored` (runtime DB, session store, generated cards)

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs lint + tests on PRs to `main`. Requires canvas native deps (libcairo2-dev, etc.).
