jest.mock('../../db/database', () => require('../helpers/setupDb'));
const db = require('../helpers/setupDb');
const nflSchedule = require('../../services/nflSchedule');
const eventsRepo = require('../../db/repos/events');
const {insertPeriod} = require('../helpers/fixtures');
const fixture = require('../fixtures/espn-sea-schedule.json');

const clone = (o) => JSON.parse(JSON.stringify(o));

function mockEspn(regular, post = {events: []}) {
    global.fetch = jest.fn(async (url) => ({
        ok: true,
        json: async () => clone(url.includes('seasontype=3') ? post : regular),
    }));
}

const realFetch = global.fetch;
afterAll(() => { global.fetch = realFetch; });

beforeEach(() => db.__resetTestDb());

describe('mapEspnEvent', () => {
    const [sundayNight, away, tbd] = fixture.events;

    test('files a Sunday night game under the Denver date, not the UTC one', () => {
        // 2026-09-10T00:20Z is 6:20 PM on the 9th in Montana.
        expect(nflSchedule.mapEspnEvent(sundayNight)).toMatchObject({
            external_id: '401872656',
            name: 'Week 1: vs New England Patriots',
            event_date: '2026-09-09',
            kickoff_at: '2026-09-10T00:20:00.000Z',
            opponent: 'New England Patriots',
            home_away: 'home',
        });
    });

    test('names away games with "at"', () => {
        expect(nflSchedule.mapEspnEvent(away)).toMatchObject({
            name: 'Week 3: at Washington Commanders', home_away: 'away', event_date: '2026-09-27',
        });
    });

    test('a TBD kickoff keeps the placeholder\'s date and leaves kickoff empty', () => {
        expect(nflSchedule.mapEspnEvent(tbd)).toMatchObject({kickoff_at: null, event_date: '2027-01-10'});
    });

    test('ignores anything without a Seahawks competitor', () => {
        const ev = clone(sundayNight);
        ev.competitions[0].competitors.forEach(c => { c.team.abbreviation = 'XX'; });
        expect(nflSchedule.mapEspnEvent(ev)).toBeNull();
    });
});

describe('currentSeason', () => {
    test('January and February belong to the previous season', () => {
        expect(nflSchedule.currentSeason(new Date('2027-01-20T12:00:00Z'))).toBe(2026);
        expect(nflSchedule.currentSeason(new Date('2026-09-20T12:00:00Z'))).toBe(2026);
    });
});

describe('syncSchedule', () => {
    test('creates one event per game, filed under the season it falls in', async () => {
        const season = insertPeriod(db, {start_date: '2026-04-01', end_date: '2027-03-31'});
        mockEspn(fixture);
        const stats = await nflSchedule.syncSchedule({season: 2026});
        expect(stats).toEqual({created: 3, updated: 0, unchanged: 0, total: 3});
        const rows = await eventsRepo.list();
        expect(rows).toHaveLength(3);
        expect(rows.every(r => r.source === 'espn' && r.membership_period_id === season.id)).toBe(true);
    });

    test('running twice does not duplicate', async () => {
        mockEspn(fixture);
        await nflSchedule.syncSchedule({season: 2026});
        const stats = await nflSchedule.syncSchedule({season: 2026});
        expect(stats).toMatchObject({created: 0, updated: 0, unchanged: 3});
        expect(db.prepare('SELECT COUNT(*) AS c FROM events').get().c).toBe(3);
    });

    test('a flexed game moves, but admin edits are kept', async () => {
        mockEspn(fixture);
        await nflSchedule.syncSchedule({season: 2026});
        const ev = await eventsRepo.findByExternalId('401872955');
        await eventsRepo.update(ev.id, {name: 'Commanders watch party', location: 'The Rail'});

        const flexed = clone(fixture);
        flexed.events[1].date = '2026-09-28T00:20Z';
        mockEspn(flexed);
        const stats = await nflSchedule.syncSchedule({season: 2026});

        expect(stats.updated).toBe(1);
        const after = await eventsRepo.get(ev.id);
        expect(after).toMatchObject({
            name: 'Commanders watch party',
            location: 'The Rail',
            event_date: '2026-09-27',
            kickoff_at: '2026-09-28T00:20:00.000Z',
        });
    });

    test('dry run writes nothing', async () => {
        mockEspn(fixture);
        const stats = await nflSchedule.syncSchedule({season: 2026, dryRun: true});
        expect(stats.created).toBe(3);
        expect(db.prepare('SELECT COUNT(*) AS c FROM events').get().c).toBe(0);
    });

    test('an ESPN failure throws for the caller to report', async () => {
        global.fetch = jest.fn(async () => ({ok: false, status: 503}));
        await expect(nflSchedule.syncSchedule({season: 2026})).rejects.toThrow(/503/);
    });
});
