jest.mock('../../db/database', () => require('../helpers/setupDb'));
const db = require('../helpers/setupDb');
const repo = require('../../db/repos/membershipYears');
const {insertMember, insertPeriod, insertPayment, insertFamilyMembership} = require('../helpers/fixtures');

beforeEach(() => db.__resetTestDb());

describe('enroll', () => {
    test('creates an enrollment row', async () => {
        const m = insertMember(db);
        const p = insertPeriod(db);
        const result = await repo.enroll(m.id, p.id, null);
        expect(result.id).toBeDefined();
        const row = db.prepare('SELECT * FROM membership_years WHERE id = ?').get(result.id);
        expect(row.member_id).toBe(m.id);
        expect(row.membership_period_id).toBe(p.id);
    });

    test('is idempotent — second enroll returns existing row', async () => {
        const m = insertMember(db);
        const p = insertPeriod(db);
        const first = await repo.enroll(m.id, p.id, null);
        const second = await repo.enroll(m.id, p.id, null);
        expect(second.id).toBe(first.id);
        const count = db.prepare('SELECT COUNT(*) as c FROM membership_years WHERE member_id = ? AND membership_period_id = ?').get(m.id, p.id);
        expect(count.c).toBe(1);
    });

    test('links a payment_id', async () => {
        const m = insertMember(db);
        const p = insertPeriod(db);
        const pay = insertPayment(db, {member_id: m.id});
        await repo.enroll(m.id, p.id, pay.id);
        const row = db.prepare('SELECT * FROM membership_years WHERE member_id = ? AND membership_period_id = ?').get(m.id, p.id);
        expect(row.payment_id).toBe(pay.id);
    });

    test('writes an audit log row on enroll', async () => {
        const m = insertMember(db);
        const p = insertPeriod(db);
        await repo.enroll(m.id, p.id, null);
        const log = db.prepare("SELECT * FROM audit_log WHERE table_name='membership_years' AND action='INSERT'").get();
        expect(log).toBeTruthy();
    });

    test('does not write a duplicate audit row on idempotent re-enroll', async () => {
        const m = insertMember(db);
        const p = insertPeriod(db);
        await repo.enroll(m.id, p.id, null);
        await repo.enroll(m.id, p.id, null);
        const rows = db.prepare("SELECT * FROM audit_log WHERE table_name='membership_years'").all();
        expect(rows.length).toBe(1);
    });
});

describe('isEnrolled', () => {
    test('returns true when enrolled', async () => {
        const m = insertMember(db);
        const p = insertPeriod(db);
        await repo.enroll(m.id, p.id, null);
        expect(await repo.isEnrolled(m.id, p.id)).toBe(true);
    });

    test('returns false when not enrolled', async () => {
        const m = insertMember(db);
        const p = insertPeriod(db);
        expect(await repo.isEnrolled(m.id, p.id)).toBe(false);
    });
});

describe('findByMember', () => {
    test('returns all enrollment rows for a member', async () => {
        const m = insertMember(db);
        const p1 = insertPeriod(db, {start_date: '2024-04-01', end_date: '2025-07-31'});
        const p2 = insertPeriod(db, {start_date: '2025-04-01', end_date: '2026-07-31'});
        await repo.enroll(m.id, p1.id, null);
        await repo.enroll(m.id, p2.id, null);
        const rows = await repo.findByMember(m.id);
        expect(rows.length).toBe(2);
    });
});

describe('findByPeriod', () => {
    test('returns all enrollment rows for a period', async () => {
        const m1 = insertMember(db, {email: 'a@test.com'});
        const m2 = insertMember(db, {email: 'b@test.com'});
        const p = insertPeriod(db);
        await repo.enroll(m1.id, p.id, null);
        await repo.enroll(m2.id, p.id, null);
        const rows = await repo.findByPeriod(p.id);
        expect(rows.length).toBe(2);
    });
});

describe('listMembersByPeriod', () => {
    test('returns full member rows sorted by last then first name', async () => {
        const p = insertPeriod(db);
        const zeta = insertMember(db, {email: 'z@test.com', first_name: 'Amy', last_name: 'Zeta'});
        const alphaB = insertMember(db, {email: 'ab@test.com', first_name: 'Bob', last_name: 'Alpha'});
        const alphaA = insertMember(db, {email: 'aa@test.com', first_name: 'Ann', last_name: 'Alpha'});
        for (const m of [zeta, alphaB, alphaA]) await repo.enroll(m.id, p.id, null);

        const rows = await repo.listMembersByPeriod(p.id);
        expect(rows.map(r => `${r.last_name} ${r.first_name}`)).toEqual(['Alpha Ann', 'Alpha Bob', 'Zeta Amy']);
        // Full member columns, not just the join's projection.
        expect(rows[0]).toHaveProperty('address_zip');
        expect(rows[0]).toHaveProperty('join_date');
    });

    test('includes family sub-members as their own rows', async () => {
        const p = insertPeriod(db);
        const {primary, familyMembers} = insertFamilyMembership(db);
        for (const m of [primary, ...familyMembers]) await repo.enroll(m.id, p.id, null);

        const rows = await repo.listMembersByPeriod(p.id);
        expect(rows).toHaveLength(1 + familyMembers.length);
    });

    test('includes a sub-member whose primary is enrolled but who has no enrollment row', async () => {
        const p = insertPeriod(db);
        const {primary, familyMembers} = insertFamilyMembership(db);
        await repo.enroll(primary.id, p.id, null);

        const rows = await repo.listMembersByPeriod(p.id);
        expect(rows).toHaveLength(1 + familyMembers.length);
        // And never twice for a sub-member that is enrolled in its own right as well.
        await repo.enroll(familyMembers[0].id, p.id, null);
        expect(await repo.listMembersByPeriod(p.id)).toHaveLength(1 + familyMembers.length);
    });

    test('falls back to the primary address and phone, but never to their email', async () => {
        const p = insertPeriod(db);
        const {primary, familyMembers} = insertFamilyMembership(db, {
            primaryMember: {
                address_street: '1 Main St', address_city: 'Billings', address_state: 'MT',
                address_zip: '59101', phone: '4065551234'
            },
            familyMembers: [{
                first_name: 'Jane', last_name: 'Doe', email: 'jane@family.test',
                address_street: '', address_city: '', address_state: '', address_zip: '', phone: ''
            }]
        });
        await repo.enroll(primary.id, p.id, null);

        const sub = (await repo.listMembersByPeriod(p.id)).find(r => r.id === familyMembers[0].id);
        expect(sub.report_street).toBe('1 Main St');
        expect(sub.report_city).toBe('Billings');
        expect(sub.report_state).toBe('MT');
        expect(sub.report_zip).toBe('59101');
        expect(sub.report_phone).toBe('4065551234');
        expect(sub.email).toBe('jane@family.test');
    });

    test('keeps a member\'s own address when they have one', async () => {
        const p = insertPeriod(db);
        const {primary, familyMembers} = insertFamilyMembership(db, {
            primaryMember: {address_street: '1 Main St'},
            familyMembers: [{first_name: 'Jane', last_name: 'Doe', email: 'jane@family.test', address_street: '2 Elm St'}]
        });
        await repo.enroll(primary.id, p.id, null);

        const sub = (await repo.listMembersByPeriod(p.id)).find(r => r.id === familyMembers[0].id);
        expect(sub.report_street).toBe('2 Elm St');
    });

    test('excludes cancelled members and members of other periods', async () => {
        const thisPeriod = insertPeriod(db);
        const otherPeriod = insertPeriod(db, {start_date: '2024-04-01', end_date: '2025-07-31'});
        const active = insertMember(db, {email: 'active@test.com', status: 'active'});
        const cancelled = insertMember(db, {email: 'cancelled@test.com', status: 'cancelled'});
        const elsewhere = insertMember(db, {email: 'other@test.com'});
        await repo.enroll(active.id, thisPeriod.id, null);
        await repo.enroll(cancelled.id, thisPeriod.id, null);
        await repo.enroll(elsewhere.id, otherPeriod.id, null);

        const rows = await repo.listMembersByPeriod(thisPeriod.id);
        expect(rows.map(r => r.email)).toEqual(['active@test.com']);
    });

    test('returns an empty list for a period with nobody enrolled', async () => {
        const p = insertPeriod(db);
        expect(await repo.listMembersByPeriod(p.id)).toEqual([]);
    });
});
