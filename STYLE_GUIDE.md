# Style Guide

Coding conventions for the YSH project.

## JavaScript

### General

- **CommonJS modules** — `require()` / `module.exports`. No ESM (`import`/`export`).
- **Semicolons** — always.
- **Quotes** — single quotes for strings, backticks for interpolation.
- **Indentation** — 2 spaces.
- **Trailing commas** — use them in multi-line objects and arrays.
- **`const` by default** — use `let` only when reassignment is needed. Never use `var` (legacy browser code in `public/js/` is the sole exception).

### Naming

- `camelCase` for variables, functions, and parameters.
- `UPPER_SNAKE_CASE` for constants (e.g. `CARD_WIDTH`, `NAVY`).
- `snake_case` for database column names and request body fields (matching the DB schema).
- Prefix unused parameters with `_` (e.g. `_next`, `_err`). ESLint enforces this.

### Functions

- Prefer named `function` declarations for top-level module functions.
- Arrow functions are fine for callbacks, middleware, and inline handlers.
- Keep functions short — extract a helper if a function exceeds ~40 lines.

### Error handling

- Use `try/catch` around async operations (DB writes, external API calls).
- Log errors with `console.error()` and include context (e.g. `'Card gen error:', e`).
- In Express routes, set `req.session.flash_error` and redirect rather than crashing.

### Express routes

- Group routes by resource with comment headers (e.g. `// --- Members CRUD ---`).
- Auth-gated routes go after `router.use(requireAdmin)`.
- Destructure `req.body` at the top of route handlers.
- Use `|| null` for optional fields going into the database.

## SQL

- SQL keywords in UPPERCASE (`SELECT`, `INSERT INTO`, `WHERE`).
- Use parameterized queries (`?` placeholders) — never interpolate user input.
- `CREATE TABLE IF NOT EXISTS` for idempotent migrations.

## Pug templates

- `layout.pug` is the base template — extend it with `block content`.
- 2-space indentation.
- Use Pug shorthand for classes and IDs (e.g. `.container`, `#footer`).

## CSS

- Two stylesheets: `public/css/style.css` (public site) and `public/css/admin.css` (admin panel).
- Mobile-first — base styles for small screens, `@media` queries for larger.
- Project colors: navy `#002a5c`, green `#69be28`, white `#ffffff`.

## Tests

- Test files live in `test/` mirroring source paths (e.g. `services/members.js` -> `test/services/members.test.js`).
- Use `describe` for the unit under test, `test` (not `it`) for individual cases.
- One assertion concept per test — multiple `expect` calls are fine if they verify the same behavior.
- Mock external services at the module level with `jest.fn()`. Never make real network calls.
