const express = require('express');
const router = express.Router();
const paymentsService = require('../services/payments');
const activation = require('../services/activation');
const donationRepo = require('../db/repos/donations');
const memberRepo = require('../db/repos/members');
const logger = require('../services/logger');

// Marks a donation paid and, for a named gift, links it to a member and sends the thank-you.
//
// Everything about the donor comes from OUR row, never from the session. For an anonymous
// gift the session's customer_details hold the name and email Stripe collected on its own
// page, and copying them here (into the row, the email log or a log line) would store
// exactly what the donor asked us not to keep.
async function completeDonation(session) {
  const donationId = parseInt(session.metadata.donation_id, 10) || null;
  const donation = (await donationRepo.findBySessionId(session.id))
    || (donationId ? await donationRepo.findById(donationId) : null);
  if (!donation) {
    logger.warn('Donation webhook for an unknown donation', { sessionId: session.id, donationId });
    return;
  }

  let member = null;
  if (!donation.is_anonymous) {
    member = await memberRepo.findByEmailIgnoreCase(donation.donor_email);
  }

  const firstCompletion = await donationRepo.complete(session.id, {
    paymentIntent: session.payment_intent,
    memberId: member ? member.id : null,
    donationId: donation.id,
  });
  if (!firstCompletion || donation.is_anonymous) return;

  const emailService = require('../services/email');
  await emailService.sendDonationConfirmation({
    donorName: donation.donor_name,
    donorEmail: donation.donor_email,
    fundName: donation.fund_name,
    giftCents: donation.gift_cents,
    feeCoverCents: donation.fee_cover_cents,
    amountCents: donation.amount_cents,
    memberId: member ? member.id : donation.member_id,
  });
}

router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    const { constructWebhookEvent } = require('../services/stripe');
    event = constructWebhookEvent(req.body, sig);
  } catch (err) {
    logger.error('Webhook signature verification failed', { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const memberId = session.metadata?.member_id;

    if (memberId) {
      // 1. Complete payment
      await paymentsService.completeStripePayment(session.id, session.payment_intent);

      // 2. Resolve the period paid for. metadata.period_id is what checkout priced
      //    against; getCurrent() only covers sessions created before that was stamped.
      let period = null;
      let paymentId = null;
      try {
        const periodsRepo = require('../db/repos/membershipPeriods');
        const paymentsRepo = require('../db/repos/payments');
        const metaPeriodId = session.metadata?.period_id;
        period = metaPeriodId
          ? await periodsRepo.get(parseInt(metaPeriodId))
          : await periodsRepo.getCurrent();
        const completedPayment = await paymentsRepo.findByStripeSession(session.id);
        paymentId = completedPayment ? completedPayment.id : null;
      } catch (e) {
        logger.error('Error resolving membership period for webhook', { error: e.message });
      }

      // 3. Activate the member and their family for that period, then send cards + email.
      //    Log-and-continue: the payment has already been marked complete, so a DB hiccup
      //    here must not 500 the handler and send Stripe into a retry loop.
      try {
        const { primary, members } = await activation.activateForPeriod({
          memberId,
          period,
          paymentId,
        });
        await activation.deliverActivation({ primary, members, receipt: session });
      } catch (e) {
        logger.error('Error activating member from webhook', {
          error: e.message, stack: e.stack, memberId, sessionId: session.id,
        });
      }
    } else if (session.metadata?.donation === 'true') {
      // A donation (issue #126). Log-and-continue like the activation above: the money has
      // moved, so a failure here must not send Stripe into a retry loop.
      try {
        await completeDonation(session);
      } catch (e) {
        logger.error('Error completing donation from webhook', {
          error: e.message, stack: e.stack, sessionId: session.id,
        });
      }
    }
  } else if (event.type === 'checkout.session.expired') {
    // Abandoned checkout. Wrapped so a DB error still returns 2xx — Stripe retries on
    // anything else, and this is not worth a retry storm.
    const session = event.data.object;
    try {
      if (session.metadata?.donation === 'true') {
        await donationRepo.failBySessionId(session.id);
      } else {
        await paymentsService.expireStripeCheckout(session.id, 'Checkout session expired');
      }
    } catch (e) {
      logger.error('Error recording expired checkout', { error: e.message, sessionId: session.id });
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    const memberId = intent.metadata?.member_id;
    if (intent.metadata?.donation === 'true') {
      // A declined card on a donation. The donor is still on Stripe's page and can retry;
      // the row stays pending until the session completes or expires.
    } else if (!memberId) {
      // Pre-dates payment_intent_data.metadata, or an intent we did not create.
      logger.warn('Payment failure with no member_id metadata', { paymentIntent: intent.id });
    } else {
      try {
        await paymentsService.recordStripeFailure({
          memberId,
          paymentIntent: intent.id,
          amountCents: intent.amount,
          reason: intent.last_payment_error?.message || 'Payment failed',
        });
      } catch (e) {
        logger.error('Error recording payment failure', { error: e.message, paymentIntent: intent.id });
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
