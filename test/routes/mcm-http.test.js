/**
 * HTTP contract for the Man Crush Monday wall.
 *
 * The two things worth guarding: the frame feed must return a bare fragment (the client
 * appends it straight into the grid, so a full layout would nest a whole page inside the
 * wall), and the page must carry no inline script — CSP would silently kill the infinite
 * scroll, which is the failure mode CLAUDE.md warns about.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));

const request = require('supertest');
const app = require('../../server');
const mcm = require('../../services/mcm');

// Anchored on the element so it can't also count the inner .mcm-frame-mat.
const countFrames = html => (html.match(/<article class="mcm-frame/g) || []).length;

describe('GET /man-crush-monday', () => {
    it('renders the wall with the first page of frames', async () => {
        const res = await request(app).get('/man-crush-monday');
        expect(res.status).toBe(200);
        expect(res.text).toContain('Man Crush Monday');
        expect(res.text).toContain('Julian Love');
        expect(countFrames(res.text)).toBe(mcm.PER_PAGE);
    });

    it('credits Kate as the one running the program', async () => {
        const res = await request(app).get('/man-crush-monday');
        expect(res.text).toContain('run by Kate');
        expect(res.text).toContain('Kate does not take nominations');
    });

    it('tells the client where the wall ends', async () => {
        const {totalPages} = mcm.getPage({});
        const res = await request(app).get('/man-crush-monday');
        expect(res.text).toContain(`data-next-page="2"`);
        expect(res.text).toContain(`data-total-pages="${totalPages}"`);
    });

    it('loads its behavior from an external script, never an inline handler', async () => {
        const res = await request(app).get('/man-crush-monday');
        expect(res.text).toContain('/js/mcm.js');
        expect(res.text).not.toMatch(/\bon(click|change|scroll)=/);
        expect(res.text).not.toMatch(/<script(?![^>]*\bsrc=)/);
    });

    it('is reachable from the About YSH nav on other pages', async () => {
        const res = await request(app).get('/bios');
        expect(res.text).toContain('href="/man-crush-monday"');
    });
});

describe('GET /man-crush-monday/frames', () => {
    it('returns a bare fragment, not a full page', async () => {
        const res = await request(app).get('/man-crush-monday/frames?page=2');
        expect(res.status).toBe(200);
        expect(countFrames(res.text)).toBe(mcm.PER_PAGE);
        expect(res.text).not.toContain('<nav');
        expect(res.text).not.toContain('<footer');
        expect(res.text).not.toContain('<!DOCTYPE');
    });

    it('advertises whether more frames are coming', async () => {
        const res = await request(app).get('/man-crush-monday/frames?page=2');
        expect(res.headers['x-mcm-page']).toBe('2');
        expect(res.headers['x-mcm-has-more']).toBe('true');
    });

    it('ends on the signing-day frame and says so', async () => {
        const {totalPages} = mcm.getPage({});
        const res = await request(app).get(`/man-crush-monday/frames?page=${totalPages}`);
        expect(res.headers['x-mcm-has-more']).toBe('false');
        expect(res.text).toContain('March 17, 2023');
        expect(res.text).toContain('Signing Day');
    });

    it('clamps an out-of-range page rather than erroring', async () => {
        const res = await request(app).get('/man-crush-monday/frames?page=9999');
        expect(res.status).toBe(200);
        expect(res.headers['x-mcm-has-more']).toBe('false');
    });

    it('serves the second page starting where the first left off', async () => {
        const first = await request(app).get('/man-crush-monday');
        const second = await request(app).get('/man-crush-monday/frames?page=2');
        const dateOf = html => (html.match(/mcm-plaque-date">([^<]+)/) || [])[1];
        expect(dateOf(second.text)).toBeDefined();
        expect(dateOf(second.text)).not.toBe(dateOf(first.text));
    });
});
