jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const {insertMember, insertSetting, insertPeriod, enrollMember} = require('../helpers/fixtures');

let renewalService;

beforeEach(() => {
    db.__resetTestDb();
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({ok: true, status: 202});

    jest.isolateModules(() => {
        renewalService = require('../../services/renewal');
    });
});

function getTestDb() {
    return db.__getCurrentDb();
}

describe('generateRenewalToken', () => {
    test('sets token and expiry on member', async () => {
        const testDb = getTestDb();
        const member = insertMember(testDb, {email: 'a@a.com', status: 'active'});

        const token = await renewalService.generateRenewalToken(member.id);

        expect(token).toBeTruthy();
        expect(token.length).toBe(64); // 32 bytes hex = 64 chars

        const updated = testDb.prepare('SELECT renewal_token, renewal_token_expires_at FROM members WHERE id = ?').get(member.id);
        expect(updated.renewal_token).toBe(token);
        expect(updated.renewal_token_expires_at).toBeTruthy();
    });

  test('token expiry is approximately 30 days from now', async () => {
        const testDb = getTestDb();
        const member = insertMember(testDb, {email: 'b@b.com', status: 'active'});

        const before = Date.now();
        await renewalService.generateRenewalToken(member.id);
        const after = Date.now();

        const updated = testDb.prepare('SELECT renewal_token_expires_at FROM members WHERE id = ?').get(member.id);
        const expiryMs = new Date(updated.renewal_token_expires_at).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    expect(expiryMs).toBeGreaterThanOrEqual(before + thirtyDaysMs - 1000);
    expect(expiryMs).toBeLessThanOrEqual(after + thirtyDaysMs + 1000);
    });
});

describe('findMembersNeedingRenewal', () => {
    function insertCurrentPeriod(testDb) {
        const today = new Date();
        const start = new Date(today);
        start.setMonth(start.getMonth() - 1);
        const end = new Date(today);
        end.setMonth(end.getMonth() + 12);
        return insertPeriod(testDb, {
            start_date: start.toISOString().slice(0, 10),
            end_date: end.toISOString().slice(0, 10),
        });
    }

    test('returns primary members with expiry within threshold and no current-period enrollment', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');
        insertCurrentPeriod(testDb);

        const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, expiry_date)
             VALUES ('Alice', 'Hawk', 'alice@test.com', 'active', ?)`
        ).run(expiryDate);

        const members = await renewalService.findMembersNeedingRenewal();
        expect(members.length).toBe(1);
        expect(members[0].email).toBe('alice@test.com');
    });

    test('excludes members already enrolled in the current period', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');
        const period = insertCurrentPeriod(testDb);

        const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const result = testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, expiry_date)
             VALUES ('Bob', 'Hawk', 'bob@test.com', 'active', ?) RETURNING id`
        ).get(expiryDate);
        enrollMember(testDb, result.id, period.id);

        const members = await renewalService.findMembersNeedingRenewal();
        expect(members.length).toBe(0);
    });

    test('excludes members without expiry_date', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');
        insertCurrentPeriod(testDb);

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status)
             VALUES ('Carol', 'Hawk', 'carol@test.com', 'active')`
        ).run();

        const members = await renewalService.findMembersNeedingRenewal();
        expect(members.length).toBe(0);
    });

    test('excludes family members (primary_member_id IS NOT NULL)', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');
        insertCurrentPeriod(testDb);

        const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const primary = testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, expiry_date, membership_type)
             VALUES ('Dan', 'Hawk', 'dan@test.com', 'active', ?, 'family') RETURNING id`
        ).get(expiryDate);

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, expiry_date, membership_type, primary_member_id)
             VALUES ('Eve', 'Hawk', 'eve@test.com', 'active', ?, 'family', ?)`
        ).run(expiryDate, primary.id);

        const members = await renewalService.findMembersNeedingRenewal();
        expect(members.length).toBe(1);
        expect(members[0].email).toBe('dan@test.com');
    });

    test('excludes members with expiry beyond threshold', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');
        insertCurrentPeriod(testDb);

        const farExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, expiry_date)
             VALUES ('Frank', 'Hawk', 'frank@test.com', 'active', ?)`
        ).run(farExpiry);

        const members = await renewalService.findMembersNeedingRenewal();
        expect(members.length).toBe(0);
    });

    test('returns empty list when no current period is open', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');
        // No period inserted — getCurrent() returns null

        const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, expiry_date)
             VALUES ('Grace', 'Hawk', 'grace@test.com', 'active', ?)`
        ).run(expiryDate);

        const members = await renewalService.findMembersNeedingRenewal();
        expect(members.length).toBe(0);
    });
});

describe('sendBulkRenewalReminders', () => {
    function insertCurrentPeriod(testDb) {
        const today = new Date();
        const start = new Date(today);
        start.setMonth(start.getMonth() - 1);
        const end = new Date(today);
        end.setMonth(end.getMonth() + 12);
        return insertPeriod(testDb, {
            start_date: start.toISOString().slice(0, 10),
            end_date: end.toISOString().slice(0, 10),
        });
    }

    test('sends email for each eligible member and returns counts', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');
        insertCurrentPeriod(testDb);

        const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, expiry_date)
             VALUES ('Alice', 'Hawk', 'alice2@test.com', 'active', ?)`
        ).run(expiryDate);
        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, expiry_date)
             VALUES ('Bob', 'Hawk', 'bob2@test.com', 'active', ?)`
        ).run(expiryDate);

        const result = await renewalService.sendBulkRenewalReminders('http://localhost:3000');

        expect(result.total).toBe(2);
        expect(result.sent).toBe(2);
        expect(result.failed).toBe(0);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('counts failures and does not throw', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');
        insertCurrentPeriod(testDb);

        const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, expiry_date)
             VALUES ('Grace', 'Hawk', 'grace@test.com', 'active', ?)`
        ).run(expiryDate);

        global.fetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await renewalService.sendBulkRenewalReminders('http://localhost:3000');

        expect(result.total).toBe(1);
        expect(result.sent).toBe(0);
        expect(result.failed).toBe(1);
    });

    test('returns zero counts when no eligible members', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');
        insertCurrentPeriod(testDb);

        const result = await renewalService.sendBulkRenewalReminders('http://localhost:3000');

        expect(result.total).toBe(0);
        expect(result.sent).toBe(0);
        expect(result.failed).toBe(0);
    });
});
