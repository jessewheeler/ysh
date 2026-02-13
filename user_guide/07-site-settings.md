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
| Dues Amount | Membership fee in cents | `2500` (= $25.00) |
| Contact Email | Email address that receives contact form submissions | `info@ysh.org` |
| Stripe Publishable Key | Public Stripe key used on the membership form | `pk_live_...` |

## Editing Settings

1. Update any field on the settings page.
2. Click **Save**.
3. Refresh the public site to confirm your changes.

## Notes

- **Dues Amount** is stored in cents. Enter `2500` for $25.00, `5000` for $50.00, etc. This value is passed to Stripe when creating checkout sessions, so changes affect all future signups.
- **Stripe Publishable Key** is the public key only. The secret key and webhook secret are configured as environment variables and are not editable through the admin interface.
- **Contact Email** determines where contact form submissions are delivered. Make sure this is a monitored inbox.
