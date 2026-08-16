/**
 * Guards the Battle of the Birds video embed. The iframe and the CSP that permits it live in
 * two different files (views/charitable/battle-of-the-birds.pug and server.js), so either half
 * can be changed without the other and the page still returns 200 — the embed just renders as
 * an empty box with a console-only refusal. These assertions pin both halves together.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));

const request = require('supertest');
const app = require('../../server');

const PATH = '/charitable/battle-of-the-birds';

function directive(res, name) {
  const csp = res.headers['content-security-policy'] || '';
  const match = csp.split(';').find(d => d.trim().startsWith(`${name} `));
  return match ? match.trim() : '';
}

describe('Battle of the Birds video embed', () => {
  it('embeds the KTVQ segment from the privacy-enhanced player domain', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(200);
    expect(res.text).toContain('https://www.youtube-nocookie.com/embed/0S-kCaPTRlo');
  });

  it('allows the player origin in frame-src', async () => {
    // Without this entry the iframe is refused and the section renders empty.
    const res = await request(app).get(PATH);
    expect(directive(res, 'frame-src')).toContain('https://www.youtube-nocookie.com');
  });

  it('keeps the existing frame-src entries', async () => {
    // Stripe checkout and hCaptcha frame in on other pages; adding YouTube must not drop them.
    const res = await request(app).get(PATH);
    const frameSrc = directive(res, 'frame-src');
    expect(frameSrc).toContain('https://js.stripe.com');
    expect(frameSrc).toContain('https://newassets.hcaptcha.com');
  });

  it('links out to the source video', async () => {
    const res = await request(app).get(PATH);
    expect(res.text).toContain('https://youtu.be/0S-kCaPTRlo');
  });
});
