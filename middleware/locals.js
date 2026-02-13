const db = require('../db/database');

function injectLocals(req, res, next) {
  // Site settings
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.locals.site = settings;
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

  next();
}

module.exports = { injectLocals };
