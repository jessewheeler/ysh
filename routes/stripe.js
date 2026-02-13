const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { activateMember, findMemberById } = require('../services/members');

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
      db.prepare(
        `UPDATE payments SET status = 'completed', stripe_payment_intent = ?, updated_at = datetime('now')
         WHERE stripe_session_id = ?`
      ).run(session.payment_intent, session.id);

      // Activate member
      activateMember(memberId);

      const member = findMemberById(memberId);

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
