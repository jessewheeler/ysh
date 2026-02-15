const express = require('express');
const router = express.Router();
const contentService = require('../services/content');
const memberRepo = require('../db/repos/members');
const settingsRepo = require('../db/repos/settings');
const { generateMemberNumber } = require('../services/members');

// Homepage
router.get('/', (req, res) => {
  const announcements = contentService.listPublishedAnnouncements();
  const gallery = contentService.listVisibleGalleryImages();

  res.render('index', { announcements, gallery });
});

// Board bios
router.get('/bios', (req, res) => {
  const bios = contentService.listVisibleBios();
  res.render('bios', { bios });
});

// Membership signup form
router.get('/membership', (req, res) => {
  res.render('membership');
});

// Membership POST — create pending member + redirect to Stripe
router.post('/membership', async (req, res) => {
  try {
    const { first_name, last_name, email, phone, address_street, address_city, address_state, address_zip } = req.body;

    if (!first_name || !last_name || !email) {
      req.session.flash_error = 'First name, last name, and email are required.';
      return res.redirect('/membership');
    }

    // Check for existing member with same email
    const existing = memberRepo.findByEmail(email);
    if (existing) {
      req.session.flash_error = 'An account with that email already exists. Please contact us for help.';
      return res.redirect('/membership');
    }

    const year = new Date().getFullYear();
    const member_number = generateMemberNumber(year);

    const result = memberRepo.create({
      member_number, first_name, last_name, email, phone,
      address_street, address_city, address_state, address_zip,
      membership_year: year, status: 'pending',
    });

    const memberId = result.lastInsertRowid;

    // Get dues amount from settings
    const duesValue = settingsRepo.get('dues_amount_cents');
    const amountCents = parseInt(duesValue) || 2500;

    // Create Stripe checkout session
    const { createCheckoutSession } = require('../services/stripe');
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const session = await createCheckoutSession({ memberId, email, amountCents, baseUrl });

    res.redirect(303, session.url);
  } catch (err) {
    console.error('Membership signup error:', err);
    req.session.flash_error = 'Something went wrong. Please try again.';
    res.redirect('/membership');
  }
});

// Membership success / cancel
router.get('/membership/success', (req, res) => {
  res.render('membership-success');
});

router.get('/membership/cancel', (req, res) => {
  res.render('membership-cancel');
});

// Contact form POST
router.post('/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      req.session.flash_error = 'All fields are required.';
      return res.redirect('/#contact');
    }

    // Try to send via email service (will be fully implemented in Phase 5)
    try {
      const emailService = require('../services/email');
      await emailService.sendContactEmail({ name, email, message });
    } catch (e) {
      console.log('Email service not available or error:', e.message);
    }

    res.redirect('/contact/success');
  } catch (err) {
    console.error('Contact form error:', err);
    req.session.flash_error = 'Something went wrong. Please try again.';
    res.redirect('/#contact');
  }
});

// Contact success
router.get('/contact/success', (req, res) => {
  res.render('contact-success');
});

module.exports = router;
