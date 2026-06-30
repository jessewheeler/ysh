jest.mock('../../db/database', () => require('../helpers/setupDb'));
const db = require('../helpers/setupDb');
const repo = require('../../db/repos/membershipPeriods');
const {insertPeriod} = require('../helpers/fixtures');

beforeEach(() => db.__resetTestDb());

describe('list', () => {
    test('returns periods ordered by start_date DESC', async () => {
        insertPeriod(db, {start_date: '2024-04-01', end_date: '2025-07-31', label: 'Old'});
        insertPeriod(db, {start_date: '2025-04-01', end_date: '2026-07-31', label: 'New'});
        const rows = await repo.list();
        expect(rows[0].label).toBe('New');
        expect(rows[1].label).toBe('Old');
    });
});

describe('get', () => {
    test('returns a period by id', async () => {
        const p = insertPeriod(db, {label: 'Test Period'});
        const found = await repo.get(p.id);
        expect(found.label).toBe('Test Period');
    });

    test('returns undefined for missing id', async () => {
        expect(await repo.get(999)).toBeUndefined();
    });
});

describe('create', () => {
    test('inserts a period and returns it', async () => {
        const result = await repo.create({
            label: '2026-27 Season',
            start_date: '2026-04-01',
            end_date: '2027-07-31',
            individual_dues_cents: 1600,
            family_dues_cents: 2600,
            electronic_surcharge_cents: 150,
        });
        expect(result.id).toBeDefined();
        const row = await repo.get(result.id);
        expect(row.label).toBe('2026-27 Season');
        expect(row.individual_dues_cents).toBe(1600);
        expect(row.electronic_surcharge_cents).toBe(150);
    });

    test('writes an audit log row on create', async () => {
        await repo.create({
            label: 'Audit Test',
            start_date: '2025-04-01',
            end_date: '2026-07-31',
            individual_dues_cents: 1600,
            family_dues_cents: 2600,
            electronic_surcharge_cents: 0,
        });
        const log = db.prepare("SELECT * FROM audit_log WHERE table_name='membership_periods' AND action='INSERT'").get();
        expect(log).toBeTruthy();
    });
});

describe('update', () => {
    test('updates fields and writes audit row', async () => {
        const p = insertPeriod(db, {label: 'Old Label'});
        await repo.update(p.id, {
            label: 'New Label',
            start_date: p.start_date,
            end_date: p.end_date,
            individual_dues_cents: 2000,
            family_dues_cents: 3000,
            electronic_surcharge_cents: 200,
        });
        const updated = await repo.get(p.id);
        expect(updated.label).toBe('New Label');
        expect(updated.individual_dues_cents).toBe(2000);
        const log = db.prepare("SELECT * FROM audit_log WHERE table_name='membership_periods' AND action='UPDATE'").get();
        expect(log).toBeTruthy();
    });
});

describe('getCurrent', () => {
    test('returns null when no periods exist', async () => {
        expect(await repo.getCurrent()).toBeNull();
    });

    test('returns null when today is before any period starts', async () => {
        insertPeriod(db, {start_date: '2099-04-01', end_date: '2100-07-31'});
        expect(await repo.getCurrent()).toBeNull();
    });

    test('returns null when today is after all periods end', async () => {
        insertPeriod(db, {start_date: '2000-04-01', end_date: '2001-07-31'});
        expect(await repo.getCurrent()).toBeNull();
    });

    test('returns the open period that contains today', async () => {
        insertPeriod(db, {start_date: '2025-04-01', end_date: '2026-07-31', label: 'Current'});
        const result = await repo.getCurrent('2025-06-15');
        expect(result.label).toBe('Current');
    });

    test('picks the latest start_date when two periods overlap', async () => {
        insertPeriod(db, {start_date: '2025-04-01', end_date: '2026-07-31', label: 'Older'});
        insertPeriod(db, {start_date: '2026-04-01', end_date: '2027-07-31', label: 'Newer'});
        // During overlap (Apr–Jul 2026) the newer period wins
        const result = await repo.getCurrent('2026-05-01');
        expect(result.label).toBe('Newer');
    });

    test('excludes a future period that has not opened yet', async () => {
        insertPeriod(db, {start_date: '2025-04-01', end_date: '2026-07-31', label: 'Current'});
        insertPeriod(db, {start_date: '2027-04-01', end_date: '2028-07-31', label: 'Future'});
        const result = await repo.getCurrent('2025-06-15');
        expect(result.label).toBe('Current');
    });

    test('uses today by default (smoke test — result is null or a period)', async () => {
        const result = await repo.getCurrent();
        expect(result === null || typeof result === 'object').toBe(true);
    });
});
