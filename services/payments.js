const paymentRepo = require('../db/repos/payments');

/**
 * Records a cash/check payment an admin took in person. Returns the new payment's id so
 * the caller can link it to a membership_years enrollment — activation itself belongs to
 * services/activation.js, which handles the family and the period alongside the status.
 */
async function recordOfflinePayment({ memberId, amountCents, paymentMethod, description }) {
  const result = await paymentRepo.create({
    member_id: memberId,
    amount_cents: amountCents,
    currency: 'usd',
    status: 'completed',
    description: description || 'Offline payment',
    payment_method: paymentMethod || 'cash',
  });

  return result.lastInsertRowid;
}

async function completeStripePayment(sessionId, paymentIntent) {
  await paymentRepo.completeBySessionId(sessionId, paymentIntent);
}

/**
 * A checkout session expired without being paid — the member opened Stripe and walked
 * away. Flips the pending row so the Needs attention filter can surface them.
 */
async function expireStripeCheckout(sessionId, reason) {
  await paymentRepo.failBySessionId(sessionId, reason || 'Checkout session expired');
}

/**
 * A card was declined. Recorded as its own row rather than as an update, because the
 * member may retry successfully afterwards and both attempts are worth keeping.
 */
async function recordStripeFailure({ memberId, paymentIntent, amountCents, reason }) {
  await paymentRepo.recordFailure({
    member_id: memberId,
    stripe_payment_intent: paymentIntent,
    amount_cents: amountCents,
    reason,
  });
}

module.exports = {
  recordOfflinePayment,
  completeStripePayment,
  expireStripeCheckout,
  recordStripeFailure,
};
