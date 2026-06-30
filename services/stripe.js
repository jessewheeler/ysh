const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paymentRepo = require('../db/repos/payments');

async function createCheckoutSession({
                                         memberId,
                                         email,
                                         amountCents,
                                         baseUrl,
                                         membershipType = 'individual',
                                         familyMemberIds = [],
                                         surchargeCents = 0,
                                         periodId = null
                                     }) {
  const year = new Date().getFullYear();
  const description = membershipType === 'family'
    ? `${year} Family Membership`
    : `${year} Annual Membership`;

  const metadata = {
    member_id: String(memberId),
    membership_type: membershipType
  };

  if (membershipType === 'family' && familyMemberIds.length) {
    metadata.family_member_ids = JSON.stringify(familyMemberIds);
  }
    if (periodId) {
        metadata.period_id = String(periodId);
    }

    const lineItems = [
        {
            price_data: {
                currency: 'usd',
                unit_amount: amountCents,
                product_data: {
                    name: 'Yellowstone Sea Hawkers Membership Dues',
                    description
                },
            },
            quantity: 1,
        },
    ];

    if (surchargeCents > 0) {
        lineItems.push({
            price_data: {
                currency: 'usd',
                unit_amount: surchargeCents,
                product_data: {name: 'Electronic payment fee'},
            },
            quantity: 1,
        });
    }

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        customer_email: email,
        metadata,
        line_items: lineItems,
    mode: 'payment',
    success_url: `${baseUrl}/membership/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/membership/cancel`,
  });

    const totalCents = amountCents + surchargeCents;
    await paymentRepo.create({
    member_id: memberId,
    stripe_session_id: session.id,
        amount_cents: totalCents,
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
