const memberRepo = require('../db/repos/members');
const paymentRepo = require('../db/repos/payments');
const emailLogRepo = require('../db/repos/emailLog');

function getStats() {
  return {
    totalMembers: memberRepo.countAll(),
    activeMembers: memberRepo.countActive(),
    totalRevenue: paymentRepo.sumCompletedCents(),
    emailsSent: emailLogRepo.countAll(),
  };
}

function getRecentActivity() {
  return {
    recentMembers: memberRepo.listRecent(5),
    recentPayments: paymentRepo.listRecent(5),
  };
}

module.exports = {
  getStats,
  getRecentActivity,
};
