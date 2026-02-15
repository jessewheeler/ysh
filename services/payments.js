const paymentRepo = require('../db/repos/payments');
const memberRepo = require('../db/repos/members');

function recordOfflinePayment({ memberId, amountCents, paymentMethod, description, activateMember }) {
  paymentRepo.create({
    member_id: memberId,
    amount_cents: amountCents,
    currency: 'usd',
    status: 'completed',
    description: description || 'Offline payment',
    payment_method: paymentMethod || 'cash',
  });

  if (activateMember) {
    memberRepo.activate(memberId);
  }
}

function completeStripePayment(sessionId, paymentIntent) {
  paymentRepo.completeBySessionId(sessionId, paymentIntent);
}

module.exports = {
  recordOfflinePayment,
  completeStripePayment,
};
