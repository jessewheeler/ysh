const {runWithActor} = require('../db/audit-context');

/**
 * Sets the current actor (logged-in admin) in AsyncLocalStorage so repo
 * functions can stamp created_by / updated_by without explicit threading.
 */
function captureActor(req, res, next) {
    runWithActor(
        {id: req.session?.adminId || null, email: req.session?.adminEmail || null},
        next
    );
}

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

/**
 * Auction bidders sign in with an emailed code (routes/auctions.js). A fetch() bid gets a 401 it
 * can act on; a plain form post is sent to sign in and brought back afterwards.
 */
function requireBidder(req, res, next) {
  if (req.session && req.session.bidderId) return next();
  const back = req.get('Referer');
  let returnTo = req.originalUrl;
  if (req.method !== 'GET' && back) {
    try {
      returnTo = new URL(back).pathname;
    } catch (_e) {
      returnTo = '/auctions';
    }
  }
  if (!returnTo.startsWith('/auctions/')) returnTo = '/auctions';
  if ((req.get('Accept') || '').includes('application/json')) {
    return res.status(401).json({
      ok: false, code: 'login_required', message: 'Please sign in to bid.',
      loginUrl: `/auctions/login?returnTo=${encodeURIComponent(returnTo)}`,
    });
  }
  req.session.bidderReturnTo = returnTo;
  req.session.flash_error = 'Please sign in to bid.';
  res.redirect('/auctions/login');
}

module.exports = {requireAdmin, requireSuperAdmin, requireBidder, captureActor};
