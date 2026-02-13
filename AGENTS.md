# Agents

Guidelines for AI agents working on this codebase.

## Before making changes

1. Read the relevant source files before editing — understand existing patterns.
2. Run `npm run lint` and `npm test` before and after changes to confirm nothing breaks.
3. Keep changes minimal. Don't refactor, add comments, or "improve" code outside the scope of the task.

## Code conventions

- **CommonJS only** — use `require()`/`module.exports`, never `import`/`export`.
- **Semicolons** — always use them.
- **Unused params** — prefix with `_` (e.g. `_next`, `_err`). ESLint enforces this.
- **No new dependencies** without explicit approval. The stack is intentionally small.

## Writing tests

- Place tests in `test/` mirroring the source path: `services/foo.js` → `test/services/foo.test.js`.
- Mock the database with `jest.mock('../../db/database', () => require('../helpers/setupDb'))` and call `db.__resetTestDb()` in `beforeEach`.
- Use fixtures from `test/helpers/fixtures.js` (`insertMember`, `insertSetting`, `insertCard`, `buildMember`, `buildStripeSession`, `buildAdmin`, `insertAdmin`, `insertPayment`).
- Mock external services (Stripe, SendGrid) with `jest.fn()` — never make real API calls.

## Database changes

- All schema changes go in `db/migrate.js` using `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` patterns.
- Never modify the production database file directly. The `data/` directory is gitignored.
- Test schema is duplicated in `test/helpers/db.js` — keep it in sync with `db/migrate.js`.

## Commits and PRs

- Run `./scripts/check.sh` (lint + test) before committing.
- Follow the PR template in `.github/pull_request_template.md`.
- Never commit `.env`, `data/`, or `uploads/` contents.
