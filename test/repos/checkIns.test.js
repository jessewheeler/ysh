jest.mock('../../db/database', () => require('../helpers/setupDb'));
const db = require('../helpers/setupDb');
const repo = require('../../db/repos/checkIns');
const {insertEvent, insertPeriod, insertMember, insertFamilyMembership} = require('../helpers/fixtures');

beforeEach(() => db.__resetTestDb());

const countRows = () => db.prepare('SELECT COUNT(*) AS c FROM check_ins').get().c;

describe('checkIns repo', () => {
    test('upsert is idempotent on (event, member)', async () => {
        const e = insertEvent(db);
        const m = insertMember(db);
        const first = await repo.upsert({eventId: e.id, memberId: m.id, tickets: 1, enrolled: true});
        const second = await repo.upsert({eventId: e.id, memberId: m.id, tickets: 1, enrolled: true});
        expect(second.id).toBe(first.id);
        expect(countRows()).toBe(1);
        // An unchanged re-submit writes no second audit row.
        expect(db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE table_name = 'check_ins'").get().c).toBe(1);
    });

    test('upsert updates the ticket count and keeps the first check-in time', async () => {
        const e = insertEvent(db);
        const m = insertMember(db);
        const first = await repo.upsert({eventId: e.id, memberId: m.id, tickets: 1, enrolled: true});
        const row = await repo.upsert({eventId: e.id, memberId: m.id, tickets: 3, enrolled: true});
        expect(row.tickets_issued).toBe(3);
        expect(row.checked_in_at).toBe(first.checked_in_at);
    });

    test('remove deletes the row and audits it', async () => {
        const e = insertEvent(db);
        const m = insertMember(db);
        await repo.upsert({eventId: e.id, memberId: m.id, tickets: 1, enrolled: true});
        expect(await repo.remove(e.id, m.id)).toBe(true);
        expect(await repo.remove(e.id, m.id)).toBe(false);
        expect(countRows()).toBe(0);
        expect(db.prepare("SELECT action FROM audit_log WHERE table_name = 'check_ins' ORDER BY id DESC").get().action).toBe('DELETE');
    });

    test('raffleEntries totals tickets per member across the season only', async () => {
        const season = insertPeriod(db, {start_date: '2026-04-01', end_date: '2027-03-31'});
        const last = insertPeriod(db, {start_date: '2025-04-01', end_date: '2026-03-31'});
        const e1 = insertEvent(db, {event_date: '2026-09-13', membership_period_id: season.id});
        const e2 = insertEvent(db, {event_date: '2026-09-20', membership_period_id: season.id});
        const eOld = insertEvent(db, {event_date: '2025-09-20', membership_period_id: last.id});
        const {primary, familyMembers: [jane]} = insertFamilyMembership(db);
        const lapsed = insertMember(db, {email: 'lapsed@x.test', last_name: 'Zed'});

        await repo.upsert({eventId: e1.id, memberId: primary.id, tickets: 1, enrolled: true});
        await repo.upsert({eventId: e2.id, memberId: primary.id, tickets: 2, enrolled: true});
        await repo.upsert({eventId: eOld.id, memberId: primary.id, tickets: 5, enrolled: true});
        await repo.upsert({eventId: e1.id, memberId: jane.id, tickets: 1, enrolled: true});
        await repo.upsert({eventId: e1.id, memberId: lapsed.id, tickets: 0, enrolled: false});

        const entries = await repo.raffleEntries(season.id);
        const byId = Object.fromEntries(entries.map(r => [r.member_id, r]));
        expect(byId[primary.id]).toMatchObject({tickets: 3, events_attended: 2});
        expect(byId[jane.id]).toMatchObject({tickets: 1, primary_first_name: primary.first_name});
        expect(byId[lapsed.id]).toBeUndefined();
    });
});
