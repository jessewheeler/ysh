const https = require('https');
const { verifyCaptchaToken, requireCaptcha } = require('../../middleware/captcha');

jest.mock('https');

function buildReq(bodyOverrides = {}, sessionOverrides = {}) {
  return {
    body: { ...bodyOverrides },
    session: { ...sessionOverrides },
    get: jest.fn((header) => (header === 'Referer' ? '/referer' : undefined)),
  };
}

function buildRes() {
  return {
    redirect: jest.fn(),
  };
}

describe('verifyCaptchaToken', () => {
  afterEach(() => {
    delete process.env.HCAPTCHA_SECRET_KEY;
    jest.resetAllMocks();
  });

  test('returns true when HCAPTCHA_SECRET_KEY is not set', async () => {
    const result = await verifyCaptchaToken('any-token');
    expect(result).toBe(true);
  });

  test('returns false when secret key is set but token is missing', async () => {
    process.env.HCAPTCHA_SECRET_KEY = 'test-secret';
    const result = await verifyCaptchaToken(undefined);
    expect(result).toBe(false);
  });

  test('returns false when secret key is set but token is empty string', async () => {
    process.env.HCAPTCHA_SECRET_KEY = 'test-secret';
    const result = await verifyCaptchaToken('');
    expect(result).toBe(false);
  });

  test('returns true when hCaptcha API responds with success: true', async () => {
    process.env.HCAPTCHA_SECRET_KEY = 'test-secret';

    const mockResponse = {
      on: jest.fn((event, cb) => {
        if (event === 'data') cb(JSON.stringify({ success: true }));
        if (event === 'end') cb();
        return mockResponse;
      }),
    };
    const mockRequest = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
    };
    https.request.mockImplementation((_opts, cb) => {
      cb(mockResponse);
      return mockRequest;
    });

    const result = await verifyCaptchaToken('valid-token');
    expect(result).toBe(true);
  });

  test('returns false when hCaptcha API responds with success: false', async () => {
    process.env.HCAPTCHA_SECRET_KEY = 'test-secret';

    const mockResponse = {
      on: jest.fn((event, cb) => {
        if (event === 'data') cb(JSON.stringify({ success: false }));
        if (event === 'end') cb();
        return mockResponse;
      }),
    };
    const mockRequest = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
    };
    https.request.mockImplementation((_opts, cb) => {
      cb(mockResponse);
      return mockRequest;
    });

    const result = await verifyCaptchaToken('bad-token');
    expect(result).toBe(false);
  });

  test('returns false when hCaptcha API returns invalid JSON', async () => {
    process.env.HCAPTCHA_SECRET_KEY = 'test-secret';

    const mockResponse = {
      on: jest.fn((event, cb) => {
        if (event === 'data') cb('not-json');
        if (event === 'end') cb();
        return mockResponse;
      }),
    };
    const mockRequest = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
    };
    https.request.mockImplementation((_opts, cb) => {
      cb(mockResponse);
      return mockRequest;
    });

    const result = await verifyCaptchaToken('some-token');
    expect(result).toBe(false);
  });

  test('returns false when https.request emits an error', async () => {
    process.env.HCAPTCHA_SECRET_KEY = 'test-secret';

    const mockRequest = {
      on: jest.fn((event, cb) => {
        if (event === 'error') cb(new Error('Network error'));
        return mockRequest;
      }),
      write: jest.fn(),
      end: jest.fn(),
    };
    https.request.mockImplementation(() => mockRequest);

    const result = await verifyCaptchaToken('some-token');
    expect(result).toBe(false);
  });
});

describe('requireCaptcha middleware', () => {
  afterEach(() => {
    delete process.env.HCAPTCHA_SECRET_KEY;
    jest.resetAllMocks();
  });

  test('calls next() when HCAPTCHA_SECRET_KEY is not set (dev passthrough)', async () => {
    const middleware = requireCaptcha('/fallback');
    const req = buildReq({ 'h-captcha-response': '' });
    const res = buildRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('redirects to provided path on failed CAPTCHA', async () => {
    process.env.HCAPTCHA_SECRET_KEY = 'test-secret';

    const mockRequest = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
    };
    const mockResponse = {
      on: jest.fn((event, cb) => {
        if (event === 'data') cb(JSON.stringify({ success: false }));
        if (event === 'end') cb();
        return mockResponse;
      }),
    };
    https.request.mockImplementation((_opts, cb) => {
      cb(mockResponse);
      return mockRequest;
    });

    const middleware = requireCaptcha('/membership');
    const req = buildReq({ 'h-captcha-response': 'bad-token' });
    const res = buildRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/membership');
    expect(req.session.flash_error).toBe('Please complete the CAPTCHA verification.');
    expect(next).not.toHaveBeenCalled();
  });

  test('falls back to Referer header when no redirectPath provided', async () => {
    process.env.HCAPTCHA_SECRET_KEY = 'test-secret';

    const mockRequest = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
    };
    const mockResponse = {
      on: jest.fn((event, cb) => {
        if (event === 'data') cb(JSON.stringify({ success: false }));
        if (event === 'end') cb();
        return mockResponse;
      }),
    };
    https.request.mockImplementation((_opts, cb) => {
      cb(mockResponse);
      return mockRequest;
    });

    const middleware = requireCaptcha();
    const req = buildReq({ 'h-captcha-response': 'bad-token' });
    const res = buildRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/referer');
    expect(next).not.toHaveBeenCalled();
  });

  test('falls back to / when no redirectPath and no Referer', async () => {
    process.env.HCAPTCHA_SECRET_KEY = 'test-secret';

    const mockRequest = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
    };
    const mockResponse = {
      on: jest.fn((event, cb) => {
        if (event === 'data') cb(JSON.stringify({ success: false }));
        if (event === 'end') cb();
        return mockResponse;
      }),
    };
    https.request.mockImplementation((_opts, cb) => {
      cb(mockResponse);
      return mockRequest;
    });

    const middleware = requireCaptcha();
    const req = buildReq({ 'h-captcha-response': 'bad-token' });
    req.get = jest.fn(() => undefined);
    const res = buildRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/');
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() when CAPTCHA verification succeeds', async () => {
    process.env.HCAPTCHA_SECRET_KEY = 'test-secret';

    const mockRequest = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
    };
    const mockResponse = {
      on: jest.fn((event, cb) => {
        if (event === 'data') cb(JSON.stringify({ success: true }));
        if (event === 'end') cb();
        return mockResponse;
      }),
    };
    https.request.mockImplementation((_opts, cb) => {
      cb(mockResponse);
      return mockRequest;
    });

    const middleware = requireCaptcha('/membership');
    const req = buildReq({ 'h-captcha-response': 'valid-token' });
    const res = buildRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
