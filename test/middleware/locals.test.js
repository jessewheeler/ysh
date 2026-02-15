jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { injectLocals } = require('../../middleware/locals');
const { insertSetting } = require('../helpers/fixtures');

function buildReq(sessionOverrides = {}) {
  return {
    session: { ...sessionOverrides },
    path: '/about',
  };
}

function buildRes() {
  return { locals: {} };
}

beforeEach(() => {
  db.__resetTestDb();
});

describe('injectLocals middleware', () => {
  test('populates res.locals.site from site_settings table', async () => {
    const testDb = db.__getCurrentDb();
    insertSetting(testDb, 'hero_title', 'Test Title');
    insertSetting(testDb, 'contact_email', 'test@example.com');

    const res = buildRes();
    const next = jest.fn();
    await injectLocals(buildReq(), res, next);

    expect(res.locals.site.hero_title).toBe('Test Title');
    expect(res.locals.site.contact_email).toBe('test@example.com');
  });

  test('res.locals.site is empty object when table is empty', async () => {
    const res = buildRes();
    const next = jest.fn();
    await injectLocals(buildReq(), res, next);

    expect(res.locals.site).toEqual({});
  });

  test('sets isAdmin true when session.adminId is set', async () => {
    const res = buildRes();
    await injectLocals(buildReq({ adminId: 1 }), res, jest.fn());
    expect(res.locals.isAdmin).toBe(true);
  });

  test('sets isAdmin false when session.adminId is missing', async () => {
    const res = buildRes();
    await injectLocals(buildReq(), res, jest.fn());
    expect(res.locals.isAdmin).toBe(false);
  });

  test('sets adminRole from session', async () => {
    const res = buildRes();
    await injectLocals(buildReq({ adminId: 1, adminRole: 'super_admin' }), res, jest.fn());
    expect(res.locals.adminRole).toBe('super_admin');
  });

  test('sets adminRole to null when not logged in', async () => {
    const res = buildRes();
    await injectLocals(buildReq(), res, jest.fn());
    expect(res.locals.adminRole).toBeNull();
  });

  test('sets adminEmail from session', async () => {
    const res = buildRes();
    await injectLocals(buildReq({ adminId: 1, adminEmail: 'admin@test.com' }), res, jest.fn());
    expect(res.locals.adminEmail).toBe('admin@test.com');
  });

  test('sets adminEmail to null when not logged in', async () => {
    const res = buildRes();
    await injectLocals(buildReq(), res, jest.fn());
    expect(res.locals.adminEmail).toBeNull();
  });

  test('sets currentPath from req.path', async () => {
    const req = buildReq();
    req.path = '/membership';
    const res = buildRes();
    await injectLocals(req, res, jest.fn());
    expect(res.locals.currentPath).toBe('/membership');
  });

  test('copies flash_success to locals and deletes from session', async () => {
    const req = buildReq({ flash_success: 'Saved!' });
    const res = buildRes();
    await injectLocals(req, res, jest.fn());
    expect(res.locals.flash_success).toBe('Saved!');
    expect(req.session.flash_success).toBeUndefined();
  });

  test('copies flash_error to locals and deletes from session', async () => {
    const req = buildReq({ flash_error: 'Something broke' });
    const res = buildRes();
    await injectLocals(req, res, jest.fn());
    expect(res.locals.flash_error).toBe('Something broke');
    expect(req.session.flash_error).toBeUndefined();
  });

  test('handles missing flash messages gracefully', async () => {
    const res = buildRes();
    await injectLocals(buildReq(), res, jest.fn());
    expect(res.locals.flash_success).toBeUndefined();
    expect(res.locals.flash_error).toBeUndefined();
  });

  test('always calls next()', async () => {
    const next = jest.fn();
    await injectLocals(buildReq(), buildRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
