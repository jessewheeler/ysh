jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const archivedMembersRepo = require('../../db/repos/archivedMembers');
const {runWithActor} = require('../../db/audit-context');
const {insertAdmin, insertMember} = require('../helpers/fixtures');

beforeEach(() => {
    db.__resetTestDb();
});

function auditRows(recordId) {
    return db.__getCurrentDb().prepare(
        "SELECT * FROM audit_log WHERE table_name = 'archived_members' AND record_id = ? ORDER BY id"
    ).all(String(recordId));
}

describe('insert / findById', () => {
    test('round-trips the JSON arrays and writes an INSERT audit row with the actor', async () => {
        const admin = insertAdmin(db, {email: 'admin@ysh.test'});
        const row = await runWithActor({id: admin.id, email: admin.email}, () => archivedMembersRepo.insert({
            firstName: 'Casey',
            lastName: 'Hawk',
            joinDate: '2019-05-01',
            memberNumbers: ['YSH-2019-0042'],
            enrolledPeriodIds: [1, 2],
            formerMemberId: 99,
        }));

        expect(row.member_numbers).toEqual(['YSH-2019-0042']);
        expect(row.enrolled_period_ids).toEqual([1, 2]);

        const found = await archivedMembersRepo.findById(row.id);
        expect(found).toMatchObject({first_name: 'Casey', last_name: 'Hawk', join_date: '2019-05-01', former_member_id: 99});
        expect(found.restored_at).toBeNull();

        const audit = auditRows(row.id);
        expect(audit).toHaveLength(1);
        expect(audit[0].action).toBe('INSERT');
        expect(audit[0].actor_email).toBe('admin@ysh.test');
    });
});

describe('search', () => {
    beforeEach(async () => {
        await archivedMembersRepo.insert({firstName: 'Casey', lastName: 'Hawkins'});
        await archivedMembersRepo.insert({firstName: 'Robin', lastName: 'hawk'});
        await archivedMembersRepo.insert({firstName: 'Hawk', lastName: 'Smith'});
    });

    test('lastName is a case-insensitive prefix match on the last name only', async () => {
        const rows = await archivedMembersRepo.search({lastName: 'HAW'});
        expect(rows.map(r => r.first_name)).toEqual(['Robin', 'Casey']);
    });

    test('q matches a prefix of either name', async () => {
        const rows = await archivedMembersRepo.search({q: 'hawk'});
        expect(rows.map(r => r.first_name).sort()).toEqual(['Casey', 'Hawk', 'Robin']);
    });

    test('leaves out restored people', async () => {
        const [robin] = await archivedMembersRepo.search({lastName: 'hawk'});
        const member = insertMember(db, {email: 'robin@ysh.test'});
        await archivedMembersRepo.markRestored(robin.id, member.id);

        const rows = await archivedMembersRepo.search({lastName: 'hawk'});
        expect(rows.map(r => r.first_name)).toEqual(['Casey']);
    });

    test('respects the limit', async () => {
        expect(await archivedMembersRepo.search({limit: 2})).toHaveLength(2);
    });
});

describe('markRestored / findRestoredAs', () => {
    test('stamps the restore, audits the UPDATE and links back from the member', async () => {
        const row = await archivedMembersRepo.insert({firstName: 'Casey', lastName: 'Hawk'});
        const member = insertMember(db, {email: 'casey@ysh.test'});

        const restored = await archivedMembersRepo.markRestored(row.id, member.id);
        expect(restored.restored_at).toBeTruthy();
        expect(restored.restored_member_id).toBe(member.id);

        expect(auditRows(row.id).map(a => a.action)).toEqual(['INSERT', 'UPDATE']);
        expect((await archivedMembersRepo.findRestoredAs(member.id)).id).toBe(row.id);
    });

    test('findRestoredAs is empty for someone never archived', async () => {
        const member = insertMember(db, {email: 'new@ysh.test'});
        expect(await archivedMembersRepo.findRestoredAs(member.id)).toBeUndefined();
    });
});
