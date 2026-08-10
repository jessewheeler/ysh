# Campaign Tracking

Campaigns answer "did the flyer work?" You create a campaign in the admin, hand out the link it
generates (or the QR code), and the admin then shows how many people arrived, how many signed up,
and how many sent a message through the contact form.

## Creating a campaign

**Admin → Campaigns → + New Campaign.**

| Field | What it does |
|---|---|
| **Campaign Name** | For your reference only. Never appears in the link. |
| **Campaign Code** (`utm_campaign`) | The value matched on inbound links. Lowercase letters, numbers, dots, dashes, underscores. Keep it short — it ends up printed on a flyer. |
| **Target Page** | Where the link lands. A path on this site, starting with `/`. Use `/membership` to drop people straight on the signup form. |
| **Source** (`utm_source`) | Where the link lives: `print`, `facebook`, `newsletter`, `instagram`. |
| **Medium** (`utm_medium`) | The kind of placement: `flyer`, `qr`, `post`, `email`, `banner`. |
| **Content** (`utm_content`) | Optional. Use it to tell two versions of the same campaign apart — `table-tent` vs `poster`. |

Source, medium and content are recorded on each visit but are not what identifies the campaign —
only the code is. Two campaigns cannot share a code.

The detail page shows the finished link, for example:

```
https://ysh.example.com/membership?utm_source=print&utm_medium=flyer&utm_campaign=flyer26
```

These are the standard UTM parameter names, so the same links also report correctly in Google
Analytics or anything else that understands UTM tagging.

## QR codes

Every campaign gets a QR code generated from its link, so a scan counts as a visit like any other
click. Both downloads are on the campaign detail page:

- **PNG** — for a Facebook post, an email, or a slide.
- **SVG** — for anything printed larger than about two inches. It stays sharp at any size.

Print the SVG whenever you can. A PNG blown up to poster size will look soft, and a soft QR code
is a QR code that doesn't scan.

## How attribution works

Attribution is **first-touch** and lasts for the visitor's session (a 7-day cookie).

- The first tracked link someone arrives through is the campaign they're credited to.
- If they come back later through a different campaign, the first one keeps the credit — but the
  second campaign still gets credit for the visit.
- A membership signup records the campaign on the **primary member** only. Family members added to
  the same signup carry no campaign, so a family join counts as one signup, not four.
- Renewals never overwrite the campaign from the original signup.

## Reading the numbers

- **Visits** — one per visitor per campaign, no matter how many times they reload. Known bots and
  link-preview fetchers (Facebook's crawler, Googlebot, `curl`) are filtered out. Visits older than
  two years are deleted automatically on startup.
- **Signups** — primary members whose signup carried the campaign.
- **Contacts** — contact-form submissions that carried the campaign.
- **Conversion** — signups ÷ visits. Shows `—` when there are no visits, rather than a misleading 0%.

Counts are honest but not precise. A visitor who blocks cookies, or who scans the QR on a phone and
signs up later on a laptop, will show up as a visit with no signup. Treat the numbers as a
comparison between campaigns, not as an exact tally.

Use **Export .csv** on the campaigns list to get every campaign with its counts in a spreadsheet.

## Retiring a campaign

**Deactivate** it rather than deleting it. Deactivating stops attribution — useful once a flyer's
event has passed — while keeping the history the campaign already collected. Links already in print
keep working; they simply stop being counted. Reactivate at any time.

## Contact Us submissions

**Admin → Contact Us** lists every message sent through the homepage contact form, with the
campaign it came from and whether the notification email actually went out. Messages are stored
even when that email fails, so a mail outage no longer loses the message.

## Implementation notes

| Piece | Where |
|---|---|
| Inbound `utm_campaign` → session + visit row | `middleware/campaign.js` |
| Link building, QR generation, validation | `services/campaigns.js` |
| Data access | `db/repos/campaigns.js`, `campaignVisits.js`, `contactSubmissions.js` |
| Admin routes and views | `routes/admin.js`, `views/admin/campaigns/` |
| Conversion attribution | `routes/index.js` (`POST /membership`, `POST /contact`) |
| Two-year visit prune | `pruneCampaignVisits()` in `db/migrate.js` |

Tables: `campaigns`, `campaign_visits`, `contact_submissions`, plus `members.campaign_id`.

`members.campaign_id` is added by an ALTER in `db/migrate.js` rather than living in
`db/schema.js`, because `members` is created before `campaigns` and `campaigns.created_by` points
back at `members` — PostgreSQL rejects a forward `REFERENCES` at `CREATE TABLE` time. The same
ALTER is mirrored in `test/helpers/db.js`.

Visits are the one write path that deliberately skips `audit_log`; they are high-volume system
writes with no actor, treated the same way as `setOtp` and `setRenewalToken`.
