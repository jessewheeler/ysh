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
        expect((await repo.list()).map(r => r.id)).toEqual([cur.id, old.id]);
    });

    test('listOnDate skips cancelled events', async () => {
        insertEvent(db, {name: 'Off', event_date: '2026-10-04', cancelled: 1});
        const on = insertEvent(db, {name: 'On', event_date: '2026-10-04'});
        insertEvent(db, {name: 'Other day', event_date: '2026-10-05'});
        expect((await repo.listOnDate('2026-10-04')).map(r => r.id)).toEqual([on.id]);
    });
});
