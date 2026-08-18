const express = require('express');
const router = express.Router();
const { activateMember, findMemberById } = require('../services/members');
const paymentsService = require('../services/payments');
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
    const membershipType = session.metadata?.membership_type || 'individual';

    if (memberId) {
      // 1. Complete payment
      await paymentsService.completeStripePayment(session.id, session.payment_intent);

      // 2. Activate primary member
      await activateMember(memberId);
      const primaryMember = await findMemberById(memberId);

      // 3. Get and activate family members
      const memberRepo = require('../db/repos/members');
      let familyMembers = [];
      if (membershipType === 'family') {
        familyMembers = await memberRepo.findFamilyMembers(memberId);
        for (const fm of familyMembers) {
          await activateMember(fm.id);
        }
      }

        // 4. Resolve period, set expiry_date + membership_year, enroll members, clear renewal token
      try {
          const periodsRepo = require('../db/repos/membershipPeriods');
          const membershipYearsRepo = require('../db/repos/membershipYears');
          const paymentsRepo = require('../db/repos/payments');

          const metaPeriodId = session.metadata?.period_id;
          const period = metaPeriodId
              ? await periodsRepo.get(parseInt(metaPeriodId))
              : await periodsRepo.getCurrent();

          const completedPayment = await paymentsRepo.findByStripeSession(session.id);
          const paymentId = completedPayment ? completedPayment.id : null;

        const allIds = [memberId, ...familyMembers.map(fm => fm.id)];
        for (const id of allIds) {
            if (period) {
                await memberRepo.setExpiryDate(id, period.end_date);
                await memberRepo.setMembershipYear(id, new Date(period.start_date).getFullYear());
                await membershipYearsRepo.enroll(id, period.id, paymentId);
          }
        }
        await memberRepo.clearRenewalToken(memberId);
      } catch (e) {
        logger.error('Error setting expiry date or clearing renewal token', {error: e.message});
      }

      // 4b. Re-fetch members so cards/emails reflect the updated membership_year + expiry_date
      const refreshedPrimary = await findMemberById(memberId) || primaryMember;
      const refreshedFamily = await Promise.all(
        familyMembers.map(async fm => (await findMemberById(fm.id)) || fm)
      );

      // 5. Generate cards for all members. Track which members got a card so we
      //    never email a stale prior-year card when generation fails (issue #67).
      const allMembers = [refreshedPrimary, ...refreshedFamily];
      const cardGenerated = new Set();
      for (const member of allMembers) {
        try {
          const { generatePDF, generatePNG } = require('../services/card');
          await generatePDF(member);
          await generatePNG(member);
          cardGenerated.add(member.id);
        } catch (e) {
          logger.error('Card generation error', {
            memberNumber: member.member_number,
            error: e.message,
            stack: e.stack
          });
        }
      }

      // 6. Send emails
      try {
        const emailService = require('../services/email');

        // Primary member: welcome + payment confirmation
        await emailService.sendWelcomeEmail(refreshedPrimary);
        await emailService.sendPaymentConfirmation(refreshedPrimary, session);

        // Card email — only for members whose current-year card was produced.
        for (const member of allMembers) {
          if (!cardGenerated.has(member.id)) {
            logger.warn('Skipping card email — no card generated', {
              memberNumber: member.member_number,
              membershipYear: member.membership_year,
            });
            continue;
          }
          await emailService.sendCardEmail(member);
        }
      } catch (e) {
        logger.error('Email send error', { error: e.message, stack: e.stack });
      }

      // 7. Push to Sender. Last, and non-throwing — a Sender outage must never fail a
      //    paid signup. Covers renewals too; they land on this same webhook. One call
      //    per unique email: family sub-members share the primary's address, and
      //    Sender keys on email, so syncing each would clobber the primary's name.
      const senderService = require('../services/sender');
      await senderService.syncMembersSafe(allMembers);
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
