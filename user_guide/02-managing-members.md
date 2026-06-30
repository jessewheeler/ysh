# Managing Members

## Member List

Navigate to **Members** in the sidebar. The list displays 25 members per page and can be searched by name, email, or member number using the search bar at the top.

Each row shows the member's name, email, member number, status, and join date.

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
