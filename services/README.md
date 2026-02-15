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
