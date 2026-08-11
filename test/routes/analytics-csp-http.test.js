/**
 * Guards the CSP/GA contract. The original bug was that layout.pug shipped a gtag tag and an
 * inline bootstrap while helmet's script-src allowed neither, so GA silently sent nothing for
 * months. These assertions fail if either half of that regresses: the CSP must name
 * googletagmanager, and the bootstrap must stay in a served file rather than going back inline.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));

const request = require('supertest');
const app = require('../../server');

function directive(res, name) {
  const csp = res.headers['content-security-policy'] || '';
  const match = csp.split(';').find(d => d.trim().startsWith(`${name} `));
  return match ? match.trim() : '';
}

describe('Content-Security-Policy — Google Analytics', () => {
  it('allows gtag.js to load from googletagmanager', async () => {
    const res = await request(app).get('/membership');
    expect(directive(res, 'script-src')).toContain('https://www.googletagmanager.com');
  });

  it('allows GA4 to send hits, not just load the library', async () => {
    // gtag.js loading is useless on its own — GA4 beacons to *.google-analytics.com.
    const res = await request(app).get('/membership');
    expect(directive(res, 'connect-src')).toContain('https://*.google-analytics.com');
  });

  it('does not fall back to unsafe-inline for scripts', async () => {
    // The point of moving the bootstrap into public/js/analytics.js was to avoid this.
    const res = await request(app).get('/membership');
    expect(directive(res, 'script-src')).not.toContain("'unsafe-inline'");
  });
});

describe('Analytics markup', () => {
  const original = process.env.GA_MEASUREMENT_ID;
  afterEach(() => {
    if (original === undefined) delete process.env.GA_MEASUREMENT_ID;
    else process.env.GA_MEASUREMENT_ID = original;
  });

  it('emits the measurement ID and the served bootstrap when configured', async () => {
    process.env.GA_MEASUREMENT_ID = 'G-TESTID1234';
    const res = await request(app).get('/membership');
    expect(res.text).toContain('data-ga-id="G-TESTID1234"');
    expect(res.text).toContain('/js/analytics.js');
  });

  it('emits nothing when GA is not configured', async () => {
    process.env.GA_MEASUREMENT_ID = '';
    const res = await request(app).get('/membership');
    expect(res.text).not.toContain('/js/analytics.js');
  });

  it('keeps the bootstrap out of the template', async () => {
    // An inline gtag() bootstrap is exactly what CSP silently refuses.
    process.env.GA_MEASUREMENT_ID = 'G-TESTID1234';
    const res = await request(app).get('/membership');
    expect(res.text).not.toContain('window.dataLayer');
  });
});
