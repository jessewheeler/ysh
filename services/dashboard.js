const memberRepo = require('../db/repos/members');
const paymentRepo = require('../db/repos/payments');
const emailLogRepo = require('../db/repos/emailLog');

async function getStats() {
  const [totalMembers, activeMembers, totalRevenue, emailsSent] = await Promise.all([
    memberRepo.countAll(),
    memberRepo.countActive(),
    paymentRepo.sumCompletedCents(),
    emailLogRepo.countAll()
  ]);

  return {
    totalMembers,
    activeMembers,
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
