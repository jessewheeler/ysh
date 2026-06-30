# Payments & Stripe

## How Payments Work

The membership signup flow uses Stripe Checkout:

1. A visitor fills out the membership form on the public site.
2. The server creates a Stripe Checkout Session and redirects the visitor to Stripe's hosted payment page.
3. After successful payment, Stripe fires a `checkout.session.completed` webhook back to the server.
4. The webhook handler activates the member, records the payment, generates membership cards, and sends welcome and confirmation emails.

No admin action is needed for this flow — it is fully automated.

## Payment Ledger

Navigate to **Payments** in the sidebar to view the payment ledger. It shows 25 entries per page with the following columns:

- **Date** — when the payment was recorded
- **Member** — linked member name
- **Amount** — payment amount in dollars
- **Status** — payment status (see below)
- **Stripe ID** — the Stripe transaction identifier

## Payment Statuses

| Status | Meaning |
|--------|---------|
| **Pending** | Checkout session created but not yet completed |
| **Completed** | Payment confirmed by Stripe webhook |
| **Failed** | Payment attempt was unsuccessful |
| **Refunded** | Payment was refunded through Stripe |

## Dues and Pricing

Membership dues are configured per season in **Periods** (super admin only), not in Settings. Each period defines:

- **Individual dues** (dollars)
- **Family dues** (dollars)
- **Electronic surcharge** (dollars, optional) — added as a separate line item on the Stripe Checkout page for online
  payments; offline/manual payments do not include this charge

See [Membership Periods](08a-membership-periods.md) for details on managing seasons and pricing.

## Stripe Dashboard

For refunds, disputes, or detailed transaction investigation, log into the Stripe Dashboard directly. The payment ledger in YSH is a read-only view of transaction records.
