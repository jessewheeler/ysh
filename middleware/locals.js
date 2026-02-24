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
    if (req.session) {
      delete req.session.flash_success;
      delete req.session.flash_error;
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
        return date.split('T')[0];
      }
      return '';
    };

    next();
  } catch (err) {
    console.error('Error in injectLocals:', err);
    next(err);
  }
}

module.exports = { injectLocals };
