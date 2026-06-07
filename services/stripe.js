const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paymentRepo = require('../db/repos/payments');
const donationRepo = require('../db/repos/donations');

async function createCheckoutSession({ memberId, email, amountCents, baseUrl, membershipType = 'individual', familyMemberIds = [] }) {
  const year = new Date().getFullYear();
  const description = membershipType === 'family'
    ? `${year} Family Membership`
    : `${year} Annual Membership`;

  const metadata = {
    member_id: String(memberId),
    membership_type: membershipType
  };

  // Store family member IDs in metadata
  if (membershipType === 'family' && familyMemberIds.length) {
    metadata.family_member_ids = JSON.stringify(familyMemberIds);
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: email,
    metadata,
    line_items: [
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

async function createDonationCheckoutSession({donorName, donorEmail, amountCents, baseUrl}) {
    // Persist the pending donation BEFORE creating the Stripe session. If the DB write
    // fails (e.g. database down), we throw here and the donor is never charged, rather
    // than leaving an orphaned checkout session with no local record.
    const {lastInsertRowid: donationId} = await donationRepo.create({
        donor_name: donorName,
        donor_email: donorEmail,
        stripe_session_id: null,
        amount_cents: amountCents,
        currency: 'usd',
        status: 'pending',
    });

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        customer_email: donorEmail,
        metadata: {
            donation: 'true',
            donation_id: String(donationId),
            donor_name: donorName,
            donor_email: donorEmail,
        },
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    unit_amount: amountCents,
                    product_data: {
                        name: 'Yellowstone Sea Hawkers — Donation',
                        description: 'Thank you for your generous support!',
                    },
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        success_url: `${baseUrl}/donate/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/donate/cancel`,
    });

    await donationRepo.attachSession(donationId, session.id);

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
