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
| **Failed** | Stripe declined the card, or the checkout session expired unpaid |
| **Refunded** | Reserved — refunds are not currently recorded in YSH; issue and track them in the Stripe Dashboard |

A payment sitting at **Pending** for more than a few minutes means the member never finished checkout. Both **Pending**
and **Failed** payments feed the **Needs attention** filter on the Members page — see
[Managing Members](02-managing-members.md).

## Dues and Pricing

Membership dues are configured per season in **Periods** (super admin only), not in Settings. Each period defines:

- **Individual dues** (dollars)
- **Family dues** (dollars)
- **Electronic surcharge** (dollars, optional) — added as a separate line item on the Stripe Checkout page for online
  payments; offline/manual payments do not include this charge

See [Membership Periods](08a-membership-periods.md) for details on managing seasons and pricing.

## Stripe Dashboard

For refunds, disputes, or detailed transaction investigation, log into the Stripe Dashboard directly. The payment ledger in YSH is a read-only view of transaction records.

### Required Webhook Events

Under **Developers > Webhooks**, the YSH endpoint must be subscribed to all three of these:

| Event | Why it is needed |
|-------|------------------|
| `checkout.session.completed` | Activates the member, enrolls them in the season, generates cards, sends email. Without it members stay **Pending** after paying. |
| `checkout.session.expired` | Marks an abandoned checkout as **Failed**. |
| `payment_intent.payment_failed` | Records a declined card as **Failed**, with Stripe's reason. |

The last two are what make declined payments visible. If they are not subscribed, the **Payment failed** badge on the
Members page will silently never appear — the list will look clean when it isn't. Adding them is safe at any time, but
only affects payments made afterwards; earlier failures were never recorded and cannot be recovered.
