const express = require('express');
const router = express.Router();
const contentService = require('../services/content');
const memberRepo = require('../db/repos/members');
const settingsRepo = require('../db/repos/settings');
const logger = require('../services/logger');

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
    const log = req.logger || logger;
    log.error('Membership signup error', {
      error: err.message,
      stack: err.stack,
      membershipType: req.body.membership_type
    });
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
      const log = req.logger || logger;
      log.warn('Email service not available or error', { error: e.message });
    }

    res.redirect('/contact/success');
  } catch (err) {
    const log = req.logger || logger;
    log.error('Contact form error', {
      error: err.message,
      stack: err.stack
    });
    req.session.flash_error = 'Something went wrong. Please try again.';
    res.redirect('/#contact');
  }
});

// Contact success
router.get('/contact/success', (req, res) => {
  res.render('contact-success');
});

// Renewal via token
router.get('/renew/:token', async (req, res) => {
  try {
    const member = await memberRepo.findByRenewalToken(req.params.token);
    if (!member) {
      req.session.flash_error = 'This renewal link is invalid or has expired.';
      return res.redirect('/membership');
    }

    const familyMembers = member.membership_type === 'family'
        ? await memberRepo.findFamilyMembers(member.id)
        : [];

    const individualDues = parseInt(await settingsRepo.get('individual_dues_amount_cents')) || 1600;
    const familyDues = parseInt(await settingsRepo.get('family_dues_amount_cents')) || 2600;
    const maxFamilyMembers = parseInt(await settingsRepo.get('max_family_members')) || 6;

    res.render('renew', {member, familyMembers, individualDues, familyDues, maxFamilyMembers, token: req.params.token});
  } catch (err) {
    const log = req.logger || logger;
    log.error('Renewal GET error', {error: err.message, stack: err.stack});
    req.session.flash_error = 'Something went wrong. Please try again.';
    res.redirect('/membership');
  }
});

router.post('/renew/:token', async (req, res) => {
  try {
    const member = await memberRepo.findByRenewalToken(req.params.token);
    if (!member) {
      req.session.flash_error = 'This renewal link is invalid or has expired.';
      return res.redirect('/membership');
    }

    const {
      first_name, last_name, phone,
      address_street, address_city, address_state, address_zip
    } = req.body;

    // Update contact fields (email not changeable — it's their identity)
    await memberRepo.update(member.id, {
      first_name: first_name ?? member.first_name,
      last_name: last_name ?? member.last_name,
      email: member.email,
      phone: phone ?? member.phone,
      address_street: address_street ?? member.address_street,
      address_city: address_city ?? member.address_city,
      address_state: address_state ?? member.address_state,
      address_zip: address_zip ?? member.address_zip,
      membership_year: member.membership_year,
      join_date: member.join_date,
      status: member.status,
      notes: member.notes,
    });

    // Process family member edits (add / update / remove)
    if (member.membership_type === 'family') {
      const maxFamilyMembers = parseInt(await settingsRepo.get('max_family_members')) || 6;

      const rawFamily = Array.isArray(req.body.family_members)
          ? req.body.family_members
          : (req.body.family_members ? [req.body.family_members] : []);

      const submittedMembers = rawFamily
          .filter(fm => fm && fm.first_name?.trim() && fm.last_name?.trim())
          .map(fm => ({
            id: fm.id ? parseInt(fm.id) : null,
            first_name: fm.first_name.trim(),
            last_name: fm.last_name.trim(),
            email: fm.email?.trim() || null,
          }));

      if (submittedMembers.length > maxFamilyMembers - 1) {
        req.session.flash_error = `Maximum ${maxFamilyMembers} total members allowed per family.`;
        return res.redirect(`/renew/${req.params.token}`);
      }

      const currentFamily = await memberRepo.findFamilyMembers(member.id);
      const currentFamilyMap = new Map(currentFamily.map(fm => [fm.id, fm]));
      const submittedIds = new Set();

      for (const fm of submittedMembers) {
        if (fm.id && currentFamilyMap.has(fm.id)) {
          // Update existing family member — only touch name and email
          const existing = currentFamilyMap.get(fm.id);
          await memberRepo.update(fm.id, {
            first_name: fm.first_name,
            last_name: fm.last_name,
            email: fm.email || member.email,
            phone: existing.phone,
            address_street: existing.address_street,
            address_city: existing.address_city,
            address_state: existing.address_state,
            address_zip: existing.address_zip,
            membership_year: existing.membership_year,
            join_date: existing.join_date,
            status: existing.status,
            notes: existing.notes,
          });
          submittedIds.add(fm.id);
        } else if (!fm.id) {
          // Add new family member
          await memberRepo.addFamilyMember(member.id, {
            first_name: fm.first_name,
            last_name: fm.last_name,
            email: fm.email || member.email,
            membership_year: new Date().getFullYear(),
            status: member.status,
          });
        }
      }

      // Remove family members not in the submitted list
      for (const [id] of currentFamilyMap) {
        if (!submittedIds.has(id)) {
          await memberRepo.deleteById(id);
        }
      }
    }

    // Get dues amount
    const settingKey = member.membership_type === 'family'
        ? 'family_dues_amount_cents'
        : 'individual_dues_amount_cents';
    const duesValue = await settingsRepo.get(settingKey);
    const amountCents = parseInt(duesValue) || (member.membership_type === 'family' ? 2600 : 1600);

    // Re-fetch family members after edits for Stripe metadata
    const familyMembers = member.membership_type === 'family'
        ? await memberRepo.findFamilyMembers(member.id)
        : [];
    const familyMemberIds = familyMembers.map(fm => fm.id);

    const {createCheckoutSession} = require('../services/stripe');
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const session = await createCheckoutSession({
      memberId: member.id,
      email: member.email,
      amountCents,
      baseUrl,
      membershipType: member.membership_type,
      familyMemberIds
    });

    res.redirect(303, session.url);
  } catch (err) {
    const log = req.logger || logger;
    log.error('Renewal POST error', {error: err.message, stack: err.stack});
    req.session.flash_error = 'Something went wrong. Please try again.';
    res.redirect(`/renew/${req.params.token}`);
  }
});

module.exports = router;
