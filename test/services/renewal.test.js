jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const {insertMember, insertSetting} = require('../helpers/fixtures');

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
    test('returns primary members with expiry within threshold', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');

        const currentYear = new Date().getFullYear();
        const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // 15 days from now

        // Insert member from previous year with upcoming expiry
        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year, expiry_date)
             VALUES ('Alice', 'Hawk', 'alice@test.com', 'active', ?, ?)`
        ).run(currentYear - 1, expiryDate);

        const members = await renewalService.findMembersNeedingRenewal();
        expect(members.length).toBe(1);
        expect(members[0].email).toBe('alice@test.com');
    });

    test('excludes members who already renewed this year', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');

        const currentYear = new Date().getFullYear();
        const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        // Member already renewed this year
        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year, expiry_date)
             VALUES ('Bob', 'Hawk', 'bob@test.com', 'active', ?, ?)`
        ).run(currentYear, expiryDate);

        const members = await renewalService.findMembersNeedingRenewal();
        expect(members.length).toBe(0);
    });

    test('excludes members without expiry_date', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');

        const currentYear = new Date().getFullYear();

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year)
             VALUES ('Carol', 'Hawk', 'carol@test.com', 'active', ?)`
        ).run(currentYear - 1);

        const members = await renewalService.findMembersNeedingRenewal();
        expect(members.length).toBe(0);
    });

    test('excludes family members (primary_member_id IS NOT NULL)', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');

        const currentYear = new Date().getFullYear();
        const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        // Insert primary
        const primary = testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year, expiry_date, membership_type)
             VALUES ('Dan', 'Hawk', 'dan@test.com', 'active', ?, ?, 'family') RETURNING id`
        ).get(currentYear - 1, expiryDate);

        // Insert family member
        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year, expiry_date, membership_type,
                                  primary_member_id)
             VALUES ('Eve', 'Hawk', 'eve@test.com', 'active', ?, ?, 'family', ?)`
        ).run(currentYear - 1, expiryDate, primary.id);

        const members = await renewalService.findMembersNeedingRenewal();
        expect(members.length).toBe(1);
        expect(members[0].email).toBe('dan@test.com');
    });

    test('excludes members with expiry beyond threshold', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');

        const currentYear = new Date().getFullYear();
        const farExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // 60 days

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year, expiry_date)
             VALUES ('Frank', 'Hawk', 'frank@test.com', 'active', ?, ?)`
        ).run(currentYear - 1, farExpiry);

        const members = await renewalService.findMembersNeedingRenewal();
        expect(members.length).toBe(0);
    });
});

describe('sendBulkRenewalReminders', () => {
    test('sends email for each eligible member and returns counts', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');

        const currentYear = new Date().getFullYear();
        const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year, expiry_date)
             VALUES ('Alice', 'Hawk', 'alice2@test.com', 'active', ?, ?)`
        ).run(currentYear - 1, expiryDate);
        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year, expiry_date)
             VALUES ('Bob', 'Hawk', 'bob2@test.com', 'active', ?, ?)`
        ).run(currentYear - 1, expiryDate);

        const result = await renewalService.sendBulkRenewalReminders('http://localhost:3000');

        expect(result.total).toBe(2);
        expect(result.sent).toBe(2);
        expect(result.failed).toBe(0);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('counts failures and does not throw', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');

        const currentYear = new Date().getFullYear();
        const expiryDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year, expiry_date)
             VALUES ('Grace', 'Hawk', 'grace@test.com', 'active', ?, ?)`
        ).run(currentYear - 1, expiryDate);

        global.fetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await renewalService.sendBulkRenewalReminders('http://localhost:3000');

        expect(result.total).toBe(1);
        expect(result.sent).toBe(0);
        expect(result.failed).toBe(1);
    });

    test('returns zero counts when no eligible members', async () => {
        const testDb = getTestDb();
        insertSetting(testDb, 'renewal_reminder_days_before', '30');

        const result = await renewalService.sendBulkRenewalReminders('http://localhost:3000');

        expect(result.total).toBe(0);
        expect(result.sent).toBe(0);
        expect(result.failed).toBe(0);
    });
});
