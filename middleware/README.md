# middleware/ -- Express Middleware

Custom middleware mounted globally in `server.js`.

## Files

### auth.js

Exports `requireAdmin(req, res, next)`.

Checks `req.session.isAdmin`. If the session is not authenticated, saves the requested URL to `req.session.returnTo` and redirects to `/admin/login`. After a successful login the user is sent back to the originally requested page.

Used as a guard on all admin routes except the login page itself. Applied in `routes/admin.js` via `router.use(requireAdmin)` after the login/logout routes.

### locals.js

Exports `injectLocals(req, res, next)`.

Runs on every request (mounted globally in `server.js`). Provides the following to all Pug templates via `res.locals`:

| Local           | Source                | Description                                                                         |
|-----------------|-----------------------|-------------------------------------------------------------------------------------|
| `site`          | `site_settings` table | Object of all key-value settings (e.g. `site.hero_title`, `site.dues_amount_cents`) |
| `isAdmin`       | Session               | Boolean, true if the user is logged into admin                                      |
| `currentPath`   | `req.path`            | Used by the admin sidebar to highlight the active nav link                          |
| `flash_success` | Session               | Success message, cleared after read                                                 |
| `flash_error`   | Session               | Error message, cleared after read                                                   |

Flash messages are stored directly on the session and deleted after being read (single-show pattern).
