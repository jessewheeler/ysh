const paymentRepo = require('../db/repos/payments');
const memberRepo = require('../db/repos/members');

async function recordOfflinePayment({ memberId, amountCents, paymentMethod, description, activateMember }) {
  await paymentRepo.create({
    member_id: memberId,
    amount_cents: amountCents,
    currency: 'usd',
    status: 'completed',
    description: description || 'Offline payment',
    payment_method: paymentMethod || 'cash',
  });

  if (activateMember) {
    await memberRepo.activate(memberId);
  }
}

async function completeStripePayment(sessionId, paymentIntent) {
  await paymentRepo.completeBySessionId(sessionId, paymentIntent);
}

module.exports = {
  recordOfflinePayment,
  completeStripePayment,
};
