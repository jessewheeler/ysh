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

    if (memberId) {
      // Update payment record
      await paymentsService.completeStripePayment(session.id, session.payment_intent);

      // Activate member
      await activateMember(memberId);

      const member = await findMemberById(memberId);

      // Generate membership card
      try {
        const { generatePDF, generatePNG } = require('../services/card');
        await generatePDF(member);
        await generatePNG(member);
      } catch (e) {
        console.error('Card generation error:', e.message);
      }

      // Send welcome + card emails
      try {
        const emailService = require('../services/email');
        await emailService.sendWelcomeEmail(member);
        await emailService.sendPaymentConfirmation(member, session);
        await emailService.sendCardEmail(member);
      } catch (e) {
        console.error('Email send error:', e.message);
      }
    }
  }

  res.json({ received: true });
});

module.exports = router;
