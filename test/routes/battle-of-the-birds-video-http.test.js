/**
 * Guards how the Battle of the Birds page presents the KTVQ segment. It used to be an iframe
 * from youtube-nocookie, but the video owner disabled off-site playback, so that embed rendered
 * a black "Video unavailable" box in the middle of the page. The page now links out to the
 * source behind a locally-hosted thumbnail. These assertions pin that decision down in both
 * halves — the markup (views/charitable/battle-of-the-birds.pug) and the CSP (server.js) — so
 * the embed can't quietly come back.
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

describe('Battle of the Birds news segment', () => {
  it('links out to the source video instead of embedding it', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(200);
    expect(res.text).toContain('https://youtu.be/0S-kCaPTRlo');
    expect(res.text).not.toContain('youtube-nocookie.com/embed');
    expect(res.text).not.toContain('<iframe');
  });

  it('serves the thumbnail from this origin', async () => {
    // A hotlinked thumbnail would leave the page depending on a third party again.
    const res = await request(app).get(PATH);
    expect(res.text).toContain('/img/ktvq-battle-of-the-birds.jpg');
    expect(res.text).not.toContain('i.ytimg.com');

    const img = await request(app).get('/img/ktvq-battle-of-the-birds.jpg');
    expect(img.status).toBe(200);
  });

  it('tells the reader the link leaves the site', async () => {
    const res = await request(app).get(PATH);
    expect(res.text).toContain('Watch on YouTube');
    expect(res.text).toContain('KTVQ');
  });

  it('no longer allows the player origin in frame-src', async () => {
    // Nothing frames YouTube any more, so the allowance would be dead surface area.
    const res = await request(app).get(PATH);
    expect(directive(res, 'frame-src')).not.toContain('youtube-nocookie.com');
  });

  it('keeps the frame-src entries that are still in use', async () => {
    // Stripe checkout and hCaptcha frame in on other pages.
    const res = await request(app).get(PATH);
    const frameSrc = directive(res, 'frame-src');
    expect(frameSrc).toContain('https://js.stripe.com');
    expect(frameSrc).toContain('https://newassets.hcaptcha.com');
  });
});
