# Email System

## Overview

YSH sends email through MailerSend. All outbound emails — whether automated or manually composed — use a branded HTML template with a navy header, white body, and gray footer.

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

1. Verify the `MAILERSEND_API_KEY` and `FROM_EMAIL` environment variables are set correctly.
2. Check that the sender domain is verified in your MailerSend account.
3. Review MailerSend's Activity log for bounce or block details.

To find *which members* were affected rather than which messages, use the **Needs attention** filter on the Members
page and narrow to **Email send failed** — see [Managing Members](02-managing-members.md). That gives you a list of
people to phone instead of email.

### What the log cannot tell you

A **sent** status means only that MailerSend accepted the message for delivery. It does **not** mean the member
received it. Email that was accepted and then bounced, or that was delivered straight into a spam folder, looks
identical to email that was read — YSH receives no delivery notifications back from MailerSend, so none of it is
visible here or anywhere else in the admin.

This matters most for renewal reminders. If a member insists they never got one, the log showing **sent** does not
contradict them. The **Reminded, not renewed** badge on the Members page exists for exactly this case: repeated
reminders with no response is the closest thing to evidence of spam filtering that the app can offer. Check MailerSend's
own Activity log for the actual delivery outcome.
