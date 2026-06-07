# Yellowstone Sea Hawkers

Website and membership platform for the Yellowstone Sea Hawkers, a Seahawks booster club based in Billings, Montana. Built with Express 5, Pug, and SQLite (or PostgreSQL for production).

## Quick Start

```bash
# Install dependencies
npm install

# Create your .env (see .env.example)
cp .env.example .env

# Create an admin account
npm run create-admin you@example.com super_admin "Your Name"

# Start the dev server
npm run dev
```

The server starts at `http://localhost:3000`. On first boot it runs migrations and seeds the database with the current site content (bios, announcements, gallery images, settings).

## Project Structure

```
ysh/
  server.js              # Express app entry point
  .env / .env.example    # Environment variables (secrets, API keys)
  db/                    # SQLite database, migrations, seed data
  middleware/            # Express middleware (auth, template locals)
  routes/               # Route handlers (public, admin, Stripe webhook)
  services/             # Business logic (Stripe, email, cards, members)
  views/                # Pug templates (public site + admin CMS)
  public/               # Static assets (CSS, JS, images, PDFs)
  uploads/              # User-uploaded images (gitignored)
  data/                 # Runtime data: SQLite DB, session store, cards (gitignored)
```

Each directory contains its own README with details on its contents.

## npm Scripts

| Script                       | Description                                   |
|------------------------------|-----------------------------------------------|
| `npm start`                  | Start the production server                   |
| `npm run dev`                | Start with nodemon (auto-restarts on changes) |
| `npm run seed`               | Re-seed the database with default content     |
| `npm run migrate`            | Run database migrations only                  |
| `npm run create-admin <email> [role] [name]` | Create an admin account (`super_admin` or `editor`) |

## Environment Variables

Configured in `.env`. See `.env.example` for the full list.

| Variable                | Purpose                                              |
|-------------------------|------------------------------------------------------|
| `NODE_ENV`              | Environment: `development`, `test`, or `production`  |
| `PORT`                  | Server port (default `3000`)                         |
| `BASE_URL`              | Full base URL for Stripe redirect URLs               |
| `SESSION_SECRET`        | Secret for signing session cookies                   |
| `DATABASE_URL`          | PostgreSQL connection string (optional — uses SQLite if unset) |
| `STRIPE_SECRET_KEY`     | Stripe secret key (`sk_test_...`)                    |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`)          |
| `MAILERSEND_API_KEY`    | MailerSend API key (`mlsn...`)                       |
| `FROM_EMAIL`            | Sender address for all outbound emails               |
| `HCAPTCHA_SITE_KEY`     | hCaptcha site key (optional — captcha disabled if unset) |
| `HCAPTCHA_SECRET_KEY`   | hCaptcha secret key (optional)                       |
| `GA_MEASUREMENT_ID`     | Google Analytics measurement ID (optional)           |
| `B2_ENDPOINT`           | Backblaze B2 S3 endpoint (optional)                  |
| `B2_REGION`             | Backblaze B2 region (optional)                       |
| `B2_BUCKET`             | Backblaze B2 bucket name (optional)                  |
| `B2_KEY_ID`             | Backblaze B2 access key ID (optional)                |
| `B2_APP_KEY`            | Backblaze B2 application key (optional)              |
| `B2_PUBLIC_URL`         | Backblaze B2 public URL prefix (optional)            |

> **Note:** The Stripe publishable key is configured in **Admin > Settings**, not as an environment variable. `DATABASE_URL`, hCaptcha, GA, and B2 vars are all optional — the app falls back to SQLite, no captcha, no analytics, and local disk storage when they're not set.

## Features

### Public Site
- **Homepage** with announcements, about section, event gallery, membership signup, charitable partners, and contact form -- all rendered from the database
- **Board bios** page driven by the DB
- **Membership signup** with Stripe Checkout integration
- **Donations** — standalone donate page (preset or custom amount) with Stripe Checkout and a confirmation email
- **Contact form** that emails submissions via MailerSend

### Admin CMS (`/admin`)
- **Multi-admin accounts** with email-based OTP login (no shared password)
- **Two roles**: `super_admin` (full access including Settings and admin management) and `editor` (content management only)
- **Dashboard** with member count, revenue, total donations, and recent activity
- Full CRUD for **members**, **announcements**, **gallery images**, and **board bios**
- **Family memberships** — upgrade individual members to family, attach/detach family members
- **CSV export** for members and payments ledger
- **Manual payment entry** — record offline payments against a member
- **Site settings** editor (hero text, about text, dues amount, gallery album URL, contact email) — super admins only
- **Admin management** — super admins can add/remove admin accounts
- **Payments** ledger tied to Stripe
- **Donations** ledger — list of all donations (donor, amount, status); donations are soft-linked to a member when the
  donor email matches, and surface on the member detail page
- **Renewal reminders** — send bulk renewal emails to members due for renewal
- **Email blast** composer that sends to all active members
- **Email log** of every outbound message
- **Membership card** generation (PDF + PNG) with download and email delivery
- **Audit log** (super_admin only) — filterable, paginated log of all admin-initiated data changes with per-field diffs

### Stripe Integration
1. User fills out `/membership` form
2. Server creates a pending member + Stripe Checkout Session, redirects to Stripe
3. After payment, Stripe fires a `checkout.session.completed` webhook
4. Webhook handler activates the member, generates their card, and sends welcome + card emails

Donations use the same webhook: the donate form creates a pending `donations` row, then a Stripe Checkout Session tagged
with `metadata.donation`. On `checkout.session.completed` the handler marks the donation completed (idempotently),
soft-links it to a member by email, and sends a confirmation email.

### Membership Cards
Auto-generated as both PDF and PNG. Navy header with the Sea Hawkers logo, member name, member number (`YSH-2026-0001`), season year, and a green "Go Hawks!" footer bar. Stored in `data/cards/`, downloadable from admin, and emailable to the member.

### Email (MailerSend)
All emails use a branded HTML template (navy header, white body, gray footer). Types:
- **Welcome** -- sent after payment with membership details
- **Payment confirmation** -- receipt with amount, date, member number
- **Donation confirmation** -- thank-you receipt sent after a successful donation
- **Card delivery** -- PDF and PNG attached
- **Renewal reminder** -- sent to members due for renewal (bulk or individual)
- **Blast** -- admin-composed, sent individually to each active member
- **Contact form** -- forwarded to the contact email from site settings
- **OTP** -- one-time login code for admin authentication

Every send is logged to the `emails_log` table.

## Security

- **Helmet** for HTTP security headers
- **CSRF tokens** on all forms (auto-rotated on each POST)
- **Rate limiting** on login (10/15 min) and on signup, donate, and contact (20/15 min)
- **bcrypt** for OTP hashing
- **Session cookies** are httpOnly and sameSite=lax
- **Multer** file uploads restricted to images (jpg/png/gif/webp), max 5 MB
- **Stripe webhook** verified by signature (skips CSRF, uses its own auth)

## Tech Stack

| Layer           | Technology                                              |
|-----------------|---------------------------------------------------------|
| Runtime         | Node.js + Express 5                                     |
| Templates       | Pug 3                                                   |
| Database        | SQLite (better-sqlite3) or PostgreSQL (pg) via env var  |
| Sessions        | express-session + connect-sqlite3 / connect-pg-simple   |
| Payments        | Stripe Checkout                                         |
| Email           | MailerSend (REST API via fetch)                         |
| Card generation | pdfkit (PDF) + canvas (PNG)                             |
| Security        | helmet, express-rate-limit, bcrypt, hCaptcha            |
| File uploads    | multer                                                  |
| Logging         | Winston + Morgan                                        |
| Dev tooling     | nodemon, dotenv                                         |

## Database Schema

Eleven tables defined in `db/schema.js`, applied by `db/migrate.js`. See [`db/README.md`](db/README.md) for the full
schema.

| Table              | Purpose                                                    |
|--------------------|------------------------------------------------------------|
| `members`          | Member profiles and status                                 |
| `payments`         | Stripe and manual payment records                          |
| `donations`        | Donation records (donor, amount, status, optional member)  |
| `announcements`    | Homepage news cards                                        |
| `gallery_images`   | Event gallery photos                                       |
| `bios`             | Board member bios                                          |
| `site_settings`    | Key-value config (hero text, dues, etc.)                   |
| `emails_log`       | Log of every outbound email                                |
| `membership_cards` | Generated card file paths                                  |
| `admins`           | Admin accounts, roles, and OTP state                       |
| `audit_log`        | Admin-initiated data changes with actor, old/new JSON diff |

## Route Map

### Public (`routes/index.js`)

| Method   | Path                  | Description                       |
|----------|-----------------------|-----------------------------------|
| GET      | `/`                   | Homepage                          |
| GET      | `/bios`               | Board bios                        |
| GET      | `/membership`         | Signup form                       |
| POST     | `/membership`         | Create member + Stripe Checkout   |
| GET      | `/membership/success` | Post-payment thank you            |
| GET      | `/membership/cancel`  | Payment cancelled                 |
| GET      | `/donate`             | Donation form                     |
| POST     | `/donate`             | Create donation + Stripe Checkout |
| GET      | `/donate/success`     | Post-donation thank you           |
| GET      | `/donate/cancel`      | Donation cancelled                |
| POST     | `/contact`            | Send contact email                |
| GET      | `/contact/success`    | Contact confirmation              |
| GET/POST | `/renew/:token`       | Member self-serve renewal         |

### Stripe (`routes/stripe.js`)

| Method | Path              | Description                          |
|--------|-------------------|--------------------------------------|
| POST   | `/stripe/webhook` | Handles `checkout.session.completed` |

### Admin (`routes/admin.js`) -- all require login except `/admin/login*`

| Method   | Path                                            | Description                           |
|----------|-------------------------------------------------|---------------------------------------|
| GET/POST | `/admin/login`                                  | Email OTP login                       |
| GET/POST | `/admin/login/verify`                           | OTP code verification                 |
| POST     | `/admin/login/resend`                           | Resend OTP code                       |
| POST     | `/admin/logout`                                 | Destroy session                       |
| GET      | `/admin/dashboard`                              | Stats + recent activity               |
| GET      | `/admin/members`                                | Member list                           |
| GET      | `/admin/members/export`                         | CSV export of members                 |
| GET      | `/admin/members/new`                            | New member form                       |
| POST     | `/admin/members`                                | Create member                         |
| GET/POST | `/admin/members/:id`                            | View + update member                  |
| POST     | `/admin/members/:id/delete`                     | Delete member                         |
| POST     | `/admin/members/:id/card`                       | Generate card                         |
| GET      | `/admin/members/:id/card/pdf`                   | Download PDF                          |
| GET      | `/admin/members/:id/card/png`                   | Download PNG                          |
| POST     | `/admin/members/:id/email-card`                 | Email card to member                  |
| POST     | `/admin/members/:id/send-renewal`               | Send renewal reminder to member       |
| POST     | `/admin/members/:id/payments`                   | Record manual payment                 |
| POST     | `/admin/members/:id/upgrade-to-family`          | Upgrade member to family plan         |
| POST     | `/admin/members/:id/attach-to-family`           | Attach member to existing family      |
| POST     | `/admin/members/:id/family-members`             | Add a family member                   |
| POST     | `/admin/members/:id/family-members/:fid/remove` | Remove a family member                |
| GET/POST | `/admin/announcements[/:id]`                    | CRUD                                  |
| POST     | `/admin/announcements/:id/delete`               | Delete                                |
| GET/POST | `/admin/gallery[/:id]`                          | CRUD                                  |
| POST     | `/admin/gallery/:id/delete`                     | Delete                                |
| GET/POST | `/admin/bios[/:id]`                             | CRUD                                  |
| POST     | `/admin/bios/:id/delete`                        | Delete                                |
| GET/POST | `/admin/settings`                               | Site settings (super_admin only)      |
| GET      | `/admin/payments`                               | Payment ledger                        |
| GET      | `/admin/payments/export`                        | CSV export of payments                |
| GET      | `/admin/donations`                              | Donations ledger                      |
| GET      | `/admin/emails`                                 | Email log                             |
| GET/POST | `/admin/emails/renewal`                         | Bulk renewal reminder composer + send |
| GET/POST | `/admin/emails/blast`                           | Compose + send blast                  |
| GET      | `/admin/audit`                                  | Audit log (super_admin only)          |
| GET/POST | `/admin/admins`                                 | Admin list + create (super_admin)     |
| POST     | `/admin/admins/:id/delete`                      | Remove admin (super_admin)            |

## License

ISC
