# Contributing

Thanks for your interest in contributing to YSH!

## Getting started

1. Clone the repo and install dependencies:
   ```bash
   git clone <repo-url> && cd ysh
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the required values (or use the defaults for local dev).

3. Start the dev server:
   ```bash
   ./scripts/dev.sh
   ```

## Making changes

1. Create a branch off `main`:
   ```bash
   git checkout -b your-branch-name
   ```

2. Make your changes. Follow the conventions in [STYLE_GUIDE.md](STYLE_GUIDE.md).

3. Run lint and tests before committing:
   ```bash
   ./scripts/check.sh
   ```

4. Commit with a clear, concise message describing what changed and why.

## Pull requests

- Fill out every section of the PR template.
- Keep PRs focused — one feature or fix per PR.
- All PRs to `main` must pass CI (lint + tests) before merging.
- A code owner review is required.

## Writing tests

- Every new service function or middleware should have tests.
- Place tests in `test/` mirroring the source path.
- Mock the database using the helpers in `test/helpers/` — see existing tests for examples.
- Mock external services (Stripe, SendGrid) with `jest.fn()`. Never make real API calls in tests.
- Run the full suite with `npm test` and confirm all 94+ tests pass.

## Database changes

- Schema changes go in `db/migrate.js` using `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE`.
- Update the test schema in `test/helpers/db.js` to match.
- Run `npm run migrate` to apply locally.

## What not to commit

- `.env` or any file containing secrets
- `data/` (runtime database, session store, generated cards)
- `uploads/` (user-uploaded images)
- `node_modules/`
