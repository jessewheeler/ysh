/**
 * Man Crush Monday — the wall.
 *
 * Julian Love signed with Seattle on Friday, March 17 2023. Kate has named him Man Crush
 * Monday every week since, and this module generates one frame per Monday from then to
 * now, newest first, with a final Signing Day plaque at the very bottom.
 *
 * No database: the wall is derived from the calendar, so it grows by one frame every
 * Monday on its own. Photos are whatever files happen to live in public/img/mcm/, cycled
 * across the frames, so the page works with one photo or fifty.
 *
 * All date math is explicit UTC. A local-time weekly walk drifts an hour across a DST
 * boundary, which is enough to skip or duplicate a Monday over a three-year span.
 */

const fs = require('fs');
const path = require('path');

const SIGNING_DAY = Date.UTC(2023, 2, 17); // Friday — the free-agency deal
const FIRST_MONDAY = Date.UTC(2023, 2, 20); // the Monday that followed it
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const PER_PAGE = 24;

const PHOTO_DIR = path.join(__dirname, '..', 'public', 'img', 'mcm');
const PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];
// public/img/tbd.jpg already ships with the site, so an empty photo folder still renders
// real <img> tags rather than a wall of broken-image icons.
const FALLBACK_PHOTOS = ['/img/tbd.jpg'];

const LABEL_FMT = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
});

let photoCache = null;

/**
 * Image paths for the wall, sorted by filename. Cached — adding a photo needs a restart,
 * which beats a readdir on every request for a page that is mostly scrolled.
 */
function listPhotos() {
    if (photoCache) return photoCache;

    let files = [];
    try {
        files = fs.readdirSync(PHOTO_DIR);
    } catch (_e) {
        files = []; // folder not created yet — fall through to the placeholder
    }

    const photos = files
        .filter(f => PHOTO_EXTS.includes(path.extname(f).toLowerCase()))
        .sort()
        .map(f => `/img/mcm/${encodeURIComponent(f)}`); // filenames arrive with spaces and parens

    photoCache = photos.length ? photos : FALLBACK_PHOTOS;
    return photoCache;
}

/** Test hook — lets a test point the wall at a different set of photos. */
function _resetPhotoCache() {
    photoCache = null;
}

/** Midnight UTC on the most recent Monday on or before `today`. */
function mostRecentMonday(today) {
    const ms = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const dow = new Date(ms).getUTCDay(); // 0 = Sunday
    return ms - ((dow + 6) % 7) * DAY_MS; // Monday -> 0 back, Sunday -> 6 back
}

function isoDate(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Every frame, newest Monday first, Signing Day last.
 *
 * Week numbers count up from 1 at the oldest Monday so the photo assigned to a given date
 * never changes as new Mondays are pushed onto the front of the list.
 */
function buildFrames(today) {
    const photos = listPhotos();
    const latest = Math.max(mostRecentMonday(today), FIRST_MONDAY);
    const weeks = Math.round((latest - FIRST_MONDAY) / WEEK_MS) + 1;

    const frames = [];
    for (let i = 0; i < weeks; i++) {
        const ms = latest - i * WEEK_MS;
        const week = weeks - i;
        frames.push({
            date: isoDate(ms),
            label: LABEL_FMT.format(ms),
            photo: photos[(week - 1) % photos.length],
            week,
            isSigningDay: false,
        });
    }

    frames.push({
        date: isoDate(SIGNING_DAY),
        label: LABEL_FMT.format(SIGNING_DAY),
        photo: photos[0],
        week: 0,
        isSigningDay: true,
    });

    return frames;
}

/**
 * One page of the wall.
 *
 * `page` is clamped rather than rejected — a hand-typed ?page=9999 should land on the
 * Signing Day plaque, not a 404. `today` exists so tests are deterministic.
 */
function getPage({page, today} = {}) {
    const all = buildFrames(today || new Date());
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
    const current = Math.min(Math.max(1, parseInt(page, 10) || 1), totalPages);
    const start = (current - 1) * PER_PAGE;

    return {
        frames: all.slice(start, start + PER_PAGE),
        page: current,
        totalPages,
        total,
        hasMore: current < totalPages,
        perPage: PER_PAGE,
    };
}

module.exports = {getPage, listPhotos, _resetPhotoCache, PER_PAGE};
