const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paymentRepo = require('../db/repos/payments');
const donationRepo = require('../db/repos/donations');

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
        // Copy the metadata onto the PaymentIntent as well. A
        // payment_intent.payment_failed event carries the intent, not the session, so
        // without this a declined card cannot be traced back to a member.
        payment_intent_data: {metadata},
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

// A one-off donation (issue #126). The pending row is written BEFORE the Stripe session is
// created: if the database is down we throw here and the donor is never charged, rather than
// leaving a paid checkout with no local record. The row's id rides in the metadata so the
// webhook can find it even when attachSession below never ran.
//
// An anonymous gift sends Stripe nothing about the donor: no customer_email, no name in the
// metadata. Stripe asks for an email on its own page and keeps it; we never store it.
async function createDonationCheckoutSession({
  donorName, donorEmail, isAnonymous, fundId, fundName, giftCents, feeCoverCents = 0, memberId = null, baseUrl,
}) {
  const donation = await donationRepo.create({
    donor_name: donorName,
    donor_email: donorEmail,
    is_anonymous: isAnonymous,
    fund_id: fundId,
    gift_cents: giftCents,
    fee_cover_cents: feeCoverCents,
    member_id: memberId,
  });

  const metadata = { donation: 'true', donation_id: String(donation.id) };

  const lineItems = [
    {
      price_data: {
        currency: 'usd',
        unit_amount: giftCents,
        product_data: {
          name: fundName ? `Donation — ${fundName}` : 'Donation',
          description: 'Yellowstone Sea Hawkers. Thank you for your support!',
        },
      },
      quantity: 1,
    },
  ];
  if (feeCoverCents > 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        unit_amount: feeCoverCents,
        product_data: { name: 'Card processing fee' },
      },
      quantity: 1,
    });
  }

  const params = {
    payment_method_types: ['card'],
    metadata,
    // On the PaymentIntent too, so a payment_intent.payment_failed event can be told apart
    // from a membership failure.
    payment_intent_data: { metadata },
    line_items: lineItems,
    mode: 'payment',
    submit_type: 'donate',
    success_url: `${baseUrl}/donate/success`,
    cancel_url: `${baseUrl}/donate/cancel`,
  };
  if (!isAnonymous && donorEmail) {
    params.customer_email = donorEmail;
  }

  const session = await stripe.checkout.sessions.create(params);
  await donationRepo.attachSession(donation.id, session.id);
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
  createDonationCheckoutSession,
  constructWebhookEvent,
};
