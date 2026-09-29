jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const familyDowngrade = require('../../services/familyDowngrade');
const archivedMembersRepo = require('../../db/repos/archivedMembers');
const memberRepo = require('../../db/repos/members');
const {insertMember, insertFamilyMembership, insertPeriod, enrollMember} = require('../helpers/fixtures');

beforeEach(() => {
    db.__resetTestDb();
});

function raw() {
    return db.__getCurrentDb();
}

function memberRow(id) {
    return raw().prepare('SELECT * FROM members WHERE id = ?').get(id);
}

function enrolledPeriods(memberId) {
    return raw().prepare('SELECT membership_period_id FROM membership_years WHERE member_id = ? ORDER BY membership_period_id')
        .all(memberId).map(r => r.membership_period_id);
}

// A primary with one sub-member who has their own email (Robin) and one who shares the
// primary's (Casey) — the two outcomes a downgrade has to handle.
function mixedHousehold() {
    const {primary, familyMembers} = insertFamilyMembership(raw(), {
        primaryMember: {
            email: 'pat@hawk.test', first_name: 'Pat', last_name: 'Hawk', status: 'active',
            phone: '4065550100', address_street: '1 Nest Rd', address_city: 'Billings', address_state: 'MT', address_zip: '59101',
        },
        familyMembers: [
            {first_name: 'Robin', last_name: 'Hawk', email: 'robin@hawk.test'},
            {first_name: 'Casey', last_name: 'Hawk', email: 'pat@hawk.test'},
        ],
    });
    const [robin, casey] = familyMembers;
    // buildMember fills in contact details; a real sub-member usually has none.
    raw().prepare(`UPDATE members SET phone = NULL, address_street = NULL, address_city = NULL,
                   address_state = NULL, address_zip = NULL WHERE primary_member_id = ?`).run(primary.id);
    raw().prepare("UPDATE members SET member_number = 'YSH-2019-0042', join_date = '2019-05-01' WHERE id = ?").run(casey.id);
    return {primary, robin, casey};
}

describe('downgradeToIndividual', () => {
    test('detaches the member with their own email and archives the one without', async () => {
        const past = insertPeriod(raw(), {label: '2024-25', start_date: '2024-04-01', end_date: '2025-07-31'});
        const current = insertPeriod(raw(), {label: '2025-26', start_date: '2025-04-01', end_date: '2099-07-31'});
        const {primary, robin, casey} = mixedHousehold();
        for (const id of [primary.id, robin.id]) enrollMember(raw(), id, current.id);
        enrollMember(raw(), casey.id, past.id);
        enrollMember(raw(), casey.id, current.id);

        const result = await familyDowngrade.downgradeToIndividual(primary.id);

        expect(result.detached.map(m => m.id)).toEqual([robin.id]);
        expect(result.archived.map(a => a.first_name)).toEqual(['Casey']);

        expect(memberRow(primary.id).membership_type).toBe('individual');

        // Robin: their own primary now, still a member for the season the household paid for.
        const robinNow = memberRow(robin.id);
        expect(robinNow).toMatchObject({membership_type: 'individual', primary_member_id: null, status: 'active'});
        expect(enrolledPeriods(robin.id)).toEqual([current.id]);

        // Casey: gone from members, kept in the archive with everything needed to come back.
        expect(memberRow(casey.id)).toBeUndefined();
        const [archived] = await archivedMembersRepo.search({lastName: 'Hawk'});
        expect(archived).toMatchObject({
            first_name: 'Casey',
            last_name: 'Hawk',
            join_date: '2019-05-01',
            member_numbers: ['YSH-2019-0042'],
            enrolled_period_ids: [past.id, current.id],
            former_member_id: casey.id,
            former_primary_member_id: primary.id,
        });
    });

    test("a detached member takes the primary's address and phone where their own are blank", async () => {
        const {primary, robin} = mixedHousehold();
        raw().prepare("UPDATE members SET address_city = 'Laurel' WHERE id = ?").run(robin.id);

        await familyDowngrade.downgradeToIndividual(primary.id);

        expect(memberRow(robin.id)).toMatchObject({
            phone: '4065550100',
            address_street: '1 Nest Rd',
            address_city: 'Laurel',
            address_state: 'MT',
            address_zip: '59101',
        });
    });

    test('writes audit rows for the archive, the delete, the detach and the type change', async () => {
        const {primary, robin, casey} = mixedHousehold();
        await familyDowngrade.downgradeToIndividual(primary.id);

        const audit = raw().prepare('SELECT table_name, record_id, action FROM audit_log ORDER BY id').all();
        expect(audit).toEqual(expect.arrayContaining([
            expect.objectContaining({table_name: 'archived_members', action: 'INSERT'}),
            {table_name: 'members', record_id: String(casey.id), action: 'DELETE'},
            {table_name: 'members', record_id: String(robin.id), action: 'UPDATE'},
            {table_name: 'members', record_id: String(primary.id), action: 'UPDATE'},
        ]));
    });

    test('a household with no family members just flips the type', async () => {
        const primary = insertMember(raw(), {email: 'solo@hawk.test', membership_type: 'family'});
        const result = await familyDowngrade.downgradeToIndividual(primary.id);
        expect(result).toMatchObject({detached: [], archived: []});
        expect(memberRow(primary.id).membership_type).toBe('individual');
    });

    test('two sub-members sharing an address of their own: the first detaches, the second is archived', async () => {
        const {primary, familyMembers} = insertFamilyMembership(raw(), {
            familyMembers: [
                {first_name: 'Ann', last_name: 'Twin', email: 'twins@hawk.test'},
                {first_name: 'Bea', last_name: 'Twin', email: 'twins@hawk.test'},
            ],
        });
        const result = await familyDowngrade.downgradeToIndividual(primary.id);
        expect(result.detached.map(m => m.id)).toEqual([familyMembers[0].id]);
        expect(result.archived.map(a => a.first_name)).toEqual(['Bea']);
    });

    test('refuses a sub-member', async () => {
        const {robin} = mixedHousehold();
        await expect(familyDowngrade.downgradeToIndividual(robin.id)).rejects.toThrow(/sub-member/);
    });

    test('refuses a member who is already individual', async () => {
        const m = insertMember(raw(), {email: 'ind@hawk.test'});
        await expect(familyDowngrade.downgradeToIndividual(m.id)).rejects.toThrow(/already an individual/);
    });

    test('refuses an unknown member', async () => {
        await expect(familyDowngrade.downgradeToIndividual(9999)).rejects.toThrow(/not found/);
    });

    test('a failure part-way through rolls the whole downgrade back', async () => {
        const {primary, robin, casey} = mixedHousehold();
        const spy = jest.spyOn(memberRepo, 'upgradeMembershipType').mockRejectedValueOnce(new Error('boom'));
        try {
            await expect(familyDowngrade.downgradeToIndividual(primary.id)).rejects.toThrow('boom');
        } finally {
            spy.mockRestore();
        }

        expect(memberRow(primary.id).membership_type).toBe('family');
        expect(memberRow(robin.id).primary_member_id).toBe(primary.id);
        expect(memberRow(casey.id)).toBeDefined();
        expect(await archivedMembersRepo.search({})).toEqual([]);
    });

    test('someone archived a second time keeps their earlier numbers and join date', async () => {
        const {primary, casey} = mixedHousehold();
        await familyDowngrade.downgradeToIndividual(primary.id);
        const [first] = await archivedMembersRepo.search({});

        // Back into a new household, given a new number because the old one was reissued.
        const newPrimary = insertMember(raw(), {email: 'new@hawk.test', membership_type: 'family'});
        insertMember(raw(), {email: 'thief@hawk.test', member_number: 'YSH-2019-0042'});
        const back = await familyDowngrade.reattachFromArchive(newPrimary.id, first.id);
        expect(back.member_number).not.toBe('YSH-2019-0042');
        expect(back.id).not.toBe(casey.id);

        await familyDowngrade.downgradeToIndividual(newPrimary.id);
        const [second] = await archivedMembersRepo.search({});
        expect(second.id).not.toBe(first.id);
        expect(second.member_numbers).toEqual(['YSH-2019-0042', back.member_number]);
        expect(second.join_date).toBe('2019-05-01');
    });
});

describe('restoreFromArchive', () => {
    async function archivedCasey() {
        const period = insertPeriod(raw(), {label: '2024-25', start_date: '2024-04-01', end_date: '2025-07-31'});
        const {primary, casey} = mixedHousehold();
        enrollMember(raw(), casey.id, period.id);
        await familyDowngrade.downgradeToIndividual(primary.id);
        const [row] = await archivedMembersRepo.search({});
        return {row, period};
    }

    test('creates a pending individual with the old number, join date and enrollments', async () => {
        const {row, period} = await archivedCasey();

        const member = await familyDowngrade.restoreFromArchive(row.id, {email: ' casey@hawk.test '});

        expect(member).toMatchObject({
            first_name: 'Casey',
            last_name: 'Hawk',
            email: 'casey@hawk.test',
            member_number: 'YSH-2019-0042',
            join_date: '2019-05-01',
            membership_type: 'individual',
            primary_member_id: null,
            status: 'pending',
        });
        expect(enrolledPeriods(member.id)).toEqual([period.id]);

        const after = await archivedMembersRepo.findById(row.id);
        expect(after.restored_member_id).toBe(member.id);
        expect(after.restored_at).toBeTruthy();
    });

    test('leaves out a period that is still open, so they do not count before they pay', async () => {
        const open = insertPeriod(raw(), {label: '2025-26', start_date: '2025-04-01', end_date: '2099-07-31'});
        const {row, period} = await archivedCasey();
        // archivedCasey enrolled Casey in the ended period only; add the open one to the snapshot.
        raw().prepare('UPDATE archived_members SET enrolled_period_ids = ? WHERE id = ?')
            .run(JSON.stringify([period.id, open.id]), row.id);

        const member = await familyDowngrade.restoreFromArchive(row.id, {email: 'casey@hawk.test'});
        expect(enrolledPeriods(member.id)).toEqual([period.id]);
    });

    test('generates a new number when the old one has been reissued', async () => {
        const {row} = await archivedCasey();
        insertMember(raw(), {email: 'other@hawk.test', member_number: 'YSH-2019-0042'});

        const member = await familyDowngrade.restoreFromArchive(row.id, {email: 'casey@hawk.test'});
        expect(member.member_number).toMatch(new RegExp(`^YSH-${new Date().getFullYear()}-\\d{4}$`));
    });

    test('skips periods deleted since the archive', async () => {
        const {row, period} = await archivedCasey();
        raw().prepare('DELETE FROM membership_periods WHERE id = ?').run(period.id);

        const member = await familyDowngrade.restoreFromArchive(row.id, {email: 'casey@hawk.test'});
        expect(enrolledPeriods(member.id)).toEqual([]);
    });

    test('refuses an email a primary member already holds', async () => {
        const {row} = await archivedCasey();
        await expect(familyDowngrade.restoreFromArchive(row.id, {email: 'pat@hawk.test'}))
            .rejects.toThrow(/already exists/);
        expect((await archivedMembersRepo.findById(row.id)).restored_at).toBeNull();
    });

    test('refuses a blank email', async () => {
        const {row} = await archivedCasey();
        await expect(familyDowngrade.restoreFromArchive(row.id, {email: '  '})).rejects.toThrow(/required/);
    });

    test('refuses someone already restored', async () => {
        const {row} = await archivedCasey();
        await familyDowngrade.restoreFromArchive(row.id, {email: 'casey@hawk.test'});
        await expect(familyDowngrade.restoreFromArchive(row.id, {email: 'casey2@hawk.test'}))
            .rejects.toThrow(/already been restored/);
    });
});

describe('reattachFromArchive', () => {
    test('adds them to the new household with their old number and join date', async () => {
        const {primary} = mixedHousehold();
        await familyDowngrade.downgradeToIndividual(primary.id);
        const [row] = await archivedMembersRepo.search({});
        const newPrimary = insertMember(raw(), {email: 'fam@hawk.test', membership_type: 'family'});

        const fm = await familyDowngrade.reattachFromArchive(newPrimary.id, row.id);

        expect(fm).toMatchObject({
            first_name: 'Casey',
            primary_member_id: newPrimary.id,
            membership_type: 'family',
            email: 'fam@hawk.test',
            member_number: 'YSH-2019-0042',
            join_date: '2019-05-01',
        });
        expect((await archivedMembersRepo.findById(row.id)).restored_member_id).toBe(fm.id);
    });

    test('re-enrolls ended periods only; the open one comes through the new primary', async () => {
        const past = insertPeriod(raw(), {label: '2024-25', start_date: '2024-04-01', end_date: '2025-07-31'});
        const current = insertPeriod(raw(), {label: '2025-26', start_date: '2025-04-01', end_date: '2099-07-31'});
        const {primary, casey} = mixedHousehold();
        enrollMember(raw(), casey.id, past.id);
        enrollMember(raw(), casey.id, current.id);
        await familyDowngrade.downgradeToIndividual(primary.id);
        const [row] = await archivedMembersRepo.search({});
        const newPrimary = insertMember(raw(), {email: 'fam@hawk.test', membership_type: 'family'});

        const fm = await familyDowngrade.reattachFromArchive(newPrimary.id, row.id);
        expect(enrolledPeriods(fm.id)).toEqual([past.id]);
    });

    test('refuses a primary that is not on a family membership', async () => {
        const {primary} = mixedHousehold();
        await familyDowngrade.downgradeToIndividual(primary.id);
        const [row] = await archivedMembersRepo.search({});
        await expect(familyDowngrade.reattachFromArchive(primary.id, row.id)).rejects.toThrow(/primary account holder/);
    });
});
