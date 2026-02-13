# Email System

## Overview

YSH sends email through SendGrid. All outbound emails — whether automated or manually composed — use a branded HTML template with a navy header, white body, and gray footer.

Every email is logged to the database regardless of whether it succeeded or failed.

## Automated Emails

The following emails are sent automatically:

| Email | Trigger | Recipient | Contents |
|-------|---------|-----------|----------|
| Welcome | Stripe payment | New member | Membership details and a welcome message |
| Payment Confirmation | Stripe payment | New member | Receipt with amount, date, and member number |
| Card Delivery | Stripe payment | New member | PDF and PNG membership card attachments |
| OTP Login Code | Admin login | Admin | 6-digit one-time login code (expires in 10 min) |
| Contact Form | Form submission | Site contact | Visitor's name, email, and message |

## Sending an Email Blast

Email blasts let you send a message to all active members at once.

1. Navigate to **Emails** in the sidebar.
2. Click **Compose Blast**.
3. Enter a **Subject** line and compose the **Body** in HTML.
4. The page displays the current count of active members who will receive the email.
5. Click **Send** to dispatch the blast.

Each active member receives an individual email (not CC/BCC). Delivery results are recorded in the email log.

## Email Log

The email log is accessible from the **Emails** section. It shows a complete history of all outbound emails with:

- **Date** — when the email was sent
- **Recipient** — email address
- **Subject** — email subject line
- **Status** — sent or failed
- **Member** — linked member (if applicable)

Use the log to verify that automated emails were delivered or to diagnose delivery issues.

## Troubleshooting Delivery

If emails show as **failed** in the log:

1. Verify the `SENDGRID_API_KEY` and `FROM_EMAIL` environment variables are set correctly.
2. Check that the sender email is verified in your SendGrid account.
3. Review SendGrid's Activity Feed for bounce or block details.
