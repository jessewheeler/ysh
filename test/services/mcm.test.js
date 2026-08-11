/**
 * The Man Crush Monday wall is generated from the calendar, so every assertion here pins
 * `today` to a fixed date. Without that the expected frame count changes every Monday and
 * the suite rots on its own.
 */
const mcm = require('../../services/mcm');

const TODAY = new Date(Date.UTC(2026, 7, 10)); // Monday, August 10 2026
const DAY_MS = 24 * 60 * 60 * 1000;

function allFrames(today = TODAY) {
    const frames = [];
    let page = 1;
    for (; ;) {
        const res = mcm.getPage({page, today});
        frames.push(...res.frames);
        if (!res.hasMore) return frames;
        page += 1;
    }
}

describe('services/mcm — frame generation', () => {
    it('runs every Monday from 2023-03-20 to today, plus the signing-day frame', () => {
        const frames = allFrames();
        // 178 Mondays between 2023-03-20 and 2026-08-10 inclusive, then Signing Day.
        expect(frames).toHaveLength(179);
        expect(mcm.getPage({page: 1, today: TODAY}).total).toBe(179);
    });

    it('leads with the most recent Monday', () => {
        const [first] = mcm.getPage({page: 1, today: TODAY}).frames;
        expect(first.date).toBe('2026-08-10');
        expect(first.label).toBe('August 10, 2026');
        expect(first.isSigningDay).toBe(false);
    });

    it('ends on Julian Love signing day, March 17 2023', () => {
        const frames = allFrames();
        const last = frames[frames.length - 1];
        expect(last.date).toBe('2023-03-17');
        expect(last.label).toBe('March 17, 2023');
        expect(last.isSigningDay).toBe(true);

        // The oldest actual Monday sits just above it.
        expect(frames[frames.length - 2].date).toBe('2023-03-20');
    });

    it('emits only Mondays, exactly seven days apart', () => {
        const mondays = allFrames().filter(f => !f.isSigningDay);

        mondays.forEach(f => {
            expect(new Date(f.date + 'T00:00:00Z').getUTCDay()).toBe(1);
        });

        // Catches DST drift, which would show up as a 6- or 8-day gap.
        for (let i = 1; i < mondays.length; i++) {
            const gap = Date.parse(mondays[i - 1].date) - Date.parse(mondays[i].date);
            expect(gap).toBe(7 * DAY_MS);
        }
    });

    it('advances by one frame per week', () => {
        const before = mcm.getPage({today: TODAY}).total;
        const after = mcm.getPage({today: new Date(TODAY.getTime() + 7 * DAY_MS)}).total;
        expect(after).toBe(before + 1);
    });

    it('handles a today that is not a Monday by falling back to the prior Monday', () => {
        const sunday = new Date(Date.UTC(2026, 7, 9));
        const [first] = mcm.getPage({today: sunday}).frames;
        expect(first.date).toBe('2026-08-03');
    });
});

describe('services/mcm — photos', () => {
    it('assigns a photo to every frame from the mcm folder', () => {
        const photos = mcm.listPhotos();
        expect(photos.length).toBeGreaterThan(0);
        photos.forEach(p => expect(p).toMatch(/^\/img\//));

        allFrames().forEach(f => expect(photos).toContain(f.photo));
    });

    it('cycles the photos so the rotation repeats every N weeks', () => {
        const n = mcm.listPhotos().length;
        const mondays = allFrames().filter(f => !f.isSigningDay);
        const byWeek = new Map(mondays.map(f => [f.week, f.photo]));

        for (let week = 1; week + n <= mondays.length; week++) {
            expect(byWeek.get(week + n)).toBe(byWeek.get(week));
        }
    });

    it('keeps a given date on the same photo as new Mondays are added', () => {
        const later = new Date(TODAY.getTime() + 3 * 7 * DAY_MS);
        const find = (today, date) => allFrames(today).find(f => f.date === date).photo;
        expect(find(later, '2023-03-20')).toBe(find(TODAY, '2023-03-20'));
    });
});

describe('services/mcm — pagination', () => {
    it('serves 24 frames per page and reports how many pages there are', () => {
        const res = mcm.getPage({page: 1, today: TODAY});
        expect(res.frames).toHaveLength(24);
        expect(res.perPage).toBe(24);
        expect(res.totalPages).toBe(Math.ceil(179 / 24));
        expect(res.hasMore).toBe(true);
    });

    it('marks the final page as the end of the wall', () => {
        const {totalPages} = mcm.getPage({today: TODAY});
        const last = mcm.getPage({page: totalPages, today: TODAY});
        expect(last.hasMore).toBe(false);
        expect(last.frames[last.frames.length - 1].isSigningDay).toBe(true);
    });

    it('clamps junk page numbers instead of throwing or 404ing', () => {
        const {totalPages} = mcm.getPage({today: TODAY});
        [0, -5, NaN, undefined, 'abc', null].forEach(page => {
            expect(mcm.getPage({page, today: TODAY}).page).toBe(1);
        });
        expect(mcm.getPage({page: 9999, today: TODAY}).page).toBe(totalPages);
        expect(mcm.getPage({page: '3', today: TODAY}).page).toBe(3);
    });

    it('covers the whole wall exactly once across all pages', () => {
        const dates = allFrames().map(f => f.date);
        expect(new Set(dates).size).toBe(dates.length);
    });
});
