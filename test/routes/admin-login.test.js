jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const bcrypt = require('bcrypt');
const { insertAdmin } = require('../helpers/fixtures');

// Collect route handlers registered by the admin router
const mockHandlers = {};
jest.mock('express', () => {
  const realExpress = jest.requireActual('express');
  const fakeRouter = {
    get(path, ...fns) { mockHandlers['GET ' + path] = fns[fns.length - 1]; },
    post(path, ...fns) { mockHandlers['POST ' + path] = fns[fns.length - 1]; },
    use() {},
  };
  return {
    ...realExpress,
    Router: () => fakeRouter,
  };
});

jest.mock('../../services/storage', () => ({
  isConfigured: () => false,
  uploadFile: jest.fn(),
}));

function mockReq(overrides = {}) {
  return {
    body: {},
    session: {},
    get: () => null,
    ...overrides,
  };
}

function mockRes() {
  const res = {
    _redirectUrl: null,
    redirect(url) { res._redirectUrl = url; },
    render: jest.fn(),
  };
  return res;
}

beforeEach(() => {
  db.__resetTestDb();
  Object.keys(mockHandlers).forEach(k => delete mockHandlers[k]);
  jest.isolateModules(() => {
    require('../../routes/admin');
  });
});

describe('POST /login (OTP generation)', () => {
  test('stores bcrypt-hashed OTP that matches 000000 in dev', async () => {
    const admin = insertAdmin(db);
    const req = mockReq({ body: { email: admin.email } });
    const res = mockRes();

    await mockHandlers['POST /login'](req, res);

    const row = db.prepare('SELECT otp_hash, otp_expires_at, otp_attempts FROM members WHERE id = ?').get(admin.id);
    expect(row.otp_hash).toBeTruthy();
    expect(row.otp_expires_at).toBeTruthy();
    expect(row.otp_attempts).toBe(0);

    const match = await bcrypt.compare('000000', row.otp_hash);
    expect(match).toBe(true);
  });

  test('sets session.otpEmail to lowercased trimmed email', async () => {
    insertAdmin(db, { email: 'admin@example.com' });
    const req = mockReq({ body: { email: '  Admin@Example.COM  ' } });
    const res = mockRes();

    await mockHandlers['POST /login'](req, res);

    expect(req.session.otpEmail).toBe('admin@example.com');
  });

  test('redirects to /admin/login/verify', async () => {
    insertAdmin(db);
    const req = mockReq({ body: { email: 'admin@example.com' } });
    const res = mockRes();

    await mockHandlers['POST /login'](req, res);

    expect(res._redirectUrl).toBe('/admin/login/verify');
  });
});

describe('POST /login/verify (OTP verification)', () => {
  let admin;

  beforeEach(async () => {
    admin = insertAdmin(db);
    const otpHash = await bcrypt.hash('000000', 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare(
      "UPDATE members SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(otpHash, expiresAt, admin.id);
  });

  test('correct OTP sets session.adminId and redirects to dashboard', async () => {
    const req = mockReq({
      body: { code: '000000' },
      session: { otpEmail: admin.email },
    });
    const res = mockRes();

    await mockHandlers['POST /login/verify'](req, res);

    expect(req.session.adminId).toBe(admin.id);
    expect(req.session.adminRole).toBe('super_admin');
    expect(req.session.adminEmail).toBe(admin.email);
    expect(res._redirectUrl).toBe('/admin/dashboard');
  });

  test('correct OTP clears otp_hash from database', async () => {
    const req = mockReq({
      body: { code: '000000' },
      session: { otpEmail: admin.email },
    });
    const res = mockRes();

    await mockHandlers['POST /login/verify'](req, res);

    const row = db.prepare('SELECT otp_hash, otp_expires_at FROM members WHERE id = ?').get(admin.id);
    expect(row.otp_hash).toBeNull();
    expect(row.otp_expires_at).toBeNull();
  });

  test('wrong OTP increments attempts and shows error', async () => {
    const req = mockReq({
      body: { code: '999999' },
      session: { otpEmail: admin.email },
    });
    const res = mockRes();

    await mockHandlers['POST /login/verify'](req, res);

    expect(req.session.adminId).toBeUndefined();
    expect(req.session.flash_error).toBe('Invalid code.');
    expect(res._redirectUrl).toBe('/admin/login/verify');

    const row = db.prepare('SELECT otp_attempts FROM members WHERE id = ?').get(admin.id);
    expect(row.otp_attempts).toBe(1);
  });

  test('expired OTP shows expiry error', async () => {
    const expired = new Date(Date.now() - 60 * 1000).toISOString();
    db.prepare("UPDATE members SET otp_expires_at = ? WHERE id = ?").run(expired, admin.id);

    const req = mockReq({
      body: { code: '000000' },
      session: { otpEmail: admin.email },
    });
    const res = mockRes();

    await mockHandlers['POST /login/verify'](req, res);

    expect(req.session.adminId).toBeUndefined();
    expect(req.session.flash_error).toBe('Code has expired. Please request a new code.');
  });

  test('missing session email redirects to login', async () => {
    const req = mockReq({
      body: { code: '000000' },
      session: {},
    });
    const res = mockRes();

    await mockHandlers['POST /login/verify'](req, res);

    expect(res._redirectUrl).toBe('/admin/login');
  });

  test('too many attempts shows lockout error', async () => {
    db.prepare("UPDATE members SET otp_attempts = 5 WHERE id = ?").run(admin.id);

    const req = mockReq({
      body: { code: '000000' },
      session: { otpEmail: admin.email },
    });
    const res = mockRes();

    await mockHandlers['POST /login/verify'](req, res);

    expect(req.session.adminId).toBeUndefined();
    expect(req.session.flash_error).toBe('Too many attempts. Please request a new code.');
  });

  test('respects returnTo session value', async () => {
    const req = mockReq({
      body: { code: '000000' },
      session: { otpEmail: admin.email, returnTo: '/admin/members' },
    });
    const res = mockRes();

    await mockHandlers['POST /login/verify'](req, res);

    expect(req.session.adminId).toBe(admin.id);
    expect(res._redirectUrl).toBe('/admin/members');
    expect(req.session.returnTo).toBeUndefined();
  });
});
