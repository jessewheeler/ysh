# Getting Started

## Admin Accounts

YSH uses individual admin accounts with email-based login. There are two roles:

| Role | Access |
|------|--------|
| **Super Admin** | Full access — can manage all content, settings, and admin accounts |
| **Editor** | Can manage content (members, announcements, gallery, bios, payments, emails) but cannot access Settings or admin accounts |

### Creating Your First Admin

Before you can log in, create an admin account from the command line:

```bash
npm run create-admin you@example.com super_admin "Your Name"
```

Arguments:
- `email` (required) — the email address used to log in
- `role` (optional) — `super_admin` (default) or `editor`
- `name` (optional) — display name, defaults to the email

Additional admins can be created from the command line or from the admin panel (super admins only).

## Logging In

1. Navigate to `/admin/login` in your browser (or click the **Admin** link in the site footer).
2. Enter your admin email address and click **Send Login Code**.
3. Check your email for a 6-digit code. The code expires after 10 minutes.
4. Enter the code on the verification page and click **Verify**.
5. On success you are redirected to the dashboard (or to the page you originally requested).

If you need a new code, click **Resend code** on the verification page. You have up to 5 attempts per code before you must request a new one.

Your session lasts 7 days. After that you will be prompted to log in again.

## The Dashboard

After logging in you land on the admin dashboard. It provides a quick snapshot of the site:

- **Total Members** — count of all members in the system
- **Active Members** — members with an active status
- **Total Revenue** — sum of all completed payments
- **Emails Sent** — total outbound emails logged

Below the stats you will see two recent-activity panels:

- **Recent Members** — the last 5 members added, with their join dates
- **Recent Payments** — the last 5 payments, with member names and amounts

## Navigation

The admin sidebar links to every section. Settings and Admins are only visible to super admins.

| Section       | Path                   | Purpose                            | Role Required |
|---------------|------------------------|------------------------------------|---------------|
| Dashboard     | `/admin/dashboard`     | Overview stats and recent activity | Any           |
| Members       | `/admin/members`       | Member list and CRUD               | Any           |
| Announcements | `/admin/announcements` | Homepage announcement cards        | Any           |
| Gallery       | `/admin/gallery`       | Event photo management             | Any           |
| Board Bios    | `/admin/bios`          | Board member profiles              | Any           |
| Payments      | `/admin/payments`      | Payment ledger                     | Any           |
| Emails        | `/admin/emails`        | Compose blasts and view log        | Any           |
| Settings      | `/admin/settings`      | Site-wide configuration            | Super Admin   |
| Admins        | `/admin/admins`        | Manage admin accounts              | Super Admin   |

## Managing Admin Accounts

Super admins can add and remove admin accounts from the **Admins** page:

1. Navigate to **Admins** in the sidebar.
2. To add an admin, fill in their name, email, and role, then click **Add Admin**.
3. To remove an admin, click **Remove** next to their name. You cannot remove your own account.

## Logging Out

Click **Logout** in the sidebar to end your session immediately.
