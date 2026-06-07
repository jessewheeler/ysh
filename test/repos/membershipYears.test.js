jest.mock('../../db/database', () => require('../helpers/setupDb'));
const db = require('../helpers/setupDb');
const repo = require('../../db/repos/membershipYears');
const {insertMember, insertPeriod, insertPayment} = require('../helpers/fixtures');

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
