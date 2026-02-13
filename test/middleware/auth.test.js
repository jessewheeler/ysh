const { requireAdmin, requireSuperAdmin } = require('../../middleware/auth');

function buildReq(sessionOverrides = {}) {
  return {
    session: { ...sessionOverrides },
    originalUrl: '/admin/dashboard',
  };
}

function buildRes() {
  const res = { redirectedTo: null };
  res.redirect = jest.fn((url) => { res.redirectedTo = url; });
  return res;
}

describe('requireAdmin middleware', () => {
  test('calls next() when req.session.adminId is set', () => {
    const next = jest.fn();
    requireAdmin(buildReq({ adminId: 1 }), buildRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('does not redirect when session has adminId', () => {
    const res = buildRes();
    requireAdmin(buildReq({ adminId: 1 }), res, jest.fn());
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('redirects to /admin/login when adminId is missing', () => {
    const res = buildRes();
    requireAdmin(buildReq(), res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/admin/login');
  });

  test('stores req.originalUrl in req.session.returnTo before redirect', () => {
    const req = buildReq();
    req.originalUrl = '/admin/members';
    requireAdmin(req, buildRes(), jest.fn());
    expect(req.session.returnTo).toBe('/admin/members');
  });

  test('does not call next() when not admin', () => {
    const next = jest.fn();
    requireAdmin(buildReq(), buildRes(), next);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireSuperAdmin middleware', () => {
  test('calls next() when session has adminId and role is super_admin', () => {
    const next = jest.fn();
    requireSuperAdmin(buildReq({ adminId: 1, adminRole: 'super_admin' }), buildRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('redirects editor to dashboard with flash error', () => {
    const res = buildRes();
    const req = buildReq({ adminId: 2, adminRole: 'editor' });
    requireSuperAdmin(req, res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/admin/dashboard');
    expect(req.session.flash_error).toBe('You do not have permission to access that page.');
  });

  test('redirects unauthenticated user to login', () => {
    const res = buildRes();
    const req = buildReq();
    req.originalUrl = '/admin/settings';
    requireSuperAdmin(req, res, jest.fn());
    expect(res.redirect).toHaveBeenCalledWith('/admin/login');
    expect(req.session.returnTo).toBe('/admin/settings');
  });

  test('does not call next() for editor', () => {
    const next = jest.fn();
    requireSuperAdmin(buildReq({ adminId: 2, adminRole: 'editor' }), buildRes(), next);
    expect(next).not.toHaveBeenCalled();
  });
});
