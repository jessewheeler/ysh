jest.mock('../../db/database', () => require('../helpers/setupDb'));
const db = require('../helpers/setupDb');
const repo = require('../../db/repos/events');
const {insertEvent, insertPeriod, insertMember} = require('../helpers/fixtures');

beforeEach(() => db.__resetTestDb());

describe('events repo', () => {
    test('create stores the event and writes an audit row', async () => {
        const row = await repo.create({name: 'Watch party', event_date: '2026-10-04', location: 'The Rail'});
        expect(row).toMatchObject({name: 'Watch party', event_date: '2026-10-04', location: 'The Rail', source: 'manual', cancelled: 0});
        const audit = db.prepare("SELECT * FROM audit_log WHERE table_name = 'events' AND record_id = ?").get(String(row.id));
        expect(audit.action).toBe('INSERT');
    });

    test('update changes only the fields passed and audits old and new values', async () => {
        const e = insertEvent(db, {location: 'The Rail', notes: 'Bring flags'});
        const row = await repo.update(e.id, {location: 'Pub Station'});
        expect(row.location).toBe('Pub Station');
        expect(row.notes).toBe('Bring flags');
        const audit = db.prepare("SELECT * FROM audit_log WHERE table_name = 'events' AND action = 'UPDATE'").get();
        expect(JSON.parse(audit.old_values).location).toBe('The Rail');
        expect(JSON.parse(audit.new_values).location).toBe('Pub Station');
    });

    test('external_id is unique, but many manual events may have none', () => {
        insertEvent(db, {external_id: '401872656', source: 'espn'});
        insertEvent(db);
        insertEvent(db);
        expect(() => insertEvent(db, {external_id: '401872656', source: 'espn'})).toThrow(/UNIQUE/);
    });

    test('list filters by season and carries attendance and ticket totals', async () => {
        const p1 = insertPeriod(db, {label: 'A', start_date: '2025-04-01', end_date: '2026-03-31'});
        const p2 = insertPeriod(db, {label: 'B', start_date: '2026-04-01', end_date: '2027-03-31'});
        const old = insertEvent(db, {name: 'Old', event_date: '2025-10-01', membership_period_id: p1.id});
        const cur = insertEvent(db, {name: 'Current', event_date: '2026-10-01', membership_period_id: p2.id});
        const a = insertMember(db, {email: 'a@x.test'});
        const b = insertMember(db, {email: 'b@x.test'});
        db.prepare('INSERT INTO check_ins (event_id, member_id, tickets_issued) VALUES (?, ?, ?)').run(cur.id, a.id, 1);
        db.prepare('INSERT INTO check_ins (event_id, member_id, tickets_issued) VALUES (?, ?, ?)').run(cur.id, b.id, 3);

        const rows = await repo.list({periodId: p2.id});
        expect(rows.map(r => r.id)).toEqual([cur.id]);
        expect(rows[0]).toMatchObject({attendance: 2, tickets: 4});
        expect((await repo.list()).map(r => r.id)).toEqual([old.id, cur.id]);
    });

    test('listOnDate skips cancelled events', async () => {
        insertEvent(db, {name: 'Off', event_date: '2026-10-04', cancelled: 1});
        const on = insertEvent(db, {name: 'On', event_date: '2026-10-04'});
        insertEvent(db, {name: 'Other day', event_date: '2026-10-05'});
        expect((await repo.listOnDate('2026-10-04')).map(r => r.id)).toEqual([on.id]);
    });

    describe('views', () => {
        const today = '2026-10-04';
        let p1;
        let p2;
        let lastSeason;
        let past;
        let game;
        let next;
        let later;

        beforeEach(() => {
            p1 = insertPeriod(db, {label: 'A', start_date: '2025-04-01', end_date: '2026-03-31'});
            p2 = insertPeriod(db, {label: 'B', start_date: '2026-04-01', end_date: '2027-03-31'});
            lastSeason = insertEvent(db, {name: 'Last season', event_date: '2025-12-01', membership_period_id: p1.id});
            later = insertEvent(db, {name: 'Later', event_date: '2026-10-19', membership_period_id: p2.id});
            past = insertEvent(db, {name: 'Past', event_date: '2026-09-27', membership_period_id: p2.id});
            next = insertEvent(db, {name: 'Next', event_date: '2026-10-12', membership_period_id: p2.id});
            game = insertEvent(db, {name: 'Today', event_date: today, membership_period_id: p2.id});
        });

        test('upcoming starts at today and runs soonest first', async () => {
            const rows = await repo.list({periodId: p2.id, view: 'upcoming', today});
            expect(rows.map(r => r.id)).toEqual([game.id, next.id, later.id]);
        });

        test('past excludes today and runs most recent first', async () => {
            expect((await repo.list({view: 'past', today})).map(r => r.id)).toEqual([past.id, lastSeason.id]);
            expect((await repo.list({periodId: p2.id, view: 'past', today})).map(r => r.id)).toEqual([past.id]);
        });

        test('all is every event in date order', async () => {
            expect((await repo.list({periodId: p2.id, view: 'all', today})).map(r => r.id))
                .toEqual([past.id, game.id, next.id, later.id]);
        });

        test('an unknown view falls back to all', async () => {
            expect(await repo.list({periodId: p2.id, view: 'bogus', today})).toHaveLength(4);
        });

        test('countByView counts each view, narrowed by season', async () => {
            expect(await repo.countByView({today})).toEqual({upcoming: 3, past: 2, all: 5});
            expect(await repo.countByView({periodId: p2.id, today})).toEqual({upcoming: 3, past: 1, all: 4});
            expect(await repo.countByView({periodId: 9999, today})).toEqual({upcoming: 0, past: 0, all: 0});
        });
    });

    describe('findNearest', () => {
        test('prefers today\'s event, earliest kickoff first', async () => {
            insertEvent(db, {name: 'Tomorrow', event_date: '2026-10-05'});
            insertEvent(db, {name: 'Late', event_date: '2026-10-04', kickoff_at: '2026-10-05T02:20:00Z'});
            const early = insertEvent(db, {name: 'Early', event_date: '2026-10-04', kickoff_at: '2026-10-04T17:00:00Z'});
            expect((await repo.findNearest('2026-10-04')).id).toBe(early.id);
        });

        test('on a non-game day picks the next upcoming event, skipping cancelled ones', async () => {
            insertEvent(db, {name: 'Yesterday', event_date: '2026-10-03'});
            insertEvent(db, {name: 'Cancelled', event_date: '2026-10-06', cancelled: 1});
            const next = insertEvent(db, {name: 'Next', event_date: '2026-10-12'});
            insertEvent(db, {name: 'Later', event_date: '2026-10-19'});
            expect((await repo.findNearest('2026-10-04')).id).toBe(next.id);
        });

        test('falls back to the most recent past event', async () => {
            insertEvent(db, {name: 'Older', event_date: '2026-09-20'});
            const recent = insertEvent(db, {name: 'Recent', event_date: '2026-09-27'});
            insertEvent(db, {name: 'Cancelled', event_date: '2026-10-01', cancelled: 1});
            expect((await repo.findNearest('2026-10-04')).id).toBe(recent.id);
        });

        test('is null with no events', async () => {
            expect(await repo.findNearest('2026-10-04')).toBeNull();
        });
    });
});
