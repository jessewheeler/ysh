jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const donationRepo = require('../../db/repos/donations');
const {insertMember, insertDonation} = require('../helpers/fixtures');

beforeEach(() => {
    db.__resetTestDb();
});

describe('create', () => {
    test('inserts a donation and returns result', async () => {
        const result = await donationRepo.create({
            donor_name: 'Jane Donor',
            donor_email: 'jane@example.com',
            stripe_session_id: 'cs_test_abc',
            amount_cents: 5000,
            currency: 'usd',
            status: 'pending',
        });
        expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
    });
});

describe('findBySessionId', () => {
    test('returns donation when session exists', async () => {
        const testDb = db.__getCurrentDb();
        insertDonation(testDb, {stripe_session_id: 'cs_test_123', status: 'pending'});
        const row = await donationRepo.findBySessionId('cs_test_123');
        expect(row).not.toBeNull();
        expect(row.stripe_session_id).toBe('cs_test_123');
    });

    test('returns undefined when session does not exist', async () => {
        const row = await donationRepo.findBySessionId('cs_test_notfound');
        expect(row).toBeUndefined();
    });
});

describe('complete', () => {
    test('marks donation as completed and returns true on first completion', async () => {
        const testDb = db.__getCurrentDb();
        insertDonation(testDb, {stripe_session_id: 'cs_test_abc', status: 'pending'});

        const result = await donationRepo.complete('cs_test_abc', {paymentIntent: 'pi_123', memberId: null});
        expect(result).toBe(true);

        const row = await donationRepo.findBySessionId('cs_test_abc');
        expect(row.status).toBe('completed');
        expect(row.stripe_payment_intent).toBe('pi_123');
    });

    test('returns false when donation is already completed (idempotency)', async () => {
        const testDb = db.__getCurrentDb();
        insertDonation(testDb, {stripe_session_id: 'cs_test_abc', status: 'completed'});

        const result = await donationRepo.complete('cs_test_abc', {paymentIntent: 'pi_123', memberId: null});
        expect(result).toBe(false);
    });

    test('stores member_id when passed', async () => {
        const testDb = db.__getCurrentDb();
        const member = insertMember(testDb, {email: 'member@example.com'});
        insertDonation(testDb, {stripe_session_id: 'cs_test_abc', status: 'pending'});

        await donationRepo.complete('cs_test_abc', {paymentIntent: 'pi_123', memberId: member.id});

        const row = await donationRepo.findBySessionId('cs_test_abc');
        expect(row.member_id).toBe(member.id);
    });
});

describe('findByMemberId', () => {
    test('returns donations linked to a member', async () => {
        const testDb = db.__getCurrentDb();
        const member = insertMember(testDb, {email: 'member@example.com'});
        insertDonation(testDb, {member_id: member.id});
        insertDonation(testDb, {member_id: member.id, amount_cents: 10000});
        const donations = await donationRepo.findByMemberId(member.id);
        expect(donations).toHaveLength(2);
    });

    test('returns empty array when no linked donations', async () => {
        const testDb = db.__getCurrentDb();
        const member = insertMember(testDb, {email: 'member@example.com'});
        const donations = await donationRepo.findByMemberId(member.id);
        expect(donations).toHaveLength(0);
    });
});

describe('listWithDonors / countAll', () => {
    test('returns paginated donations and total', async () => {
        const testDb = db.__getCurrentDb();
        insertDonation(testDb, {donor_name: 'Alice'});
        insertDonation(testDb, {donor_name: 'Bob', donor_email: 'bob@example.com'});

        const result = await donationRepo.listWithDonors({limit: 25, offset: 0});
        expect(result.total).toBe(2);
        expect(result.donations).toHaveLength(2);
    });

    test('countAll returns correct count', async () => {
        const testDb = db.__getCurrentDb();
        insertDonation(testDb);
        insertDonation(testDb, {donor_email: 'other@example.com'});
        expect(await donationRepo.countAll()).toBe(2);
    });
});

describe('sumCompletedCents', () => {
    test('sums only completed donations', async () => {
        const testDb = db.__getCurrentDb();
        insertDonation(testDb, {amount_cents: 5000, status: 'completed'});
        insertDonation(testDb, {amount_cents: 2500, status: 'pending', donor_email: 'b@example.com'});
        expect(await donationRepo.sumCompletedCents()).toBe(5000);
    });
});
