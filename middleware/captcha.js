const https = require('https');

/**
 * Verify an hCaptcha token with the hCaptcha API.
 * Returns true if verification succeeds or if HCAPTCHA_SECRET_KEY is not set
 * (allows dev/test environments without keys to pass through).
 */
async function verifyCaptchaToken(token) {
  const secretKey = process.env.HCAPTCHA_SECRET_KEY;
  if (!secretKey) return true;
  if (!token) return false;

  return new Promise((resolve) => {
    const params = new URLSearchParams({
      secret: secretKey,
      response: token,
    }).toString();

    const options = {
      hostname: 'hcaptcha.com',
      path: '/siteverify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.success === true);
        } catch {
          resolve(false);
        }
      });
    });

    req.on('error', () => resolve(false));
    req.write(params);
    req.end();
  });
}

/**
 * Express middleware that verifies the hCaptcha response token from req.body.
 * On failure, sets a flash error and redirects to redirectPath (or the referrer).
 */
function requireCaptcha(redirectPath) {
  return async (req, res, next) => {
    if (['development', 'test', 'dev'].includes(process.env.NODE_ENV)) return next();
    const token = req.body['h-captcha-response'];
    const valid = await verifyCaptchaToken(token);
    if (!valid) {
      req.session.flash_error = 'Please complete the CAPTCHA verification.';
      return res.redirect(redirectPath || req.get('Referer') || '/');
    }
    next();
  };
}

module.exports = { requireCaptcha, verifyCaptchaToken };
