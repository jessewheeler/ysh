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

## Newsletter Lists in Sender.net

Club newsletters and campaigns are sent from Sender.net, not from the blast tool. The member list is copied there automatically so you never have to maintain it by hand.

Members land in one of two groups:

| Group | Who is in it |
|-------|--------------|
| **Current** | Members in good standing, including lifetime members |
| **Lapsed** | Members whose membership has expired |

People who started a signup but never paid, and members marked cancelled, are in neither group. They stay in your Sender account as subscribers but receive nothing sent to a group. Because of that, sending to all subscribers rather than to a group reaches people who never joined and people who cancelled — send to **Current** (and **Lapsed**, if you mean to reach them) instead.

A member's group is updated when their payment goes through, when they renew, when you add them in admin, when you record a payment against their account, when you delete them, and whenever you save a change to their record.

Membership expiry is judged by the expiry date on the record, not by anything an administrator has to set — so a member whose date has passed counts as Lapsed. Nothing fires on the day a membership expires, though: they move to the Lapsed group the next time their record is touched or the full refresh below runs. Run the refresh on a regular schedule (monthly, or after each renewal season) or the Lapsed group will lag behind reality.

Family memberships appear in Sender as a single subscriber under the primary member's name, because everyone on a family membership shares one email address.

### When a member changes their email

Changing an email address in admin adds the new address to Sender. The old address stays as a separate subscriber, because Sender does not allow an existing subscriber to be renamed. If someone tells you they still get club email at an old address, they can unsubscribe from it using the link in the footer.

### Refreshing the whole list

An administrator with server access can re-copy every member into Sender by running `node scripts/sync-sender.js`. Adding `--dry-run` reports what would change without sending anything. The sync only ever adds and regroups; it never deletes subscribers, so running it again is safe.

Nothing runs this on a schedule yet, so it is a manual step. It is also the repair mechanism when Sender is briefly unreachable during a signup — the club site never fails a payment over a newsletter sync, it just logs the miss and carries on.

## Troubleshooting Delivery

If emails show as **failed** in the log:

1. Verify the `MAILERSEND_API_KEY` and `FROM_EMAIL` environment variables are set correctly.
2. Check that the sender domain is verified in your MailerSend account.
3. Review MailerSend's Activity log for bounce or block details.
