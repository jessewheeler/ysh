jest.mock('../../db/database', () => require('../helpers/setupDb'));
const db = require('../helpers/setupDb');
const checkIn = require('../../services/checkIn');
const {
    insertEvent, insertPeriod, insertMember, insertFamilyMembership, enrollMember,
} = require('../helpers/fixtures');

let period;
let event;

beforeEach(() => {
    db.__resetTestDb();
    period = insertPeriod(db, {start_date: '2026-04-01', end_date: '2027-03-31'});
    event = insertEvent(db, {event_date: '2026-09-13', membership_period_id: period.id});
});

const rows = () => db.prepare('SELECT * FROM check_ins ORDER BY member_id').all();

describe('householdForCheckIn', () => {
    test('opens the whole household from a family member id', async () => {
        const {primary, familyMembers} = insertFamilyMembership(db);
        const ctx = await checkIn.householdForCheckIn(event.id, familyMembers[1].id);
        expect(ctx.primary.id).toBe(primary.id);
        expect(ctx.people.map(p => p.member.id)).toEqual([primary.id, ...familyMembers.map(f => f.id)]);
        expect(ctx.people[0].isPrimary).toBe(true);
    });

    test('a family member counts as enrolled through their primary', async () => {
        const {primary, familyMembers} = insertFamilyMembership(db);
        enrollMember(db, primary.id, period.id);
        const ctx = await checkIn.householdForCheckIn(event.id, primary.id);
        expect(ctx.people.every(p => p.enrolled)).toBe(true);
        expect(ctx.people.find(p => p.member.id === familyMembers[0].id).enrolled).toBe(true);
    });

    test('status does not count — only enrollment in the event\'s season', async () => {
        const m = insertMember(db, {status: 'active', email: 'stale@x.test'});
        const ctx = await checkIn.householdForCheckIn(event.id, m.id);
        expect(ctx.people[0].enrolled).toBe(false);
    });

    test('lifetime members are always enrolled', async () => {
        const m = insertMember(db, {is_lifetime: 1, email: 'life@x.test'});
        const ctx = await checkIn.householdForCheckIn(event.id, m.id);
        expect(ctx.people[0].enrolled).toBe(true);
    });

    test('returns null for an unknown event or member', async () => {
        const m = insertMember(db);
        expect(await checkIn.householdForCheckIn(9999, m.id)).toBeNull();
        expect(await checkIn.householdForCheckIn(event.id, 9999)).toBeNull();
    });
});

describe('recordHousehold', () => {
    test('checks in only the ticked members with one ticket each by default', async () => {
        const {primary, familyMembers: [jane, jimmy]} = insertFamilyMembership(db);
        enrollMember(db, primary.id, period.id);
        const result = await checkIn.recordHousehold(event.id, jane.id, {
            [`present_${primary.id}`]: '1',
            [`present_${jimmy.id}`]: '1',
        });
        expect(result.checkedIn.map(m => m.id)).toEqual([primary.id, jimmy.id]);
        expect(result.tickets).toBe(2);
        expect(rows().map(r => [r.member_id, r.tickets_issued])).toEqual([[primary.id, 1], [jimmy.id, 1]]);
    });

    test('a second submit does not double-count', async () => {
        const m = insertMember(db);
        enrollMember(db, m.id, period.id);
        const form = {[`present_${m.id}`]: '1', [`tickets_${m.id}`]: '1'};
        await checkIn.recordHousehold(event.id, m.id, form);
        await checkIn.recordHousehold(event.id, m.id, form);
        expect(rows()).toHaveLength(1);
    });

    test('keeps extra tickets for promotions, capped at the maximum', async () => {
        const m = insertMember(db);
        enrollMember(db, m.id, period.id);
        await checkIn.recordHousehold(event.id, m.id, {[`present_${m.id}`]: '1', [`tickets_${m.id}`]: '3'});
        expect(rows()[0].tickets_issued).toBe(3);
        await checkIn.recordHousehold(event.id, m.id, {[`present_${m.id}`]: '1', [`tickets_${m.id}`]: '500'});
        expect(rows()[0].tickets_issued).toBe(checkIn.MAX_TICKETS);
    });

    test('a member not enrolled is checked in with no tickets, whatever the form says', async () => {
        const m = insertMember(db, {email: 'lapsed@x.test'});
        await checkIn.recordHousehold(event.id, m.id, {[`present_${m.id}`]: '1', [`tickets_${m.id}`]: '4'});
        expect(rows()[0]).toMatchObject({tickets_issued: 0, enrolled_at_check_in: 0});
    });

    test('ignores member ids from another household', async () => {
        const m = insertMember(db, {email: 'me@x.test'});
        const other = insertMember(db, {email: 'other@x.test'});
        await checkIn.recordHousehold(event.id, m.id, {[`present_${m.id}`]: '1', [`present_${other.id}`]: '1'});
        expect(rows().map(r => r.member_id)).toEqual([m.id]);
    });

    test('unticking someone already checked in removes them', async () => {
        const {primary, familyMembers: [jane]} = insertFamilyMembership(db);
        await checkIn.recordHousehold(event.id, primary.id, {[`present_${primary.id}`]: '1', [`present_${jane.id}`]: '1'});
        const result = await checkIn.recordHousehold(event.id, primary.id, {[`present_${primary.id}`]: '1'});
        expect(result.removed.map(m => m.id)).toEqual([jane.id]);
        expect(rows().map(r => r.member_id)).toEqual([primary.id]);
    });
});
