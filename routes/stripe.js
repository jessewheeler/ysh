const express = require('express');
const router = express.Router();
const paymentsService = require('../services/payments');
const activation = require('../services/activation');
const logger = require('../services/logger');

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
    }
  } else if (event.type === 'checkout.session.expired') {
    // Abandoned checkout. Wrapped so a DB error still returns 2xx — Stripe retries on
    // anything else, and this is not worth a retry storm.
    const session = event.data.object;
    try {
      await paymentsService.expireStripeCheckout(session.id, 'Checkout session expired');
    } catch (e) {
      logger.error('Error recording expired checkout', { error: e.message, sessionId: session.id });
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    const memberId = intent.metadata?.member_id;
    if (!memberId) {
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
