# Troubleshooting

## Login Issues

**Problem:** Cannot log in to the admin panel.

- Verify your email address has an admin account. Admins are created with:
  ```
  npm run create-admin you@example.com super_admin "Your Name"
  ```
- If you are not receiving the login code email, check your spam folder and verify that `MAILERSEND_API_KEY` and `FROM_EMAIL` are configured correctly in `.env`.
- Each OTP code expires after 10 minutes. If your code has expired, click **Resend code** on the verification page.
- After 5 failed code attempts, the code is locked. Click **Resend code** to get a fresh one.
- Login is rate-limited to 10 attempts per 15 minutes. If you have been locked out, wait 15 minutes and try again.

**Problem:** Cannot access Settings or Admins page.

- Only super admins can access Settings and the Admins management page. Editors are redirected to the dashboard with a permission error. Ask a super admin to upgrade your role if needed.

## Members Stuck in Pending

**Problem:** A member signed up but their status never changed to active.

- Check the **Payments** ledger for their transaction. If the payment shows as pending, the Stripe webhook may not have fired.
- Verify the `STRIPE_WEBHOOK_SECRET` environment variable matches the secret in your Stripe Dashboard under Developers > Webhooks.
- Check server logs for webhook errors.
- As a workaround, you can manually set the member's status to active from their detail page.

## Emails Not Sending

**Problem:** Emails show as failed in the email log.

- Confirm `MAILERSEND_API_KEY` and `FROM_EMAIL` are set in your `.env` file.
- Ensure the sender domain is verified in your MailerSend account under Domain Settings.
- Check MailerSend's Activity log for bounces, blocks, or suppressions.
- If the API key was recently rotated, restart the server after updating `.env`.

## Members Missing from Sender.net

**Problem:** A member does not appear in Sender, or sits in the wrong group.

- Confirm `SENDER_API_TOKEN`, `SENDER_GROUP_CURRENT`, and `SENDER_GROUP_LAPSED` are set in `.env`. With any of them missing the sync is skipped silently by design, and nothing reaches Sender.
- Check the server log for `Sender sync failed for member`. Sync failures are recorded there rather than surfaced in admin, because they must never interrupt a payment or an admin save.
- Verify the two group IDs match real groups in your Sender account. A deleted or mistyped group ID makes every group call fail.
- Confirm the custom fields `member_number` and `membership_expires` exist in Sender. It rejects writes to field names it does not know.
- Members with a status of pending or cancelled are in no group on purpose. Check the member's status before treating this as a fault.
- Family members who share the primary's email address appear once, under the primary's name. This is intentional: Sender identifies subscribers by email.
- To repair anything out of step, run `node scripts/sync-sender.js`. Use `--dry-run` first to see what it would change.

## Council Report Board Block Is Wrong Or Incomplete

**Problem:** Someone is missing from the board block, or a row is blank.

- The block lists every **visible** board bio. A hidden bio is left off; check the Visible
  toggle under **Board Bios**.
- Order follows the bio **Sort Order**, top to bottom.
- The block holds ten people. An eleventh visible bio is named in a warning and left off,
  because the Council's box has no row for it. Hide a bio or change sort orders to choose.
- A blank Position cell means the bio has no **Role**. A blank email means it has no
  **Email**. The report page links to the bio in both cases.
- Titles are written exactly as saved, so a typo in a Role reaches the Council unchanged.

## Council Report Shows The Wrong Members

**Problem:** The member count or roster on the report is not what you expect.

- The report lists everyone enrolled in the **selected period**, plus the family members of
  anyone enrolled. Check the period dropdown; it defaults to the current season, which is
  not always the one you are reporting on.
- A member who paid but is missing is probably not enrolled in that period. Look at the
  member's detail page to see which seasons they are enrolled in.
- Cancelled members are excluded on purpose.
- Family members appear as separate rows by design. The Council requires each person listed
  individually and forbids grouping entries.

## Card Generation Fails

**Problem:** Clicking "Generate Card" produces an error or downloads an error page instead of a PDF.

- The `data/cards/` directory must exist and be writable by the server process. Verify with:
  ```
  ls -la data/cards/
  ```
- Card generation depends on the `canvas` and `pdfkit` packages. If either is missing, run `npm install`.
- On Linux servers, the `canvas` package requires system libraries. Install them with:
  ```
  sudo apt-get install build-essential libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev librsvg2-dev
  ```
- If the card file is missing from disk (e.g., after a deploy or directory wipe), click **Generate Card** on the
  member's detail page to recreate it before downloading.

## Card Template Upload Fails (PDF Conversion)

**Problem:** Uploading a PDF card template produces an error or the template does not appear.

- PDF-to-PNG conversion requires **Ghostscript** (`gs`) and **ImageMagick**. Verify they are installed:
  ```
  gs --version
  magick --version || convert --version
  ```
- If either tool is missing, install it:
  ```
  # Ghostscript
  sudo apt-get install ghostscript
  # ImageMagick
  sudo apt-get install imagemagick
  ```
- ImageMagick 7 uses `magick`; ImageMagick 6 (default on Ubuntu LTS / Render) uses `convert`. The app tries both automatically.
- Check that the `data/` directory is writable; the conversion uses a temporary file there.

## Images Not Uploading

**Problem:** Image uploads fail or produce an error.

- For gallery, bios, and general content: only JPG, PNG, GIF, and WebP files are accepted.
- For card templates (Periods): PNG and PDF files are accepted.
- Maximum file size is 5 MB. Resize or compress larger files before uploading.
- The `uploads/` directory must exist and be writable.

## Membership Signup Shows "Memberships Closed"

**Problem:** The `/membership` page shows that memberships are not currently available.

- The system requires an active membership period whose date range includes today. Navigate to **Periods** (super admin)
  and verify that a period exists with a start date on or before today and an end date on or after today.
- If no such period exists, create one. The signup form and Stripe Checkout will become available immediately.

## Stripe Payments Not Processing

**Problem:** Visitors see an error on the membership signup page.

- Confirm `STRIPE_SECRET_KEY` is set correctly in `.env` and the Stripe publishable key is configured in **Admin > Settings**.
- Ensure the Stripe account is active and not in restricted mode.
- Check that the webhook endpoint URL is configured in Stripe's Dashboard and points to your server's `/stripe/webhook` route.

## Database Issues

**Problem:** The application starts but pages show errors about missing tables.

- Run migrations to ensure all tables exist:
  ```
  npm run migrate
  ```
- To reset the database with default seed data:
  ```
  npm run seed
  ```
  Note: seeding repopulates default content but does not delete existing member or payment data.

## Server Won't Start

- Check that all required environment variables are set. See `.env.example` for the full list.
- Ensure Node.js 18 or later is installed: `node --version`.
- Run `npm install` to make sure all dependencies are present.
- Check the console output for specific error messages.
