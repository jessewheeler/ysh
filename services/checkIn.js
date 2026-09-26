const memberRepo = require('../db/repos/members');
const eventsRepo = require('../db/repos/events');
const periodsRepo = require('../db/repos/membershipPeriods');
const membershipYearsRepo = require('../db/repos/membershipYears');
const checkInsRepo = require('../db/repos/checkIns');

const DEFAULT_TICKETS = 1;
const MAX_TICKETS = 10;

/**
 * The season an event counts toward: the one it was filed under, else whichever period
 * its date falls in. Null when no period covers it.
 */
async function periodForEvent(event) {
  if (event.membership_period_id) {
    const period = await periodsRepo.get(event.membership_period_id);
    if (period) return period;
  }
  return periodsRepo.getCurrent(event.event_date);
}

/**
 * Whether a member is paid up for the event's season. Tested on enrollment, not
 * members.status, which lags reality between expiry runs. A family sub-member counts
 * through their primary (older backfills only enrolled primaries — see
 * membershipYears.listMembersByPeriod), and lifetime members always count.
 */
async function isEnrolledFor(member, primary, period) {
  if (member.is_lifetime || primary.is_lifetime) return true;
  if (!period) return false;
  if (await membershipYearsRepo.isEnrolled(member.id, period.id)) return true;
  return member.id !== primary.id && membershipYearsRepo.isEnrolled(primary.id, period.id);
}

/**
 * Everything the household check-in screen needs, from any member id in the household.
 * Returns null when the event or member doesn't exist.
 */
async function householdForCheckIn(eventId, memberId) {
  const event = await eventsRepo.get(eventId);
  if (!event) return null;
  const household = await memberRepo.findHousehold(memberId);
  if (!household) return null;

  const period = await periodForEvent(event);
  const existing = await checkInsRepo.findForMembers(event.id, household.members.map(m => m.id));
  const people = [];
  for (const member of household.members) {
    people.push({
      member,
      isPrimary: member.id === household.primary.id,
      enrolled: await isEnrolledFor(member, household.primary, period),
      checkIn: existing.get(Number(member.id)) || null,
    });
  }
  return { event, period, primary: household.primary, people };
}

function clampTickets(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_TICKETS);
}

/**
 * Apply the household form. `form` is the request body: `present_<memberId>` is set for
 * each ticked person and `tickets_<memberId>` holds their count.
 *
 * Only ids in this household are read, so a tampered POST can't check in anyone else.
 * Anyone not enrolled gets 0 tickets whatever the form says, and unticking someone who
 * was already checked in removes their check-in.
 *
 * Returns {checkedIn, removed, tickets} or null when the event or member doesn't exist.
 */
async function recordHousehold(eventId, memberId, form = {}) {
  const ctx = await householdForCheckIn(eventId, memberId);
  if (!ctx) return null;

  const result = { checkedIn: [], removed: [], tickets: 0 };
  for (const person of ctx.people) {
    const id = person.member.id;
    const present = Boolean(form[`present_${id}`]);
    if (!present) {
      if (person.checkIn && await checkInsRepo.remove(ctx.event.id, id)) result.removed.push(person.member);
      continue;
    }
    const raw = form[`tickets_${id}`];
    const tickets = person.enrolled
      ? (raw === undefined || raw === '' ? DEFAULT_TICKETS : clampTickets(raw))
      : 0;
    await checkInsRepo.upsert({ eventId: ctx.event.id, memberId: id, tickets, enrolled: person.enrolled });
    result.checkedIn.push(person.member);
    result.tickets += tickets;
  }
  return result;
}

module.exports = {
  DEFAULT_TICKETS,
  MAX_TICKETS,
  periodForEvent,
  householdForCheckIn,
  recordHousehold,
};
