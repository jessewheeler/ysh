# views/ -- Pug Templates

[Pug](https://pugjs.org) templates rendered by Express. The public site and admin CMS each have their own layout.

## Public Templates

All public templates extend `layout.pug`.

| File                     | Route                 | Description                                                                                                                                                                                                       |
|--------------------------|-----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `layout.pug`             | --                    | Base template: navbar, flash messages, footer, mobile nav JS. Provides `block content`.                                                                                                                           |
| `index.pug`              | `/`                   | Homepage. Renders hero, announcements, about, gallery, membership CTA, charitable partners, and contact form. All content driven by DB data passed from the route handler (`announcements`, `gallery`, `site.*`). |
| `bios.pug`               | `/bios`               | Board member bios. Iterates over `bios` array from the DB.                                                                                                                                                        |
| `membership.pug`         | `/membership`         | Membership signup form. POSTs to `/membership` which starts the Stripe Checkout flow. Displays dues amount from `site.dues_amount_cents`.                                                                         |
| `membership-success.pug` | `/membership/success` | Thank-you page after payment.                                                                                                                                                                                     |
| `membership-cancel.pug`  | `/membership/cancel`  | Shown when Stripe Checkout is cancelled.                                                                                                                                                                          |
| `contact-success.pug`    | `/contact/success`    | Confirmation after contact form submission.                                                                                                                                                                       |
| `error.pug`              | 404, 500              | Generic error page. Receives `status` and `message`.                                                                                                                                                              |

## Admin Templates

All admin templates (except `login.pug`) extend `admin/layout.pug`.

### admin/layout.pug

Admin shell with:
- **Sidebar** -- nav links to all admin sections, highlighted by `currentPath`. Links to view site and logout.
- **Topbar** -- page title from `block page_title`, mobile sidebar toggle button.
- **Flash messages** -- shown above content.
- **Scripts** -- loads `/js/admin.js`, auto-injects CSRF tokens into all `POST` forms via client-side JS, sidebar toggle handler.

### admin/login.pug

Standalone page (does not extend admin layout). Centered login card with the YSH logo and a password field. Includes a CSRF hidden field directly in the form.

### admin/dashboard.pug

Stats grid (total members, active members, total revenue, emails sent) plus tables of the 5 most recent members and payments.

### admin/members/

| File       | Description                                                                                                                              |
|------------|------------------------------------------------------------------------------------------------------------------------------------------|
| `list.pug` | Paginated, searchable member table. Shows member number, name, email, status badge, year.                                                |
| `form.pug` | Create/edit form. Used for both new members (`member = null`) and editing. Fields: name, email, phone, address, year, status, notes.     |
| `view.pug` | Detailed member view. Shows all fields, action buttons (edit, generate card, delete), and tables of related cards, payments, and emails. |

### admin/announcements/

| File       | Description                                                                                                                  |
|------------|------------------------------------------------------------------------------------------------------------------------------|
| `list.pug` | Table of announcements with title, published status, sort order, edit/delete actions.                                        |
| `form.pug` | Create/edit form with image upload, link URL/text, published checkbox, sort order. Shows current image preview when editing. |

### admin/gallery/

| File       | Description                                                                        |
|------------|------------------------------------------------------------------------------------|
| `list.pug` | Grid of gallery images with thumbnails, alt text, visibility, edit/delete actions. |
| `form.pug` | Create/edit form with image upload, alt text, caption, visibility, sort order.     |

### admin/bios/

| File       | Description                                                                                  |
|------------|----------------------------------------------------------------------------------------------|
| `list.pug` | Table of bios with photo thumbnail, name, role, visibility, sort order, edit/delete actions. |
| `form.pug` | Create/edit form with name, role, biography textarea, photo upload, visibility, sort order.  |

### admin/settings.pug

Single form to edit all `site_settings` rows: hero section (title, subtitle, button text/URL), about section (quote, text), gallery album URL, membership dues amount, contact email, Stripe publishable key.

### admin/payments.pug

Paginated table of all payments. Shows member name, member number, amount, status badge, date.

### admin/emails/

| File        | Description                                                                                                   |
|-------------|---------------------------------------------------------------------------------------------------------------|
| `log.pug`   | Paginated table of all sent emails. Shows recipient, subject, type, status, date.                             |
| `blast.pug` | Compose form with subject and HTML body fields. Shows the count of active members who will receive the blast. |

## Template Locals

These variables are available in every template via the `injectLocals` middleware:

| Variable        | Type                | Description                                  |
|-----------------|---------------------|----------------------------------------------|
| `site`          | Object              | All `site_settings` rows as key-value pairs  |
| `isAdmin`       | Boolean             | Whether the current session is authenticated |
| `currentPath`   | String              | `req.path`, used for sidebar highlighting    |
| `csrfToken`     | String              | CSRF token for forms                         |
| `flash_success` | String or undefined | One-time success message                     |
| `flash_error`   | String or undefined | One-time error message                       |
