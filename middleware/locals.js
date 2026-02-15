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

    next();
  } catch (err) {
    console.error('Error in injectLocals:', err);
    next(err);
  }
}

module.exports = { injectLocals };
