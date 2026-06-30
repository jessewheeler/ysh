jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { insertMember, insertPeriod, enrollMember, insertSetting } = require('../helpers/fixtures');

const mockHandlers = {};
jest.mock('express', () => {
  const realExpress = jest.requireActual('express');
  const fakeRouter = {
    get(path, ...fns) { mockHandlers['GET ' + path] = fns[fns.length - 1]; },
    post(path, ...fns) { mockHandlers['POST ' + path] = fns[fns.length - 1]; },
    use() {},
  };
  return { ...realExpress, Router: () => fakeRouter };
});

jest.mock('../../middleware/captcha', () => ({
  requireCaptcha: () => (_req, _res, next) => next(),
}));

jest.mock('../../services/stripe', () => ({
  createCheckoutSession: jest.fn().mockResolvedValue({ url: 'https://stripe.test/checkout' }),
}));

jest.mock('../../services/renewal', () => ({
  generateRenewalToken: jest.fn().mockResolvedValue('mock-renewal-token'),
}));

jest.mock('../../services/email', () => ({
  sendRenewalReminderEmail: jest.fn().mockResolvedValue(undefined),
}));

function mockReq(overrides = {}) {
  return { body: {}, params: {}, session: {}, get: () => 'localhost', ...overrides };
}

function mockRes() {
  const res = {
    _redirectUrl: null,
    redirect(statusOrUrl, url) {
      res._redirectUrl = url !== undefined ? url : statusOrUrl;
    },
    render: jest.fn(),
  };
  return res;
}

beforeEach(() => {
  db.__resetTestDb();
  Object.keys(mockHandlers).forEach(k => delete mockHandlers[k]);
  jest.clearAllMocks();
  jest.isolateModules(() => { require('../../routes/index'); });
});

const validBody = {
  membership_type: 'individual',
  first_name: 'New',
  last_name: 'Member',
  email: 'new@example.com',
  phone: '',
  address_street: '',
  address_city: '',
  address_state: 'MT',
  address_zip: '',
};

describe('POST /membership — new member (happy path)', () => {
  test('redirects to Stripe when email does not exist', async () => {
    insertPeriod(db, {start_date: '2025-01-01', end_date: '2099-12-31'});
    insertSetting(db, 'max_family_members', '6');

    const req = mockReq({ body: validBody, session: {} });
    const res = mockRes();
    await mockHandlers['POST /membership'](req, res);

    expect(res._redirectUrl).toBe('https://stripe.test/checkout');
  });
});

describe('POST /membership — existing primary member, not enrolled', () => {
  test('generates renewal token and redirects to /membership with success flash', async () => {
    insertPeriod(db, {start_date: '2025-01-01', end_date: '2099-12-31'});
    const member = insertMember(db, { email: 'existing@example.com', status: 'active' });
    // member exists but is NOT enrolled in the current period

    const renewalService = require('../../services/renewal');
    const emailService = require('../../services/email');

    const req = mockReq({ body: { ...validBody, email: 'existing@example.com' }, session: {} });
    const res = mockRes();
    await mockHandlers['POST /membership'](req, res);

    expect(renewalService.generateRenewalToken).toHaveBeenCalledWith(member.id);
    expect(emailService.sendRenewalReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'existing@example.com' }),
      expect.stringContaining('mock-renewal-token')
    );
    expect(req.session.flash_success).toMatch(/renewal link has been sent/i);
    expect(res._redirectUrl).toBe('/membership');
  });

  test('works for expired members too', async () => {
    insertPeriod(db, {start_date: '2025-01-01', end_date: '2099-12-31'});
    insertMember(db, { email: 'expired@example.com', status: 'expired' });

    const renewalService = require('../../services/renewal');

    const req = mockReq({ body: { ...validBody, email: 'expired@example.com' }, session: {} });
    const res = mockRes();
    await mockHandlers['POST /membership'](req, res);

    expect(renewalService.generateRenewalToken).toHaveBeenCalled();
    expect(res._redirectUrl).toBe('/membership');
  });
});

describe('POST /membership — existing primary member, already enrolled', () => {
  test('flashes already-a-member message without sending email', async () => {
    const period = insertPeriod(db, {start_date: '2025-01-01', end_date: '2099-12-31'});
    const member = insertMember(db, { email: 'enrolled@example.com', status: 'active' });
    enrollMember(db, member.id, period.id);

    const renewalService = require('../../services/renewal');
    const emailService = require('../../services/email');

    const req = mockReq({ body: { ...validBody, email: 'enrolled@example.com' }, session: {} });
    const res = mockRes();
    await mockHandlers['POST /membership'](req, res);

    expect(renewalService.generateRenewalToken).not.toHaveBeenCalled();
    expect(emailService.sendRenewalReminderEmail).not.toHaveBeenCalled();
    expect(req.session.flash_success).toMatch(/already a member/i);
    expect(res._redirectUrl).toBe('/membership');
  });
});

describe('POST /membership — cancelled member', () => {
  test('flashes cancellation error and does not send renewal email', async () => {
    insertPeriod(db, {start_date: '2025-01-01', end_date: '2099-12-31'});
    insertMember(db, { email: 'cancelled@example.com', status: 'cancelled' });

    const renewalService = require('../../services/renewal');
    const emailService = require('../../services/email');

    const req = mockReq({ body: { ...validBody, email: 'cancelled@example.com' }, session: {} });
    const res = mockRes();
    await mockHandlers['POST /membership'](req, res);

    expect(renewalService.generateRenewalToken).not.toHaveBeenCalled();
    expect(emailService.sendRenewalReminderEmail).not.toHaveBeenCalled();
    expect(req.session.flash_error).toMatch(/cancelled/i);
    expect(res._redirectUrl).toBe('/membership');
  });
});

describe('POST /membership — family sub-member email', () => {
  test('flashes contact-us error for family sub-member email', async () => {
    insertPeriod(db, {start_date: '2025-01-01', end_date: '2099-12-31'});
    const primary = insertMember(db, { email: 'primary@example.com', membership_type: 'family' });
    insertMember(db, {
      email: 'subfamily@example.com',
      membership_type: 'family',
      primary_member_id: primary.id,
    });

    const renewalService = require('../../services/renewal');

    const req = mockReq({ body: { ...validBody, email: 'subfamily@example.com' }, session: {} });
    const res = mockRes();
    await mockHandlers['POST /membership'](req, res);

    expect(renewalService.generateRenewalToken).not.toHaveBeenCalled();
    expect(req.session.flash_error).toMatch(/family membership/i);
    expect(res._redirectUrl).toBe('/membership');
  });
});
