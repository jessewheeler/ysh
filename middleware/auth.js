function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin/login');
}

function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.adminId && req.session.adminRole === 'super_admin') {
    return next();
  }
  if (req.session && req.session.adminId) {
    req.session.flash_error = 'You do not have permission to access that page.';
    return res.redirect('/admin/dashboard');
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin/login');
}

module.exports = { requireAdmin, requireSuperAdmin };
