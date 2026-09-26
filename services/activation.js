const memberRepo = require('../db/repos/members');
const membershipYearsRepo = require('../db/repos/membershipYears');
const logger = require('./logger');

/**
 * Activating a member for a membership period — the one place it happens.
 *
 * Stripe checkout, the admin offline-payment form, admin member create/edit and the
 * repair script all land here, so a manually recorded payment leaves exactly the same
 * member state as a card payment. Before this existed the sequence was copy-pasted into
 * each route and the admin copy skipped family members and the membership year whenever
 * the member was already active.
 *
 * Returns the rows re-fetched *after* the writes, so callers rendering cards or emails
 * see the new membership_year and expiry_date rather than the stale ones.
 *
 * With no open period the status still flips but nothing is stamped, and `period` comes
 * back null so the caller can warn rather than leave a half-activated member unremarked.
 */
async function activateForPeriod({
  memberId,
  period,
  paymentId = null,
  clearRenewalToken = true,
  membershipYear = null,
}) {
  // A payment recorded against a family sub-member is still a payment for the whole
  // family, so always work from the account holder down.
  const household = await memberRepo.findHousehold(memberId);
  if (!household) return { period: period || null, primary: null, members: [] };
  const { primary } = household;
  const ids = household.members.map(m => m.id);

  // membershipYear lets the admin forms keep the year the admin typed; everywhere else it
  // comes from the period, which is the authoritative source. Sliced off the string rather
  // than read through `new Date(...)`, which parses a bare YYYY-MM-DD as UTC midnight and
  // so reports the previous year west of Greenwich (as scripts/backfill-membership-years
  // already does).
  const year = parseInt(membershipYear, 10)
    || (period ? parseInt(String(period.start_date).slice(0, 4), 10) : null);
  for (const id of ids) {
    await memberRepo.activate(id);
    if (period) {
      await memberRepo.setExpiryDate(id, period.end_date);
      await memberRepo.setMembershipYear(id, year);
      await membershipYearsRepo.enroll(id, period.id, paymentId);
    }
  }

  if (clearRenewalToken) await memberRepo.clearRenewalToken(primary.id);

  const members = [];
  for (const id of ids) {
    members.push((await memberRepo.findById(id)) || null);
  }

  return {
    period: period || null,
    primary: members[0],
    members: members.filter(Boolean),
  };
}

const sameAddress = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/**
 * The outbound half of activation: membership cards, the welcome + receipt emails and the
 * Sender push. Separate from activateForPeriod so paths that only need the data fixed —
 * admin edits, a bulk repair run — never mail anybody.
 *
 * `generateCards: false` skips generation and attaches whatever cards already exist for
 * the member's year; `sendEmails: false` stops after generation. The Sender sync is a data
 * sync rather than an outbound message, so it runs either way.
 */
async function deliverActivation({
  primary,
  members,
  receipt = null,
  generateCards = true,
  sendEmails = true,
}) {
  if (!primary || !members || members.length === 0) return;

  // Track which members got a card so a stale prior-year card is never mailed when
  // generation fails (issue #67). With generation skipped, every member is a candidate
  // and buildCardAttachments resolves whatever is already stored.
  let cardReady = members;
  if (generateCards) {
    const cardService = require('./card');
    const generated = new Set();
    for (const member of members) {
      try {
        await cardService.generatePDF(member);
        await cardService.generatePNG(member);
        generated.add(member.id);
      } catch (e) {
        logger.error('Card generation error', {
          memberNumber: member.member_number,
          error: e.message,
          stack: e.stack,
        });
      }
    }
    cardReady = members.filter(m => {
      if (generated.has(m.id)) return true;
      logger.warn('Skipping card delivery — no card generated', {
        memberNumber: m.member_number,
        membershipYear: m.membership_year,
      });
      return false;
    });
  }

  if (sendEmails) {
    const emailService = require('./email');
    // Cards ride along with the welcome instead of arriving in their own message
    // (issue #73) — a family sharing one address used to get a card email per member on
    // top of the welcome and the receipt. Sub-members who supplied their own address
    // can't ride along, so they still get one.
    // A sub-member may have no address of their own — the family form allows a blank
    // email. Their card rides on the primary's welcome; mailing them individually would
    // just log a failed send to an empty recipient.
    const ridesWithPrimary = m => !m.email || sameAddress(m.email, primary.email);
    const primaryCards = cardReady.filter(ridesWithPrimary);
    const ownAddressCards = cardReady.filter(m => !ridesWithPrimary(m));

    // Each send is isolated: one bad address must not drop the rest.
    const sends = [
      () => emailService.sendWelcomeEmail(primary, primaryCards),
      ...(receipt ? [() => emailService.sendPaymentConfirmation(primary, receipt)] : []),
      ...ownAddressCards.map(m => () => emailService.sendCardEmail(m)),
    ];
    for (const send of sends) {
      try {
        await send();
      } catch (e) {
        logger.error('Email send error', { error: e.message, stack: e.stack });
      }
    }
  }

  // Last, and non-throwing — a Sender outage must never fail a paid signup. One call for
  // the whole group: family sub-members share the primary's address and Sender keys on
  // email, so syncing each in turn would clobber the primary's name.
  await require('./sender').syncMembersSafe(members);
}

module.exports = { activateForPeriod, deliverActivation };
