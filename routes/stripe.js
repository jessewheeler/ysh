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

      // 5. Generate cards for all members
      const allMembers = [primaryMember, ...familyMembers];
      for (const member of allMembers) {
        try {
          const { generatePDF, generatePNG } = require('../services/card');
          await generatePDF(member);
          await generatePNG(member);
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
        await emailService.sendWelcomeEmail(primaryMember);
        await emailService.sendPaymentConfirmation(primaryMember, session);

        // All members: card email
        for (const member of allMembers) {
          await emailService.sendCardEmail(member);
        }
      } catch (e) {
        logger.error('Email send error', { error: e.message, stack: e.stack });
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
