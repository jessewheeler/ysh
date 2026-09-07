const membersRepo = require('../db/repos/members');
const periodsRepo = require('../db/repos/membershipPeriods');
const senderService = require('./sender');
const logger = require('./logger');

// Blast-radius fuse. A bad query or a data accident should not be able to expire the
// whole club in one unattended run. The first legitimate run is expected to exceed this
// (most of the roster has never been enrolled), so that one is run by hand with --max.
const DEFAULT_MAX_EXPIRATIONS = 50;

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Mark every lapsed membership as expired.
 *
 * Nothing else in this app writes status='expired', so without this job a membership that
 * simply runs out keeps status='active' with a stale or NULL expiry_date. See
 * docs/needs-attention-signals.md for why enrollment, not expiry_date, is the signal.
 *
 * Two guards run before any write:
 *
 *  - No open period. The lapsed rule is "not enrolled in any period whose end_date is in
 *    the future", so if the board has not created the next season yet, *everyone* matches.
 *    That is a config lapse, not a mass lapse, and must never be acted on.
 *  - A ceiling on how many members one run may expire.
 *
 * Returns {expired, failed, total, skipped}. `skipped` is null on a normal run.
 */
async function expireLapsedMemberships({ dryRun = false, maxExpirations = DEFAULT_MAX_EXPIRATIONS } = {}) {
  const today = isoDate();

  const currentPeriod = await periodsRepo.getCurrent(today);
  if (!currentPeriod) {
    logger.warn('Membership expiry skipped — no open membership period', { today });
    return { expired: 0, failed: 0, total: 0, skipped: 'no-open-period' };
  }

  const lapsed = await membersRepo.findLapsed(today);

  if (lapsed.length > maxExpirations) {
    logger.error('Membership expiry aborted — candidate count exceeds ceiling', {
      total: lapsed.length,
      maxExpirations,
    });
    return { expired: 0, failed: 0, total: lapsed.length, skipped: 'over-ceiling' };
  }

  if (dryRun) {
    logger.info('Membership expiry dry run', { total: lapsed.length });
    return { expired: 0, failed: 0, total: lapsed.length, skipped: 'dry-run' };
  }

  const changed = [];
  let failed = 0;
  for (const member of lapsed) {
    try {
      await membersRepo.markExpired(member.id);
      changed.push(member);
    } catch (e) {
      logger.error('Membership expiry failed for member', { error: e.message, memberId: member.id });
      failed++;
    }
  }

  // One batched call rather than per-member: syncMembersSafe dedupes by email, and family
  // sub-members share the primary's address. It log-and-swallows, so a Sender outage
  // cannot fail the run; a miss is repaired by the next run or scripts/sync-sender.js.
  if (changed.length) await senderService.syncMembersSafe(changed);

  logger.info('Membership expiry completed', {
    expired: changed.length,
    failed,
    total: lapsed.length,
  });

  return { expired: changed.length, failed, total: lapsed.length, skipped: null };
}

module.exports = { expireLapsedMemberships, DEFAULT_MAX_EXPIRATIONS };
