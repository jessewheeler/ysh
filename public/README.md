# public/ -- Static Assets

Served by Express at the root URL (`/`). Everything in this directory is publicly accessible.

## Structure

```
public/
  css/
    style.css       # Main site styles (public pages)
    admin.css       # Admin CMS styles (sidebar, tables, forms, stats, badges)
  js/
    admin.js        # Admin client-side JS (confirm dialogs, image preview, CSRF injection)
  img/
    logo.png        # Sea Hawkers logo (used in navbar, cards, emails)
    ysh_gallery.jpg # Gallery photo 1
    ysh_gallery2.jpg
    ysh_gallery3.jpg
    ysh_gallery4.jpg
    bios/           # Board member headshots
      john_fanzone.jpg
      peter_davies.jpg
      kate_mclean.jpg
      tricia_old_elk.jpg
      d-becker.jpg
      jesse-wheeler.png
      Brenda-hanson.jpg
  assets/
    logo.png        # Alternate logo used in announcement cards
    fundr.jpg       # Fundraiser announcement image
    conduct.pdf     # Code of Conduct document
    unity.pdf       # Code of Unity document
    bylaws.pdf      # Chapter Bylaws document
```

## CSS

### style.css

Public site stylesheet. Design system:
- Primary navy: `#002a5c`
- Accent green: `#69be28`
- Light background: `#f8f8f8`

Key component classes:
- `.navbar`, `.nav-menu`, `.dropdown-menu` -- Sticky top nav with dropdowns
- `.hero` -- Full-width navy hero banner
- `.section`, `.alt-bg`, `.container` -- Page sections
- `.cards`, `.card`, `.card-body` -- Grid card layout
- `.btn`, `.btn-outline` -- Button styles
- `.bios-grid`, `.bio-card`, `.bio-photo` -- Board bio layout
- `.gallery-grid` -- Image gallery grid
- `.contact-form`, `.form-group` -- Form styling
- `.flash`, `.flash-success`, `.flash-error` -- Flash messages

Responsive breakpoint at 768px: hamburger nav, single-column layouts.

### admin.css

Admin-only stylesheet. Loaded only in admin templates.

Key component classes:
- `.admin-wrapper`, `.admin-sidebar`, `.admin-main` -- Sidebar layout
- `.sidebar-nav`, `.sidebar-brand` -- Sidebar navigation
- `.admin-topbar`, `.admin-content` -- Main content area
- `.stats-grid`, `.stat-card` -- Dashboard stats
- `.admin-table`, `.detail-table` -- Data tables
- `.badge`, `.badge-active`, `.badge-pending` -- Status badges
- `.admin-toolbar`, `.search-form` -- Toolbar with search
- `.form-grid`, `.form-actions` -- Two-column form layout
- `.btn-sm`, `.btn-danger` -- Small and danger buttons
- `.pagination` -- Page navigation
- `.gallery-admin-grid` -- Admin gallery thumbnails
- `.admin-login-body`, `.admin-login-card` -- Login page

Responsive at 768px: sidebar becomes a slide-out overlay toggled by hamburger button.

## JS

### admin.js

Client-side scripts for the admin CMS:

1. **Confirm dialogs** -- Forms with a `data-confirm` attribute show a browser `confirm()` before submission. Used on delete actions.
2. **Image preview** -- When a user selects a file in an `<input type="file" accept="image/*">`, a preview thumbnail is rendered inline.
3. **CSRF token injection** -- On page load, every `POST` form that lacks an `_csrf` hidden input gets one injected automatically with the token from the server.
