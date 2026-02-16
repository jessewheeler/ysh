const express = require('express');
const router = express.Router();
const contentService = require('../services/content');
const memberRepo = require('../db/repos/members');
const settingsRepo = require('../db/repos/settings');
const { generateMemberNumber } = require('../services/members');

// Homepage
router.get('/', async (req, res, next) => {
  try {
    const announcements = await contentService.listPublishedAnnouncements();
    const gallery = await contentService.listVisibleGalleryImages();
    res.render('index', { announcements, gallery });
  } catch (err) {
    next(err);
  }
});

// Board bios
router.get('/bios', async (req, res, next) => {
  try {
    const bios = await contentService.listVisibleBios();
    res.render('bios', { bios });
  } catch (err) {
    next(err);
  }
});

// Membership signup form
router.get('/membership', async (req, res) => {
  const individualDues = parseInt(await settingsRepo.get('individual_dues_amount_cents')) || 1600;
  const familyDues = parseInt(await settingsRepo.get('family_dues_amount_cents')) || 2600;
  const maxFamilyMembers = parseInt(await settingsRepo.get('max_family_members')) || 6;

  res.render('membership', { individualDues, familyDues, maxFamilyMembers });
});

// Membership POST — create pending member + redirect to Stripe
router.post('/membership', async (req, res) => {
  try {
    const {
      membership_type = 'individual',
      first_name, last_name, email, phone,
      address_street, address_city, address_state, address_zip
    } = req.body;

    // Validate primary member
    if (!first_name || !last_name || !email) {
      req.session.flash_error = 'First name, last name, and email are required.';
      return res.redirect('/membership');
    }

    // Check duplicate email for primary member
    const existing = await memberRepo.findByEmail(email);
    if (existing) {
      req.session.flash_error = 'An account with that email already exists.';
      return res.redirect('/membership');
    }

    // Parse family members if family membership
    let familyMembers = [];
    if (membership_type === 'family') {
      const familyData = Array.isArray(req.body.family_members)
        ? req.body.family_members
        : (req.body.family_members ? [req.body.family_members] : []);

      familyMembers = familyData
        .map(fm => ({
          first_name: fm.first_name?.trim(),
          last_name: fm.last_name?.trim(),
          email: fm.email?.trim() || ''
        }))
        .filter(fm => fm.first_name && fm.last_name);

      // Validate max family size
      const maxFamilyMembers = parseInt(await settingsRepo.get('max_family_members')) || 6;
      if (familyMembers.length > maxFamilyMembers - 1) {
        req.session.flash_error = `Maximum ${maxFamilyMembers} members allowed per family.`;
        return res.redirect('/membership');
      }
    }

    // Create members
    const { primaryId, familyMemberIds } = await memberRepo.createWithFamily({
      primaryMember: {
        first_name, last_name, email, phone,
        address_street, address_city, address_state, address_zip
      },
      familyMembers,
      membershipType: membership_type
    });

    // Get dues amount
    const settingKey = membership_type === 'family'
      ? 'family_dues_amount_cents'
      : 'individual_dues_amount_cents';
    const duesValue = await settingsRepo.get(settingKey);
    const amountCents = parseInt(duesValue) || (membership_type === 'family' ? 2600 : 1600);

    // Create Stripe checkout session
    const { createCheckoutSession } = require('../services/stripe');
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const session = await createCheckoutSession({
      memberId: primaryId,
      email,
      amountCents,
      baseUrl,
      membershipType: membership_type,
      familyMemberIds
    });

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

    // Try to send via email service
    try {
      const emailService = require('../services/email');
      await emailService.sendContactEmail({ name, email, message });
    } catch (e) {
      console.error('Email service not available or error:', e.message);
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
