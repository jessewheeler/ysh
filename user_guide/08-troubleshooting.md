# Troubleshooting

## Login Issues

**Problem:** Cannot log in to the admin panel.

- Verify your email address has an admin account. Admins are created with:
  ```
  npm run create-admin you@example.com super_admin "Your Name"
  ```
- If you are not receiving the login code email, check your spam folder and verify that `SENDGRID_API_KEY` and `FROM_EMAIL` are configured correctly in `.env`.
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

- Confirm `SENDGRID_API_KEY` and `FROM_EMAIL` are set in your `.env` file.
- Ensure the sender address (`FROM_EMAIL`) is verified in your SendGrid account under Sender Authentication.
- Check SendGrid's Activity Feed for bounces, blocks, or suppressions.
- If the API key was recently rotated, restart the server after updating `.env`.

## Card Generation Fails

**Problem:** Clicking "Generate Card" produces an error.

- The `data/cards/` directory must exist and be writable by the server process. Verify with:
  ```
  ls -la data/cards/
  ```
- Card generation depends on the `canvas` and `pdfkit` packages. If either is missing, run `npm install`.
- On Linux servers, the `canvas` package requires system libraries. Install them with:
  ```
  sudo apt-get install build-essential libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev librsvg2-dev
  ```

## Images Not Uploading

**Problem:** Image uploads fail or produce an error.

- Only JPG, PNG, GIF, and WebP files are accepted.
- Maximum file size is 5 MB. Resize or compress larger images before uploading.
- The `uploads/` directory must exist and be writable.

## Stripe Payments Not Processing

**Problem:** Visitors see an error on the membership signup page.

- Confirm `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` are set correctly in `.env` and **Settings**.
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
