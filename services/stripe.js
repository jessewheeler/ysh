const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paymentRepo = require('../db/repos/payments');

async function createCheckoutSession({ memberId, email, amountCents, baseUrl }) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: email,
    metadata: { member_id: String(memberId) },
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: {
            name: 'Yellowstone Sea Hawkers Membership Dues',
            description: `${new Date().getFullYear()} Annual Membership`,
          },
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${baseUrl}/membership/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/membership/cancel`,
  });

  // Record the payment as pending
  paymentRepo.create({
    member_id: memberId,
    stripe_session_id: session.id,
    amount_cents: amountCents,
    currency: 'usd',
    status: 'pending',
    description: `${new Date().getFullYear()} Membership Dues`,
  });

  return session;
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

module.exports = {
  createCheckoutSession,
  constructWebhookEvent,
};
