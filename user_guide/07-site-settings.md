# Site Settings

Navigate to **Settings** in the sidebar to configure site-wide values. Changes take effect immediately on the public site. Only super admins can access this page — editors will be redirected to the dashboard.

## Available Settings

| Setting | Description | Example |
|---------|-------------|---------|
| Hero Text | Main headline on the homepage | `Yellowstone Sea Hawkers` |
| Hero Subtitle | Text below the headline | `Billings, Montana's Seahawks Booster Club` |
| Hero Button Text | Call-to-action button label | `Join Now` |
| Hero Button URL | Where the button links to | `/membership` |
| About Quote | Short quote displayed in the about section | `Go Hawks!` |
| About Text | Full about section content | (paragraph of text) |
| Gallery Album URL | External link to a full photo album | `https://photos.example.com/album` |
| Contact Email | Email address that receives contact form submissions | `info@ysh.org` |
| Stripe Publishable Key | Public Stripe key used on the membership form | `pk_live_...` |
| Send Reminders (days before expiry) | How far ahead of expiry a member is included in renewal reminder sends | `30` |
| Reminders Before Flagging | Renewal reminders a member must receive before the **Needs attention** list flags them | `2` |
| Unfinished Checkout Age (hours) | How long a payment may sit unfinished before it counts as abandoned | `24` |
| Lookback Window (days) | How far back the **Needs attention** list looks for problems | `180` |

> **Note:** Membership dues are no longer configured here. They are managed per season in **Periods** (super admin
> only). See [Membership Periods](08a-membership-periods.md).

## Editing Settings

1. Update any field on the settings page.
2. Click **Save**.
3. Refresh the public site to confirm your changes.

## Notes

- **Stripe Publishable Key** is the public key only. The secret key and webhook secret are configured as environment variables and are not editable through the admin interface.
- **Contact Email** determines where contact form submissions are delivered. Make sure this is a monitored inbox.
- The three **Needs Attention** thresholds tune the outreach list on the Members page (see
  [Managing Members](02-managing-members.md)). They trade completeness against noise:
  - Lowering **Reminders Before Flagging** widens the list, flagging people sooner after their first reminder.
  - Raising **Unfinished Checkout Age** stops flagging people who are still mid-checkout. Lowering it catches abandoned
    checkouts faster but will include some people who are simply still typing.
  - Lowering **Lookback Window** shortens the list to recent problems only. Raise it if you want to sweep further back
    through history, but expect old, already-resolved cases to reappear.
