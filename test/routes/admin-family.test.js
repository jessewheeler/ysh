jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const {insertMember, insertFamilyMembership} = require('../helpers/fixtures');
const memberRepo = require('../../db/repos/members');

beforeEach(() => {
    db.__resetTestDb();
});

describe('upgradeMembershipType', () => {
    test('changes individual member to family type', async () => {
        const testDb = db.__getCurrentDb();
        const member = insertMember(testDb, {email: 'upgrade@test.com', membership_type: 'individual'});

        await memberRepo.upgradeMembershipType(member.id, 'family');

        const updated = testDb.prepare('SELECT * FROM members WHERE id = ?').get(member.id);
        expect(updated.membership_type).toBe('family');
    });

    test('does not affect other fields', async () => {
        const testDb = db.__getCurrentDb();
        const member = insertMember(testDb, {email: 'upgrade2@test.com', status: 'active'});

        await memberRepo.upgradeMembershipType(member.id, 'family');

        const updated = testDb.prepare('SELECT * FROM members WHERE id = ?').get(member.id);
        expect(updated.status).toBe('active');
        expect(updated.email).toBe('upgrade2@test.com');
        expect(updated.first_name).toBe(member.first_name);
    });
});

describe('detachFamilyMember', () => {
    test('clears primary_member_id, sets membership_type to individual, and cancels status', async () => {
        const testDb = db.__getCurrentDb();
        const {familyMembers} = insertFamilyMembership(testDb);
        const fm = familyMembers[0];

        await memberRepo.detachFamilyMember(fm.id);

        const updated = testDb.prepare('SELECT * FROM members WHERE id = ?').get(fm.id);
        expect(updated.primary_member_id).toBeNull();
        expect(updated.membership_type).toBe('individual');
        expect(updated.status).toBe('cancelled');
    });

    test('does not affect the primary member', async () => {
        const testDb = db.__getCurrentDb();
        const {primary, familyMembers} = insertFamilyMembership(testDb);

        await memberRepo.detachFamilyMember(familyMembers[0].id);

        const primaryAfter = testDb.prepare('SELECT * FROM members WHERE id = ?').get(primary.id);
        expect(primaryAfter.membership_type).toBe('family');
        expect(primaryAfter.primary_member_id).toBeNull();
    });

    test('remaining family members are unchanged', async () => {
        const testDb = db.__getCurrentDb();
        const {primary, familyMembers} = insertFamilyMembership(testDb);

        await memberRepo.detachFamilyMember(familyMembers[0].id);

        const remaining = testDb.prepare('SELECT * FROM members WHERE id = ?').get(familyMembers[1].id);
        expect(remaining.primary_member_id).toBe(primary.id);
        expect(remaining.membership_type).toBe('family');
    });
});

describe('addFamilyMember', () => {
    test('inserts a new family member linked to primary with active status', async () => {
        const testDb = db.__getCurrentDb();
        const primary = insertMember(testDb, {email: 'primary@test.com', membership_type: 'family'});

        await memberRepo.addFamilyMember(primary.id, {
            first_name: 'Alex',
            last_name: 'Smith',
            email: 'alex@test.com',
            membership_year: primary.membership_year,
        });

        const added = testDb.prepare("SELECT * FROM members WHERE email = 'alex@test.com'").get();
        expect(added).toBeDefined();
        expect(added.first_name).toBe('Alex');
        expect(added.primary_member_id).toBe(primary.id);
        expect(added.membership_type).toBe('family');
        expect(added.status).toBe('active');
    });

    test('assigns a member number to the new family member', async () => {
        const testDb = db.__getCurrentDb();
        const primary = insertMember(testDb, {email: 'prim2@test.com', membership_type: 'family'});

        await memberRepo.addFamilyMember(primary.id, {
            first_name: 'Sam',
            last_name: 'Jones',
            email: 'sam@test.com',
            membership_year: primary.membership_year,
        });

        const added = testDb.prepare("SELECT * FROM members WHERE first_name = 'Sam' AND last_name = 'Jones'").get();
        expect(added.member_number).toBeTruthy();
    });
});

describe('findFamilyMembers', () => {
    test('returns all family members for a primary', async () => {
        const testDb = db.__getCurrentDb();
        const {primary, familyMembers} = insertFamilyMembership(testDb);

        const result = await memberRepo.findFamilyMembers(primary.id);

        expect(result.length).toBe(familyMembers.length);
        expect(result.map(fm => fm.id).sort()).toEqual(familyMembers.map(fm => fm.id).sort());
    });

    test('returns empty array when no family members', async () => {
        const testDb = db.__getCurrentDb();
        const member = insertMember(testDb, {email: 'solo@test.com'});

        const result = await memberRepo.findFamilyMembers(member.id);

        expect(result).toEqual([]);
    });
});
