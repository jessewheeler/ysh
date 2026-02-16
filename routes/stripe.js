const express = require('express');
const router = express.Router();
const { activateMember, findMemberById } = require('../services/members');
const paymentsService = require('../services/payments');

router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    const { constructWebhookEvent } = require('../services/stripe');
    event = constructWebhookEvent(req.body, sig);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
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

      // 4. Generate cards for all members
      const allMembers = [primaryMember, ...familyMembers];
      for (const member of allMembers) {
        try {
          const { generatePDF, generatePNG } = require('../services/card');
          await generatePDF(member);
          await generatePNG(member);
        } catch (e) {
          console.error(`Card generation error for ${member.member_number}:`, e.message);
        }
      }

      // 5. Send emails
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
        console.error('Email send error:', e.message);
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
