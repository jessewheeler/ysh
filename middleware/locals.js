const settingsRepo = require('../db/repos/settings');

async function injectLocals(req, res, next) {
  try {
    // Site settings
    res.locals.site = await settingsRepo.getAll();
    res.locals.isAdmin = !!(req.session && req.session.adminId);
    res.locals.adminRole = (req.session && req.session.adminRole) || null;
    res.locals.adminEmail = (req.session && req.session.adminEmail) || null;
    res.locals.currentPath = req.path;

    // Flash messages
    res.locals.flash_success = req.session && req.session.flash_success;
    res.locals.flash_error = req.session && req.session.flash_error;
    // A generated renewal link, carried as {url, expiresAt} so the member page can render it
    // in a copyable field. One-shot like the other flashes — it is a freshly minted credential,
    // so it should not linger on the page after the admin navigates away.
    res.locals.flash_renewal_link = (req.session && req.session.flash_renewal_link) || null;
    // Names the disclosure that raised a validation error, so the member record can
    // re-open it rather than showing a red banner above a collapsed control.
    res.locals.flash_reopen = (req.session && req.session.flash_reopen) || null;
    if (req.session) {
      delete req.session.flash_success;
      delete req.session.flash_error;
      delete req.session.flash_renewal_link;
      delete req.session.flash_reopen;
    }

    // hCaptcha site key (empty string when not configured — widget is hidden)
    res.locals.hcaptchaSiteKey = process.env.HCAPTCHA_SITE_KEY || '';

    // Google Analytics measurement ID (empty string when not configured)
    res.locals.gaMeasurementId = process.env.GA_MEASUREMENT_ID || '';

    // Date formatting helper (handles both SQLite strings and PostgreSQL Date objects)
    res.locals.formatDate = function(date) {
      if (!date) return '';
      if (date instanceof Date) {
        return date.toISOString().split('T')[0];
      }
      if (typeof date === 'string') {
          return date.split('T')[0].split(' ')[0];
      }
      return '';
    };

    // Money formatting. Amounts are integer cents in the DB.
    //
    // sumCompletedCents() returns null on an empty payments table, so coerce before
    // dividing — `(null / 100).toFixed(2)` only yields "0.00" by coercion luck.
    res.locals.formatMoney = function(cents) {
      return ((Number(cents) || 0) / 100)
        .toLocaleString('en-US', {style: 'currency', currency: 'USD'});
    };

    // Short form for KPI tiles, which have a card's width to work with rather than a
    // table cell's: thousands separators, and no ".00" on whole amounts. "$2,034" is
    // three glyphs narrower than "$2034.00" and reads faster at 36px.
    res.locals.formatMoneyShort = function(cents) {
      const value = (Number(cents) || 0) / 100;
      return value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      });
    };

    next();
  } catch (err) {
    console.error('Error in injectLocals:', err);
    next(err);
  }
}

module.exports = { injectLocals };
