# Membership Periods

Membership periods represent a single club season (e.g., the 2026–27 season). All dues, electronic surcharges, and card
templates are configured per period. The membership signup form automatically uses the currently active period.

Navigate to **Periods** in the sidebar to manage periods. This section is visible to super admins only.

## Period Fields

| Field                    | Description                                                                                             |
|--------------------------|---------------------------------------------------------------------------------------------------------|
| **Name**                 | Human-readable label, e.g. `2026-27 Season`                                                             |
| **Start Date**           | First day of the membership period                                                                      |
| **End Date**             | Last day of the membership period                                                                       |
| **Individual Dues**      | Price in dollars for an individual membership                                                           |
| **Family Dues**          | Price in dollars for a family membership                                                                |
| **Electronic Surcharge** | Optional extra fee (dollars) added to online Stripe payments; does not apply to manual/offline payments |
| **Card Template**        | Optional PNG or PDF background image for this season's membership cards                                 |

## Active Period

The system determines the currently active period by finding the period whose date range includes today. If no period
covers today, the membership signup form shows a "memberships closed" message and Stripe checkout is unavailable.

Only one period should be active at a time. Overlapping periods are not recommended.

## Creating a Period

1. Click **New Period**.
2. Fill in the name, start date, end date, and dues amounts.
3. Optionally upload a card template (PNG or PDF).
4. Click **Save**.

## Editing a Period

1. Click **Edit** on the period you want to change.
2. Update any fields. To replace the card template, upload a new file — leave the field blank to keep the existing
   template.
3. Click **Save**.

Changes to dues affect all future signups. They do not retroactively alter existing payments.

## Card Templates

Upload a seasonal card background image here. PNG files are used directly; PDF files are auto-converted to PNG by
Ghostscript and ImageMagick. The converted image is stored in `public/img/` and served as the card background when
generating cards for members enrolled in this period.

If no template is uploaded for a period, the default template (`public/img/card-template.png`) is used.

## Enrollment

When a member completes payment through Stripe for a given period, they are automatically enrolled in that period via
the `membership_years` table. Manual payments recorded through the admin are also enrolled against the current period.

You can view which period a member is enrolled in from their detail page.

## Backfilling Existing Members

If you have existing members who were active before periods were introduced, use the backfill script to enroll them:

```bash
# Preview what would be enrolled (dry run)
node scripts/backfill-membership-years.js --dry-run

# Actually enroll
node scripts/backfill-membership-years.js
```

The script uses three strategies (in order) to match each member to a period:

1. `membership_year` field on the member record
2. Payment date falls within the period's date range
3. `expiry_date` falls within the period

Family sub-members are automatically enrolled when their primary is enrolled.
