const db = require('../db/database');
const memberRepo = require('../db/repos/members');
const membershipYearsRepo = require('../db/repos/membershipYears');
const archivedMembersRepo = require('../db/repos/archivedMembers');
const periodsRepo = require('../db/repos/membershipPeriods');
const {generateMemberNumber} = require('./members');

// Downgrading a family membership to individual, and the archive that holds the family
// members it leaves behind (issue #107). This file is the only place that sequence lives.
//
// Each sub-member is either:
//   - detached: they have an email of their own, so they become an individual member with
//     the primary's status, address and phone (where their own are blank), and keep their
//     enrollment for the season the household paid for;
//   - archived: their email is the primary's (members.email is NOT NULL, so the add-family
//     forms copy it in when none is given). A second primary can't hold that address —
//     idx_members_email_primary — so their members row is deleted and an archived_members
//     row keeps their name, join date, member numbers and enrolled periods.
//
// The split is memberRepo.emailConflictsWithPrimary, the same test the single Remove button
// and the member page's confirm text use.

async function shouldArchive(familyMember) {
    return memberRepo.emailConflictsWithPrimary(familyMember.email, familyMember.id);
}

async function downgradeToIndividual(primaryId) {
    const primary = await memberRepo.findById(primaryId);
    if (!primary) throw new Error('Member not found.');
    if (primary.primary_member_id) {
        throw new Error('Cannot downgrade a family sub-member — downgrade the primary account holder.');
    }
    if (primary.membership_type !== 'family') {
        throw new Error('Membership is already an individual type.');
    }

    return db.transaction(async () => {
        const detached = [];
        const archived = [];
        const familyMembers = await memberRepo.findFamilyMembers(primary.id);

        for (const fm of familyMembers) {
            // Decided one at a time, not up front: two sub-members sharing an email of their
            // own can't both become primaries, and the second one sees the first's detach.
            if (await shouldArchive(fm)) {
                archived.push(await archiveFamilyMember(fm, primary));
            } else {
                // Sub-members rarely have an address of their own — the Council report
                // borrows the primary's through primary_member_id, which a detach severs.
                // Carry the primary's contact details over wherever theirs is blank.
                await memberRepo.detachFamilyMember(fm.id, {status: primary.status, contactFrom: primary});
                detached.push(fm);
            }
        }

        await memberRepo.upgradeMembershipType(primary.id, 'individual');
        return {primary, detached, archived};
    });
}

async function archiveFamilyMember(fm, primary) {
    const enrollments = await membershipYearsRepo.findByMember(fm.id);
    // Someone restored before and now archived again keeps their earlier numbers and
    // original join date.
    const previous = await archivedMembersRepo.findRestoredAs(fm.id);
    const memberNumbers = [...(previous ? previous.member_numbers : [])];
    if (fm.member_number && !memberNumbers.includes(fm.member_number)) {
        memberNumbers.push(fm.member_number);
    }
    const periodIds = new Set(previous ? previous.enrolled_period_ids : []);
    for (const e of enrollments) periodIds.add(e.membership_period_id);

    // Insert before delete: members.primary_member_id is ON DELETE CASCADE, and the
    // members row is the only copy of what this row keeps.
    const row = await archivedMembersRepo.insert({
        firstName: fm.first_name,
        lastName: fm.last_name,
        joinDate: (previous && previous.join_date) || fm.join_date,
        memberNumbers,
        enrolledPeriodIds: [...periodIds].sort((a, b) => a - b),
        formerMemberId: fm.id,
        formerPrimaryMemberId: primary.id,
    });
    await memberRepo.deleteById(fm.id);
    return row;
}

// The most recent number they held, unless someone else has been issued it since.
async function numberForReturningMember(archivedRow, year) {
    const latest = archivedRow.member_numbers[archivedRow.member_numbers.length - 1];
    if (latest && !(await memberRepo.findByMemberNumber(latest))) return latest;
    return generateMemberNumber(year);
}

// Puts back enrollments for seasons that have ended, so past Council reports read as they
// did before the archive. A period still open is left out: a restored person hasn't paid
// for it as an individual, and counting them before they do would inflate this season's
// report. They get it when a payment activates them (services/activation.js), or through
// the primary's enrollment when reattached to a household.
async function reEnroll(memberId, periodIds, today = new Date().toISOString().slice(0, 10)) {
    for (const periodId of periodIds) {
        const period = await periodsRepo.get(periodId);
        // Deleted since they were archived: nothing to enroll in.
        if (!period) continue;
        if (String(period.end_date).slice(0, 10) >= today) continue;
        await membershipYearsRepo.enroll(memberId, periodId, null);
    }
}

async function loadRestorable(archivedId) {
    const row = await archivedMembersRepo.findById(archivedId);
    if (!row) throw new Error('Archived member not found.');
    if (row.restored_at) throw new Error(`${row.first_name} ${row.last_name} has already been restored.`);
    return row;
}

// Brings an archived person back as a pending individual member. Nothing is activated or
// mailed here — the admin records the payment on the new member's page (offline) or sends a
// renewal link (Stripe), and activation happens there as it does for anyone else.
async function restoreFromArchive(archivedId, {email}) {
    const address = (email || '').trim();
    if (!address) throw new Error('An email address is required to restore a member.');
    const row = await loadRestorable(archivedId);
    if (await memberRepo.emailConflictsWithPrimary(address, 0)) {
        throw new Error('A member with that email already exists.');
    }

    return db.transaction(async () => {
        const year = new Date().getFullYear();
        const created = await memberRepo.create({
            member_number: await numberForReturningMember(row, year),
            first_name: row.first_name,
            last_name: row.last_name,
            email: address,
            membership_year: year,
            join_date: row.join_date,
            status: 'pending',
        });
        const memberId = created.lastInsertRowid;
        await reEnroll(memberId, row.enrolled_period_ids);
        await archivedMembersRepo.markRestored(row.id, memberId);
        return memberRepo.findById(memberId);
    });
}

// Puts an archived person back into a household, keeping their number and join date.
async function reattachFromArchive(primaryId, archivedId, {email} = {}) {
    const primary = await memberRepo.findById(primaryId);
    if (!primary || primary.membership_type !== 'family' || primary.primary_member_id) {
        throw new Error('Only the primary account holder of a family membership can have family members added.');
    }
    const row = await loadRestorable(archivedId);

    return db.transaction(async () => {
        const year = primary.membership_year || new Date().getFullYear();
        const created = await memberRepo.addFamilyMember(primary.id, {
            first_name: row.first_name,
            last_name: row.last_name,
            email: (email || '').trim() || primary.email,
            membership_year: year,
            member_number: await numberForReturningMember(row, year),
            join_date: row.join_date,
        });
        const memberId = created.lastInsertRowid;
        await reEnroll(memberId, row.enrolled_period_ids);
        await archivedMembersRepo.markRestored(row.id, memberId);
        return memberRepo.findById(memberId);
    });
}

module.exports = {
    shouldArchive,
    downgradeToIndividual,
    restoreFromArchive,
    reattachFromArchive,
};
