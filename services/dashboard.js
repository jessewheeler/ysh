const memberRepo = require('../db/repos/members');
const paymentRepo = require('../db/repos/payments');
const emailLogRepo = require('../db/repos/emailLog');
const periodsRepo = require('../db/repos/membershipPeriods');
const membershipYearsRepo = require('../db/repos/membershipYears');

async function getStats() {
  const currentPeriod = await periodsRepo.getCurrent();
  const currentPeriodId = currentPeriod ? currentPeriod.id : null;

  const [counts, currentPeriodEnrollment, totalRevenue, emailsSent] = await Promise.all([
    memberRepo.countByView(currentPeriodId),
    currentPeriodId ? membershipYearsRepo.countByPeriod(currentPeriodId) : 0,
    paymentRepo.sumCompletedCents(),
    emailLogRepo.countAll()
  ]);

  return {
    totalMembers: counts.all,
    activeMembers: counts.active,
    needsRenewal: counts.needsRenewal,
    pendingMembers: counts.pending,
    currentPeriodEnrollment,
    currentPeriodId,
    currentPeriodLabel: currentPeriod ? currentPeriod.label : null,
    totalRevenue,
    emailsSent,
  };
}

async function getRecentActivity() {
  const [recentMembers, recentPayments] = await Promise.all([
    memberRepo.listRecent(5),
    paymentRepo.listRecent(5)
  ]);

  return {
    recentMembers,
    recentPayments,
  };
}

module.exports = {
  getStats,
  getRecentActivity,
};
