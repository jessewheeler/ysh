const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { generateMemberNumber } = require('../services/members');

// Homepage
router.get('/', (req, res) => {
  const announcements = db.prepare(
    'SELECT * FROM announcements WHERE is_published = 1 ORDER BY sort_order ASC'
  ).all();
  const gallery = db.prepare(
    'SELECT * FROM gallery_images WHERE is_visible = 1 ORDER BY sort_order ASC'
  ).all();

  res.render('index', { announcements, gallery });
});

// Board bios
router.get('/bios', (req, res) => {
  const bios = db.prepare(
    'SELECT * FROM bios WHERE is_visible = 1 ORDER BY sort_order ASC'
  ).all();
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
    const existing = db.prepare('SELECT id FROM members WHERE email = ?').get(email);
    if (existing) {
      req.session.flash_error = 'An account with that email already exists. Please contact us for help.';
      return res.redirect('/membership');
    }

    const year = new Date().getFullYear();
    const member_number = generateMemberNumber(year);

    const result = db.prepare(
      `INSERT INTO members (member_number, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(member_number, first_name, last_name, email, phone || null, address_street || null, address_city || null, address_state || null, address_zip || null, year);

    const memberId = result.lastInsertRowid;

    // Get dues amount from settings
    const duesSetting = db.prepare("SELECT value FROM site_settings WHERE key = 'dues_amount_cents'").get();
    const amountCents = parseInt(duesSetting?.value) || 2500;

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
