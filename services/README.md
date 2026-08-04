# services/ -- Business Logic

Service modules encapsulate domain logic and third-party integrations. They are consumed by route handlers and the Stripe webhook.

## Files

### members.js -- Member Utilities

| Function               | Signature                      | Description                                                                                                                                 |
|------------------------|--------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| `generateMemberNumber` | `(year?) => string`            | Returns the next available member number for the given year. Format: `YSH-2026-0001`. Counts existing members for that year and increments. |
| `findMemberById`       | `(id) => object\|undefined`    | Looks up a member by primary key.                                                                                                           |
| `findMemberByEmail`    | `(email) => object\|undefined` | Looks up a member by email.                                                                                                                 |
| `activateMember`       | `(id) => void`                 | Sets a member's status to `active` and updates `updated_at`.                                                                                |

### stripe.js -- Stripe Integration

Requires `STRIPE_SECRET_KEY` in the environment.

| Function                | Signature                                                | Description                                                                                                                                                                             |
|-------------------------|----------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `createCheckoutSession` | `({ memberId, email, amountCents, baseUrl }) => Session` | Creates a Stripe Checkout Session in `payment` mode with the member ID in metadata. Also inserts a pending `payments` row. Returns the session object (use `session.url` for redirect). |
| `constructWebhookEvent` | `(rawBody, signature) => Event`                          | Verifies a Stripe webhook signature using `STRIPE_WEBHOOK_SECRET` and returns the parsed event. Throws on invalid signature.                                                            |

### card.js -- Membership Card Generation

Generates branded membership cards in two formats. Output is stored in `data/cards/` and tracked in the `membership_cards` table.

| Function      | Signature                     | Description                                                                                                                 |
|---------------|-------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| `generatePNG` | `(member) => Promise<string>` | Renders a 1050x600 PNG card using [node-canvas](https://github.com/Automattic/node-canvas). Returns the absolute file path. |
| `generatePDF` | `(member) => Promise<string>` | Renders a 525x300pt PDF card using [pdfkit](https://pdfkit.org). Returns the absolute file path.                            |

Both functions upsert a `membership_cards` row (one row per member per year).

**Card layout:**
- Navy (`#002a5c`) top stripe with the Sea Hawkers logo, club name, and "Official Member Card"
- White body with member name, member number, season year, and "ACTIVE MEMBER" badge
- Green (`#69be28`) bottom accent bar with "Go Hawks!"

### email.js -- MailerSend Email

Requires `MAILERSEND_API_KEY` and `FROM_EMAIL` in the environment. All emails are wrapped in a branded HTML template (navy header, white body, gray footer). Every send is logged to the `emails_log` table regardless of success or failure.

| Function                  | Signature                                | Description                                                                            |
|---------------------------|------------------------------------------|----------------------------------------------------------------------------------------|
| `sendWelcomeEmail`        | `(member) => Promise`                    | Sent after payment. Includes membership details.                                       |
| `sendPaymentConfirmation` | `(member, stripeSession) => Promise`     | Receipt with amount, date, member number.                                              |
| `sendCardEmail`           | `(member) => Promise`                    | Looks up the latest card for the member and attaches both the PDF and PNG.             |
| `sendBlastEmail`          | `(member, subject, bodyHtml) => Promise` | Sends an admin-composed email to a single member. Called in a loop by the blast route. |
| `sendContactEmail`        | `({ name, email, message }) => Promise`  | Forwards a contact form submission to the site's contact email (from `site_settings`). |

Internal helpers:
- `emailWrapper(bodyHtml)` -- Wraps content in the branded HTML template.
- `logEmail(...)` -- Inserts a row into `emails_log`.
- `getContactEmail()` -- Reads the `contact_email` setting from the DB.

### councilReport.js -- Central Council Membership Report

Builds the Sea Hawkers Central Council "Chapter Membership Tracking Report" as an .xlsx.
The Council supplies a fixed template and expects it back in exactly that formatting, so
this injects values into `assets/council-membership-report-template.xlsx` in place rather
than generating a workbook. Almost every target cell already exists in the template's
NATIONAL sheet with the right style, so each cell keeps its `s` attribute and only gains a
value; `styles.xml`, the theme, merged ranges, print setup, `calcChain.xml`, the shared
`=ROW()-18` formulas in column A, and the other four sheets come through byte-identical.
Strings are written as inline strings, which keeps `sharedStrings.xml` untouched and makes
member text impossible for Excel to read as a formula. Uses `jszip` for the zip round trip.

| Function              | Signature                                                                    | Notes                                                                                                              |
|-----------------------|------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| `resolveBoard`        | `(bios) => { board, warnings }`                                              | Board block from the visible bios in sort order, each with its own `role` as the Position. Holds ten; the rest are named in a warning. |
| `buildWorkbook`       | `({ chapterName, monthYearEnding, submittedBy, board, members }) => Promise<Buffer>` | The .xlsx bytes. Member rows start at row 19; past row 2518 extra rows are appended and `<dimension>` widened.      |
| `formatState`         | `(raw) => string`                                                            | Full state name to two-letter code. Truncating would turn "Montana" into "MO", which is Missouri.                    |
| `formatPhone`         | `(raw) => string`                                                            | 10 digits to `(406) 555-1234`; anything else passes through.                                                        |
| `memberSinceYear`     | `(member) => number\|null`                                                   | Year from `join_date`, falling back to `created_at`. Handles the `Date` that Postgres returns and the string SQLite does. |
| `monthYearEndingFrom` | `(endDate) => string`                                                        | A period end date as "July 2026".                                                                                  |
| `defaultFilename`     | `(endDate) => string`                                                        | `Yellowstone-Sea-Hawkers-Membership-Report-2026-07.xlsx`.                                                           |
| `sanitizeFilename`    | `(name) => string`                                                           | Reduces an admin-supplied name to one safe basename and forces `.xlsx`.                                             |
| `memberWarnings`      | `(members) => string[]`                                                      | Counts of missing addresses and emails, plus a note when the roster exceeds the template's 2500 rows.               |

### sender.js -- Sender.net List Sync

Mirrors members into Sender.net for newsletter sending. Requires `SENDER_API_TOKEN`, `SENDER_GROUP_CURRENT`, and `SENDER_GROUP_LAPSED`; every function no-ops when any is missing, so dev and CI need no Sender account. Uses global `fetch` against `https://api.sender.net/v2`, with backoff on 429 and 5xx.

| Function            | Signature                              | Description                                                                                                     |
|---------------------|----------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `isConfigured`      | `() => boolean`                        | True when all three env vars are set.                                                                            |
| `groupForMember`    | `(member) => string\|null`             | Target group ID: current for active/lifetime, lapsed for expired, `null` for pending/cancelled.                  |
| `buildSubscriber`   | `(member) => object`                   | Sender payload. Lowercases the email and maps `member_number` / `expiry_date` to custom fields.                  |
| `dedupeByEmail`     | `(members) => members`                 | Collapses to one member per email, preferring the primary.                                                       |
| `upsertSubscriber`  | `(member) => Promise`                  | `POST /subscribers`, falling back to `PATCH /subscribers/{email}` when the address already exists.               |
| `syncMember`        | `(memberId) => Promise<{group}>`       | Upserts, then adds to the target group and removes from the other. Throws on failure.                            |
| `syncMemberSafe`    | `(memberId) => Promise<void>`          | `syncMember` wrapped in try/catch. Never throws; this is what route handlers call.                              |
| `syncAllMembers`    | `({ dryRun }) => Promise<stats>`       | Full backfill. Returns `{ total, synced, failed, groups: { current, lapsed, removed } }`.                        |

Three constraints in the Sender API shape this module:

- **No bulk create.** Subscribers are created one at a time; the bulk group endpoints only move addresses that already exist. `syncAllMembers` therefore upserts sequentially (phase A), then reconciles groups in chunked bulk calls (phase B), costing roughly one call per member rather than three.
- **`groups` replaces rather than appends** on create and update, so it is never sent. Sending it would wipe any group curated by hand in the Sender dashboard. Group membership is managed only through the explicit add and remove endpoints.
- **`email` is not an updatable field.** A subscriber cannot be renamed, so changing a member's email in admin creates a new subscriber and leaves the old address behind. That address keeps its own unsubscribe link.

`trigger_automation: false` is set on every write so a backfill does not fire Sender automations at the existing membership.

Called from `routes/stripe.js` after a completed checkout and from the member update handler in `routes/admin.js`. The CLI entry point is `scripts/sync-sender.js`.
