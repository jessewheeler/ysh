jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const {insertMember} = require('../helpers/fixtures');
const membersRepo = require('../../db/repos/members');

beforeEach(() => {
    db.__resetTestDb();
});

function getTestDb() {
    return db.__getCurrentDb();
}

describe('GET /renew/:token — token validation (via repo)', () => {
    test('findByRenewalToken returns member with valid token', async () => {
        const testDb = getTestDb();
        const member = insertMember(testDb, {email: 'renew@test.com', status: 'active'});

        // Set a valid token with future expiry
        const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
        testDb.prepare(
            'UPDATE members SET renewal_token = ?, renewal_token_expires_at = ? WHERE id = ?'
        ).run('validtoken123', futureDate, member.id);

        const found = await membersRepo.findByRenewalToken('validtoken123');
        expect(found).toBeDefined();
        expect(found.email).toBe('renew@test.com');
    });

    test('findByRenewalToken returns undefined for expired token', async () => {
        const testDb = getTestDb();
        const member = insertMember(testDb, {email: 'expired@test.com', status: 'active'});

        // Set an expired token
        const pastDate = new Date(Date.now() - 1000).toISOString();
        testDb.prepare(
            'UPDATE members SET renewal_token = ?, renewal_token_expires_at = ? WHERE id = ?'
        ).run('expiredtoken456', pastDate, member.id);

        const found = await membersRepo.findByRenewalToken('expiredtoken456');
        expect(found).toBeUndefined();
    });

    test('findByRenewalToken returns undefined for unknown token', async () => {
        const found = await membersRepo.findByRenewalToken('nonexistenttoken');
        expect(found).toBeUndefined();
    });
});

describe('POST /renew/:token — member update and token lifecycle', () => {
    test('setRenewalToken stores token with future expiry', async () => {
        const testDb = getTestDb();
        const member = insertMember(testDb, {email: 'settoken@test.com', status: 'active'});

        const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
        await membersRepo.setRenewalToken(member.id, 'mytoken789', expiresAt);

        const updated = testDb.prepare('SELECT renewal_token, renewal_token_expires_at FROM members WHERE id = ?').get(member.id);
        expect(updated.renewal_token).toBe('mytoken789');
        expect(updated.renewal_token_expires_at).toBe(expiresAt);
    });

    test('clearRenewalToken nulls token fields', async () => {
        const testDb = getTestDb();
        const member = insertMember(testDb, {email: 'clear@test.com', status: 'active'});

        const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
        testDb.prepare(
            'UPDATE members SET renewal_token = ?, renewal_token_expires_at = ? WHERE id = ?'
        ).run('sometoken', expiresAt, member.id);

        await membersRepo.clearRenewalToken(member.id);

        const updated = testDb.prepare('SELECT renewal_token, renewal_token_expires_at FROM members WHERE id = ?').get(member.id);
        expect(updated.renewal_token).toBeNull();
        expect(updated.renewal_token_expires_at).toBeNull();
    });

    test('setExpiryDate updates expiry_date on member', async () => {
        const testDb = getTestDb();
        const member = insertMember(testDb, {email: 'expiry@test.com', status: 'active'});

        await membersRepo.setExpiryDate(member.id, '2026-08-01');

        const updated = testDb.prepare('SELECT expiry_date FROM members WHERE id = ?').get(member.id);
        expect(updated.expiry_date).toBe('2026-08-01');
    });

    test('renewal token is invalidated after clearRenewalToken', async () => {
        const testDb = getTestDb();
        const member = insertMember(testDb, {email: 'cycle@test.com', status: 'active'});

        const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
        await membersRepo.setRenewalToken(member.id, 'cycletoken', expiresAt);

        // Verify token is found
        const found = await membersRepo.findByRenewalToken('cycletoken');
        expect(found).toBeDefined();

        // Clear it
        await membersRepo.clearRenewalToken(member.id);

        // Verify token is no longer found
        const notFound = await membersRepo.findByRenewalToken('cycletoken');
        expect(notFound).toBeUndefined();
    });
});

describe('findNeedingRenewal', () => {
    test('returns active member with expiry in range from previous year', async () => {
        const testDb = getTestDb();
        const currentYear = new Date().getFullYear();
        const expiryDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year, expiry_date)
             VALUES ('Hank', 'Hawk', 'hank@test.com', 'active', ?, ?)`
        ).run(currentYear - 1, expiryDate);

        const members = await membersRepo.findNeedingRenewal(currentYear, 30);
        expect(members.length).toBe(1);
        expect(members[0].email).toBe('hank@test.com');
    });

    test('returns expired members too', async () => {
        const testDb = getTestDb();
        const currentYear = new Date().getFullYear();
        const expiryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year, expiry_date)
             VALUES ('Iris', 'Hawk', 'iris@test.com', 'expired', ?, ?)`
        ).run(currentYear - 1, expiryDate);

        const members = await membersRepo.findNeedingRenewal(currentYear, 30);
        expect(members.length).toBe(1);
        expect(members[0].email).toBe('iris@test.com');
    });

    test('excludes pending members', async () => {
        const testDb = getTestDb();
        const currentYear = new Date().getFullYear();
        const expiryDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        testDb.prepare(
            `INSERT INTO members (first_name, last_name, email, status, membership_year, expiry_date)
             VALUES ('Jack', 'Hawk', 'jack@test.com', 'pending', ?, ?)`
        ).run(currentYear - 1, expiryDate);

        const members = await membersRepo.findNeedingRenewal(currentYear, 30);
        expect(members.length).toBe(0);
    });
});
