# routes/ -- Route Handlers

Express Router modules mounted in `server.js`.

## Files

### index.js -- Public Routes

Mounted at `/`. Handles all public-facing pages.

| Method | Path                  | Handler                                                                                                               |
|--------|-----------------------|-----------------------------------------------------------------------------------------------------------------------|
| GET    | `/`                   | Renders homepage with announcements + gallery from DB                                                                 |
| GET    | `/bios`               | Renders board bios from DB                                                                                            |
| GET    | `/membership`         | Membership signup form                                                                                                |
| POST   | `/membership`         | Validates form, creates pending member, generates member number, creates Stripe Checkout Session, redirects to Stripe |
| GET    | `/membership/success` | Thank-you page shown after Stripe payment                                                                             |
| GET    | `/membership/cancel`  | Shown when user cancels Stripe Checkout                                                                               |
| POST   | `/contact`            | Sends contact form submission via SendGrid to the site's contact email                                                |
| GET    | `/contact/success`    | Contact confirmation page                                                                                             |

The membership POST flow:
1. Validates required fields (first name, last name, email)
2. Checks for duplicate email
3. Generates a member number (`YSH-YYYY-NNNN`)
4. Inserts a pending member row
5. Reads dues amount from `site_settings`
6. Creates a Stripe Checkout Session with `metadata.member_id`
7. Redirects 303 to the Stripe-hosted payment page

### admin.js -- Admin Routes

Mounted at `/admin`. All routes except login/logout are protected by `requireAdmin`.

Multer (`upload.single('image')`) is applied as middleware on the entire `/admin` mount in `server.js`, so every admin POST automatically handles an optional `image` file upload.

**Auth:**
- `GET/POST /admin/login` -- Renders login form / validates password with bcrypt
- `POST /admin/logout` -- Destroys session, redirects to `/`

**Dashboard:**
- `GET /admin/dashboard` -- Shows total members, active members, total revenue, emails sent, recent members, and recent payments

**Members CRUD:**
- `GET /admin/members` -- Paginated list with search
- `GET /admin/members/new` -- New member form
- `POST /admin/members` -- Create member
- `GET /admin/members/:id` -- View member details, payments, cards, emails
- `POST /admin/members/:id` -- Update member
- `POST /admin/members/:id/delete` -- Delete member
- `POST /admin/members/:id/card` -- Generate PDF + PNG card
- `GET /admin/members/:id/card/pdf` -- Download PDF
- `GET /admin/members/:id/card/png` -- Download PNG
- `POST /admin/members/:id/email-card` -- Email card to member

**Content CRUD** (announcements, gallery, bios):
- List, new, create, edit, update, and delete routes for each
- Image uploads handled by multer middleware

**Settings:**
- `GET/POST /admin/settings` -- Edit site-wide settings (hero text, dues, etc.)

**Payments & Emails:**
- `GET /admin/payments` -- Paginated payment ledger
- `GET /admin/emails` -- Paginated email log
- `GET/POST /admin/emails/blast` -- Compose and send to all active members

### stripe.js -- Stripe Webhook

Mounted at `/stripe`.

| Method | Path              | Handler                                                                  |
|--------|-------------------|--------------------------------------------------------------------------|
| POST   | `/stripe/webhook` | Verifies the Stripe signature, then handles `checkout.session.completed` |

The webhook handler:
1. Verifies the event signature using `STRIPE_WEBHOOK_SECRET`
2. Extracts `member_id` from the session metadata
3. Marks the payment as `completed`
4. Activates the member (`status = 'active'`)
5. Generates a PDF + PNG membership card
6. Sends welcome, payment confirmation, and card delivery emails

The raw body middleware for this route is registered in `server.js` **before** `express.json()` to preserve the raw request body for Stripe signature verification.
