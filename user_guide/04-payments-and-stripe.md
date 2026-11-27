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

## Donations

The **Donate** button in the site menu takes a one-off gift by card. Donations are separate from membership
payments: they have their own page under **Donations** in the admin menu and do not appear in the payment ledger.

### What the donor sees

- A dropdown to choose where the gift goes (the *fund*).
- Amount buttons for $12, $25, $50 and $100, plus **Other** for any amount from $1 to $10,000. $12 is selected to start.
- **Add $X to cover the card processing fee** — unticked by default. The form shows the exact amount before they tick it.
- **Give anonymously** — unticked by default. When ticked, the site records no name or email for that gift.
  Stripe still asks for an email on its own page so it can send a receipt, and that stays with Stripe.

A named donor gets a thank-you email from us. An anonymous donor gets Stripe's receipt only, so make sure
**Settings > Customer emails > Successful payments** is turned on in the Stripe Dashboard.

### The Donations page

- **Donations / Given** — completed gifts only. "Given" excludes anything donors added to cover fees.
- **Fees Covered by Donors** — the total donors chose to add.
- **Est. Fees We Absorbed** — an estimate of the card fees left for the chapter, at 2.9% + 30¢ per donation. Use it
  to judge whether fees are worth worrying about; the Stripe Dashboard has the exact figures.
- **By Fund** — how much each fund has received.
- **All Donations** — every attempt, newest first. **Pending** means the donor reached Stripe but has not paid;
  it becomes **Failed** if they abandon the checkout.

A donation made with an email address that matches a member is tied to that member. It shows a **member** badge in
the list and appears in the **Donation History** table on the member's page, with their lifetime giving.
Anonymous gifts are never tied to a member.

### Managing funds (super admins)

**Donations > Manage Funds** lists the choices in the donor's dropdown.

- **Add a Fund** — give it a name and a sort order (lower numbers appear first).
- **Rename or reorder** — edit the row and click **Save**.
- **Retire** — removes the fund from the dropdown. Donations already made to it stay in the totals. **Restore**
  brings it back.

Funds cannot be deleted. If every fund is retired, the donate page shows a "not open right now" message.

To link straight to a fund, add its name to the address in lowercase with dashes, for example
`/donate?fund=heart-wheels`.

## Stripe Dashboard

For refunds, disputes, or detailed transaction investigation, log into the Stripe Dashboard directly. The payment ledger in YSH is a read-only view of transaction records.

### Required Webhook Events

Under **Developers > Webhooks**, the YSH endpoint must be subscribed to all three of these:

| Event | Why it is needed |
|-------|------------------|
| `checkout.session.completed` | Activates the member, enrolls them in the season, generates cards, sends email. Without it members stay **Pending** after paying. Also marks a donation completed and sends the thank-you. |
| `checkout.session.expired` | Marks an abandoned checkout as **Failed** (membership payments and donations). |
| `payment_intent.payment_failed` | Records a declined card as **Failed**, with Stripe's reason. |

The last two are what make declined payments visible. If they are not subscribed, the **Payment failed** badge on the
Members page will silently never appear — the list will look clean when it isn't. Adding them is safe at any time, but
only affects payments made afterwards; earlier failures were never recorded and cannot be recovered.
