const memberRepo = require('../db/repos/members');
const paymentRepo = require('../db/repos/payments');
const donationRepo = require('../db/repos/donations');
const emailLogRepo = require('../db/repos/emailLog');

async function getStats() {
    const [totalMembers, activeMembers, totalRevenue, emailsSent, totalDonations] = await Promise.all([
    memberRepo.countAll(),
    memberRepo.countActive(),
    paymentRepo.sumCompletedCents(),
        emailLogRepo.countAll(),
        donationRepo.sumCompletedCents(),
  ]);

  return {
    totalMembers,
    activeMembers,
    totalRevenue,
    emailsSent,
      totalDonations,
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
