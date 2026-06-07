jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const donationRepo = require('../../db/repos/donations');
const memberRepo = require('../../db/repos/members');
const {validateDonation} = require('../../services/donations');
const {insertMember, insertDonation} = require('../helpers/fixtures');

beforeEach(() => {
    db.__resetTestDb();
});

// --- POST /donate validation ---
// Exercises the real validateDonation() that the route calls, so the test cannot
// drift from the route's actual behaviour.

const VALID = {donor_name: 'Jane', donor_email: 'jane@example.com'};

describe('validateDonation: donor fields', () => {
    test('rejects missing name', () => {
        expect(validateDonation({donor_email: 'jane@example.com', amount_preset: '2500'}).error).toBeDefined();
    });

    test('rejects missing email', () => {
        expect(validateDonation({donor_name: 'Jane', amount_preset: '2500'}).error).toBeDefined();
    });

    test('rejects malformed email', () => {
        expect(validateDonation({...VALID, donor_email: 'not-an-email', amount_preset: '2500'}).error)
            .toBe('Please enter a valid email address.');
    });

    test('accepts a well-formed email', () => {
        expect(validateDonation({...VALID, amount_preset: '2500'}).amountCents).toBe(2500);
    });
});

describe('validateDonation: amount', () => {
    test('rejects missing amount_preset', () => {
        expect(validateDonation({...VALID}).error).toBeDefined();
    });

    test('rejects unknown preset value', () => {
        expect(validateDonation({...VALID, amount_preset: '999'}).error).toBeDefined();
    });

    test('accepts valid preset amounts', () => {
        expect(validateDonation({...VALID, amount_preset: '2500'}).amountCents).toBe(2500);
        expect(validateDonation({...VALID, amount_preset: '5000'}).amountCents).toBe(5000);
        expect(validateDonation({...VALID, amount_preset: '10000'}).amountCents).toBe(10000);
        expect(validateDonation({...VALID, amount_preset: '25000'}).amountCents).toBe(25000);
    });

    test('accepts custom amount >= $1', () => {
        expect(validateDonation({...VALID, amount_preset: 'custom', amount_custom: '15.50'}).amountCents).toBe(1550);
    });

    test('rejects custom amount below $1', () => {
        expect(validateDonation({...VALID, amount_preset: 'custom', amount_custom: '0.50'}).error).toBeDefined();
    });

    test('rejects custom amount of 0', () => {
        expect(validateDonation({...VALID, amount_preset: 'custom', amount_custom: '0'}).error).toBeDefined();
    });

    test('rejects non-numeric custom amount', () => {
        expect(validateDonation({...VALID, amount_preset: 'custom', amount_custom: 'abc'}).error).toBeDefined();
    });
});

// --- Webhook donation branch ---

describe('webhook: donation completion', () => {
    test('first completion returns true and marks row as completed', async () => {
        const testDb = db.__getCurrentDb();
        insertDonation(testDb, {stripe_session_id: 'cs_donate_1', status: 'pending'});

        const first = await donationRepo.complete('cs_donate_1', {paymentIntent: 'pi_abc', memberId: null});
        expect(first).toBe(true);

        const row = await donationRepo.findBySessionId('cs_donate_1');
        expect(row.status).toBe('completed');
        expect(row.stripe_payment_intent).toBe('pi_abc');
    });

    test('second completion (webhook retry) returns false — no duplicate email', async () => {
        const testDb = db.__getCurrentDb();
        insertDonation(testDb, {stripe_session_id: 'cs_donate_2', status: 'completed'});

        const second = await donationRepo.complete('cs_donate_2', {paymentIntent: 'pi_abc', memberId: null});
        expect(second).toBe(false);
    });

    test('soft-link: complete stores member_id when donor email matches a member', async () => {
        const testDb = db.__getCurrentDb();
        const member = insertMember(testDb, {email: 'donor@member.com'});
        insertDonation(testDb, {stripe_session_id: 'cs_donate_3', status: 'pending', donor_email: 'donor@member.com'});

        const found = await memberRepo.findByEmail('donor@member.com');
        const memberId = found ? found.id : null;

        await donationRepo.complete('cs_donate_3', {paymentIntent: 'pi_xyz', memberId});

        const row = await donationRepo.findBySessionId('cs_donate_3');
        expect(row.member_id).toBe(member.id);
    });

    test('soft-link: member_id is null when donor email has no matching member', async () => {
        const testDb = db.__getCurrentDb();
        insertDonation(testDb, {
            stripe_session_id: 'cs_donate_4',
            status: 'pending',
            donor_email: 'nomatch@example.com'
        });

        const found = await memberRepo.findByEmail('nomatch@example.com');
        const memberId = found ? found.id : null;
        expect(memberId).toBeNull();

        await donationRepo.complete('cs_donate_4', {paymentIntent: 'pi_xyz', memberId: null});

        const row = await donationRepo.findBySessionId('cs_donate_4');
        expect(row.member_id).toBeNull();
    });

    test('fallback: completes by donation_id when session id never attached', async () => {
        const testDb = db.__getCurrentDb();
        // attachSession failed → row has no session id, only the metadata donation_id handle.
        const d = insertDonation(testDb, {stripe_session_id: null, status: 'pending'});

        const ok = await donationRepo.complete('cs_late_attach', {
            paymentIntent: 'pi_late',
            memberId: null,
            donationId: d.id,
        });
        expect(ok).toBe(true);

        // Completing also backfills the session id from the webhook.
        const row = await donationRepo.findBySessionId('cs_late_attach');
        expect(row.id).toBe(d.id);
        expect(row.status).toBe('completed');
    });
});

// --- Pending-row-first creation flow ---

describe('createDonationCheckoutSession persistence order', () => {
    test('create returns an id usable as the metadata handle, attachSession links the session', async () => {
        const {lastInsertRowid} = await donationRepo.create({
            donor_name: 'Jane',
            donor_email: 'jane@example.com',
            stripe_session_id: null,
            amount_cents: 5000,
            currency: 'usd',
            status: 'pending',
        });
        expect(Number(lastInsertRowid)).toBeGreaterThan(0);

        await donationRepo.attachSession(lastInsertRowid, 'cs_attached_1');
        const row = await donationRepo.findBySessionId('cs_attached_1');
        expect(row.id).toBe(Number(lastInsertRowid));
        expect(row.status).toBe('pending');
    });
});

// --- Admin: donations list ---

describe('admin donations list', () => {
    test('listWithDonors returns all donations', async () => {
        const testDb = db.__getCurrentDb();
        insertDonation(testDb, {donor_name: 'Alice', amount_cents: 2500});
        insertDonation(testDb, {donor_name: 'Bob', donor_email: 'bob@example.com', amount_cents: 5000});

        const {donations, total} = await donationRepo.listWithDonors({limit: 25, offset: 0});
        expect(total).toBe(2);
        expect(donations.map(d => d.donor_name)).toContain('Alice');
        expect(donations.map(d => d.donor_name)).toContain('Bob');
    });

    test('member detail includes linked donations', async () => {
        const testDb = db.__getCurrentDb();
        const member = insertMember(testDb, {email: 'linked@example.com'});
        insertDonation(testDb, {member_id: member.id, amount_cents: 10000, status: 'completed'});

        const donations = await donationRepo.findByMemberId(member.id);
        expect(donations).toHaveLength(1);
        expect(donations[0].amount_cents).toBe(10000);
    });
});
