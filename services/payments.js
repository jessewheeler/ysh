const paymentRepo = require('../db/repos/payments');

/**
 * Why a payment was voided. `other` is the only one that needs the admin to say more.
 * Values are the payments.void_reason CHECK list; labels are what the form shows.
 */
const VOID_REASONS = [
  { value: 'refunded', label: 'Refunded' },
  { value: 'voided', label: 'Voided (entered in error)' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'other', label: 'Other' },
];

/**
 * An identical offline payment (member, amount, method) recorded this recently is treated
 * as the same one submitted twice — a double-click, a refresh, a slow network — rather
 * than a second payment. A minute is long enough to cover the cards-and-emails round trip
 * the first submit is still finishing, and short enough that a real second payment only
 * has to wait it out.
 */
const DUPLICATE_WINDOW_SECONDS = 60;

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

async function isRecentOfflineDuplicate({ memberId, amountCents, paymentMethod }) {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_SECONDS * 1000);
  const match = await paymentRepo.findRecentCompletedDuplicate({
    memberId, amountCents, paymentMethod: paymentMethod || 'cash', since,
  });
  return !!match;
}

/**
 * Voids a mistaken offline payment — the soft delete. Every refusal is a plain Error with
 * a message fit for the flash, since the route's only job on failure is to show it.
 * Returns the voided row.
 */
async function voidPayment({ paymentId, memberId, reason, note }) {
  if (!VOID_REASONS.some(r => r.value === reason)) {
    throw new Error('Choose a reason for voiding the payment.');
  }
  const trimmedNote = (note || '').trim();
  if (reason === 'other' && !trimmedNote) {
    throw new Error('A note is required when the reason is Other.');
  }

  const payment = await paymentRepo.findById(paymentId);
  if (!payment || Number(payment.member_id) !== Number(memberId)) {
    throw new Error('Payment not found for this member.');
  }
  if (payment.payment_method === 'stripe') {
    throw new Error('Stripe payments cannot be voided here — refund them in the Stripe dashboard.');
  }
  if (payment.status === 'voided') {
    throw new Error('This payment has already been voided.');
  }
  if (payment.status !== 'completed') {
    throw new Error(`Only completed payments can be voided; this one is ${payment.status}.`);
  }

  const voided = await paymentRepo.voidById(paymentId, { reason, note: trimmedNote || null });
  if (!voided) throw new Error('This payment has already been voided.');
  return voided;
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
  VOID_REASONS,
  DUPLICATE_WINDOW_SECONDS,
  recordOfflinePayment,
  isRecentOfflineDuplicate,
  voidPayment,
  completeStripePayment,
  expireStripeCheckout,
  recordStripeFailure,
};
