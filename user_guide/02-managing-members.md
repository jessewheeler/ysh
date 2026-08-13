# Managing Members

## Member List

Navigate to **Members** in the sidebar. The list displays 25 members per page and can be searched by name, email, or member number using the search bar at the top.

Each row shows the member's name, email, member number, status, and join date.

Above the list is a row of filter pills, each with a count:

| Pill                 | Shows                                                              |
|----------------------|--------------------------------------------------------------------|
| **All**              | Every member                                                       |
| **Active**           | Paid and in good standing                                          |
| **Needs renewal**    | Expiring within the next 30 days and not yet renewed               |
| **Recently renewed** | Renewed in the last 30 days                                        |
| **Pending**          | Signed up, payment not completed                                   |
| **Lifetime**         | Lifetime members                                                   |
| **Needs attention**  | Looks like they tried to join or renew and something went wrong     |

See [Needs Attention](#needs-attention) below for the last one.

## Member Statuses

| Status        | Meaning                                         |
|---------------|-------------------------------------------------|
| **Pending**   | Signed up but payment has not been completed    |
| **Active**    | Payment confirmed; full member in good standing |
| **Expired**   | Membership period has lapsed                    |
| **Cancelled** | Membership was manually cancelled by an admin   |

## Adding a Member

1. Click **Add Member** on the members list page.
2. Fill in the required fields: first name, last name, and email.
3. A member number in the format `YSH-YYYY-NNNN` is generated automatically.
4. Set the initial status (defaults to pending).
5. Click **Save**.

## Editing a Member

1. Click a member's name in the list to open their detail page.
2. Update any fields and click **Save**.
3. You can change status here — for example, marking a member as expired or cancelled.

## Member Detail Page

The detail view includes three additional panels beyond the edit form:

- **Payment History** — all payments linked to this member
- **Membership Cards** — previously generated cards available for download
- **Email Log** — every email sent to this member

## Searching

Type a query into the search bar and press Enter. The search matches against:

- First and last name
- Email address
- Member number (e.g., `YSH-2026-0012`)

Clear the search field and press Enter to return to the full list.

Search combines with the other filters rather than replacing them. A search inside the **Needs attention** pill
searches only the flagged members, and the same is true of the period and status dropdowns. **Clear filters** appears
whenever any of them is active.

## Family Memberships

A family membership has a primary member and up to 6 additional family members. Family members share the primary's
payment and receive their own membership cards.

From a member's detail page:

- **Upgrade to Family** — converts an individual member to a family primary
- **Add Family Member** — adds a sub-member to an existing family primary
- **Attach to Family** — links an existing individual member as a sub-member of a family

Family sub-members are hidden in the main list. They appear in the primary member's detail page under **Family Members
**.

## Cancelled Members

Cancelled members cannot self-serve renew through the membership form. If a cancelled member tries to sign up, they see
a message directing them to contact the club. An admin must manually update their status to active or pending before
they can renew.

## Renewal Reminders

See [Email System](06-email-system.md) for bulk and individual renewal reminder workflows.

### Generating a Renewal Link

**Generate Renewal Link** on a member's page gives you their renewal link directly, without sending anything. Use it
when email isn't the right channel — you have them on the phone, you're texting them, or their address is bouncing.
Click it, then use **Copy link** to put the URL on your clipboard.

The link goes straight to the renewal form with their details already filled in, so it is specific to that one member —
don't post it publicly or forward it to anyone else. It works for 30 days. Generating a link does not invalidate one you
emailed earlier; it hands back the same link and resets the 30 days.

The link only shows once. Leave the page and it's gone — click the button again to get it back.

## Needs Attention

This is the outreach list. It collects members who look like they *meant* to join or renew but didn't finish — the
people who fall through the cracks because nothing else in the app flags them. A pending signup that died at the
payment screen looks exactly like one created five minutes ago, and a renewal reminder that landed in someone's spam
folder leaves no visible trace.

Members who have **already paid for the current season** never appear here, no matter what went wrong for them earlier —
there is nothing to chase. Lifetime and cancelled members are excluded too. What's left is people who have not renewed
for this season or never finished joining in the first place.

Note that this is based on whether they are enrolled in the current membership period, not on the **Active** badge in
the status column. A member can show as Active and still belong on this list, because nothing automatically flips a
member to Expired when their membership lapses.

Click the **Needs attention** pill. Each row is badged with the problem or problems found:

| Badge                     | What it means                                                                                    | What to do                                                                                              |
|---------------------------|--------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| **Reminded, not renewed** | They have received several renewal reminders and still haven't renewed                            | Call or text. Repeated silence usually means the emails are being filtered, not ignored                 |
| **Payment failed**        | Stripe declined their card and they have not paid since                                          | Call. Most people don't realize it failed. Ask them to retry, or take a check                            |
| **Checkout not finished** | They reached the payment screen and never completed it                                            | Call. Often a card they didn't have on hand, or a checkout they meant to come back to                    |
| **Never reached checkout**| They submitted the signup form but never got to payment                                          | Call. This can mean the signup itself errored, so confirm their details are right before asking them to retry |
| **Duplicate signup**      | Two unpaid signups exist for the same email address                                              | Sort out which record is real and delete the other **before** calling, so you don't set up a double charge |
| **Email send failed**     | An email to them failed and nothing has reached that address since                                | Do not email — phone them, and check the address on file for a typo                                       |
| **Renewal never started** | Their membership has lapsed and they were sent a renewal link they never used                     | Call. They may not have seen the reminder at all                                                          |

Hover a badge to see a longer description. A member can carry more than one badge — someone who signed up twice and had
a card declined shows both.

Most of these say "call" or "text," which raises the obvious question of what to send them once you have them. Open the
member and use [Generate Renewal Link](#generating-a-renewal-link) — that gives you a link you can read out or text,
which is the whole point for the members whose email clearly isn't reaching them.

### Working the list

- Use the **Any problem** dropdown to narrow to a single badge, so you can batch similar calls together. The list
  updates as soon as you change the dropdown.
- **Export CSV** downloads the current list with a **Signals** column containing each member's problems, which is what
  makes it usable as a call sheet. The export respects whatever filters are active.
- Combine with the search box or the period and status dropdowns to narrow further.

### Expect a backlog the first time

The first time you open this pill, it will likely be long. It is reporting problems going back several months, not just
today's, so treat the first pass as a cleanup project rather than a daily queue. After you work through it once, the
list should stay short and a growing count is a signal worth investigating.

Two more things worth knowing:

- **Payment failed** only reports declines that Stripe told us about. It stays empty unless the Stripe webhook events
  are configured — see [Payments & Stripe](04-payments-and-stripe.md).
- **Email send failed** catches emails that could not be sent at all, and clears itself once anything reaches that
  address again — so a past outage on our mail provider won't leave people badged. On a family membership it flags the
  primary rather than every member sharing the address, unless a specific person's own email failed. It does **not**
  catch email that was accepted and then bounced, or that landed in a spam folder — the app cannot see either. See
  [Email System](06-email-system.md).

The thresholds behind these badges (how many reminders, how long an unfinished checkout has to sit, how far back to
look) are configurable — see [Site Settings](07-site-settings.md).
