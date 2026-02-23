const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const storage = require('../services/storage');
const authService = require('../services/auth');
const dashboardService = require('../services/dashboard');
const contentService = require('../services/content');
const adminService = require('../services/admin');
const paymentsService = require('../services/payments');
const memberRepo = require('../db/repos/members');
const paymentRepo = require('../db/repos/payments');
const emailLogRepo = require('../db/repos/emailLog');
const cardsRepo = require('../db/repos/cards');
const settingsRepo = require('../db/repos/settings');
const auditLogRepo = require('../db/repos/auditLog');
const logger = require('../services/logger');
const isDevOrTest = ['development', 'test', 'dev'].includes(process.env.NODE_ENV);

async function handleUpload(file, folder) {
  if (storage.isConfigured()) {
    return storage.uploadFile(file.buffer, file.originalname, folder);
  }
  const localName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`;
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'uploads', localName), file.buffer);
  return `/uploads/${localName}`;
}

// --- Login / Logout ---
router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/dashboard');
  res.render('admin/login');
});

router.post('/login', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    req.session.flash_error = 'Email is required.';
    return res.redirect('/admin/login');
  }

  const admin = await authService.findAdminByEmail(email.trim().toLowerCase());

  // Always show generic message to prevent enumeration
  req.session.flash_success = 'If that email is registered, a login code has been sent.';

  if (admin) {
    const otp = await authService.generateAndStoreOtp(admin.id);

    if (isDevOrTest) {
      logger.debug('DEV OTP', {email: admin.email, otp});
    } else {
      try {
        const emailService = require('../services/email');
        await emailService.sendOtpEmail({ to: admin.email, toName: `${admin.first_name} ${admin.last_name}`, otp });
      } catch (e) {
        logger.error('OTP email failed', {error: e.message, email: admin.email});
      }
    }
  }

  req.session.otpEmail = (email || '').trim().toLowerCase();
  res.redirect('/admin/login/verify');
});

router.get('/login/verify', (req, res) => {
  if (!req.session.otpEmail) return res.redirect('/admin/login');
  const email = req.session.otpEmail;
  const masked = email.replace(/^(.)(.*)(@.*)$/, (_m, first, middle, domain) => {
    return first + '*'.repeat(middle.length) + domain;
  });
  res.render('admin/login-verify', { maskedEmail: masked });
});

router.post('/login/verify', async (req, res) => {
  const { code } = req.body;
  const email = req.session.otpEmail;

  if (!email) return res.redirect('/admin/login');

  const admin = await authService.findAdminByEmail(email);
  const result = await authService.verifyOtp(admin, code);

  if (!result.success) {
    req.session.flash_error = result.error;
    return res.redirect('/admin/login/verify');
  }

  req.session.adminId = admin.id;
  req.session.adminRole = admin.role;
  req.session.adminEmail = admin.email;
  delete req.session.otpEmail;

  const returnTo = req.session.returnTo ?? '/admin/dashboard';
  delete req.session.returnTo;
  res.redirect(returnTo);
});

router.post('/login/resend', async (req, res) => {
  const email = req.session.otpEmail;
  if (!email) return res.redirect('/admin/login');

  const admin = await authService.findAdminByEmail(email);

  if (admin) {
    const otp = await authService.generateAndStoreOtp(admin.id);

    if (isDevOrTest) {
      logger.debug('DEV OTP resend', {email: admin.email, otp});
    } else {
      try {
        const emailService = require('../services/email');
        await emailService.sendOtpEmail({ to: admin.email, toName: `${admin.first_name} ${admin.last_name}`, otp });
      } catch (e) {
        logger.error('OTP resend email failed', {error: e.message, email: admin.email});
      }
    }
  }

  req.session.flash_success = 'A new code has been sent.';
  res.redirect('/admin/login/verify');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// --- All routes below require admin ---
router.use(requireAdmin);

// --- Dashboard ---
router.get('/dashboard', async (req, res, next) => {
  try {
    const stats = await dashboardService.getStats();
    const { recentMembers, recentPayments } = await dashboardService.getRecentActivity();

    res.render('admin/dashboard', {
      stats,
      recentMembers,
      recentPayments,
    });
  } catch (err) {
    next(err);
  }
});

// --- Members CRUD ---
router.get('/members', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    const { members, total } = await memberRepo.search({ search, limit, offset });
    const totalPages = Math.ceil(total / limit);

    res.render('admin/members/list', { members, page, totalPages, search, total });
  } catch (err) {
    next(err);
  }
});

router.get('/members/export', async (req, res, next) => {
  try {
    const { toCsv } = require('../services/csv');
    const members = await memberRepo.listAll();
    const columns = ['member_number', 'first_name', 'last_name', 'email', 'phone', 'address_street', 'address_city', 'address_state', 'address_zip', 'membership_year', 'status', 'notes', 'created_at'];
    const headers = ['Member Number', 'First Name', 'Last Name', 'Email', 'Phone', 'Street', 'City', 'State', 'Zip', 'Year', 'Status', 'Notes', 'Created'];
    const csv = toCsv(members, columns, headers);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ysh-members-${date}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.get('/members/new', (req, res) => {
  res.render('admin/members/form', { member: null });
});

router.post('/members', async (req, res) => {
  const {
    membership_type = 'individual',
    first_name, last_name, email, phone,
    address_street, address_city, address_state, address_zip,
    membership_year, join_date, status, notes
  } = req.body;

  const year = membership_year || new Date().getFullYear();
  const normalizedJoinDate = join_date?.trim() || undefined;

  try {
    if (membership_type === 'family') {
      // Parse family members
      const familyData = Array.isArray(req.body.family_members)
        ? req.body.family_members
        : (req.body.family_members ? [req.body.family_members] : []);

      const familyMembers = familyData
        .map(fm => ({
          first_name: fm.first_name?.trim(),
          last_name: fm.last_name?.trim(),
          email: fm.email?.trim() || ''
        }))
        .filter(fm => fm.first_name && fm.last_name);

      // Create family membership
      await memberRepo.createWithFamily({
        primaryMember: {
          first_name, last_name, email, phone,
          address_street, address_city, address_state, address_zip,
          join_date: normalizedJoinDate
        },
        familyMembers,
        membershipType: 'family'
      });

      // Activate all members if status is active
      if (status === 'active') {
        const primary = await memberRepo.findByEmail(email);
        if (primary) {
          await memberRepo.activate(primary.id);
          const family = await memberRepo.findFamilyMembers(primary.id);
          for (const fm of family) {
            await memberRepo.activate(fm.id);
          }
        }
      }

      const count = familyMembers.length + 1;
      req.session.flash_success = `Family membership created: ${first_name} ${last_name} + ${familyMembers.length} family member(s) (${count} total).`;
    } else {
      // Create individual member
      const { generateMemberNumber } = require('../services/members');
      const member_number = await generateMemberNumber(year);

      await memberRepo.create({
        member_number, first_name, last_name, email, phone,
        address_street, address_city, address_state, address_zip,
        membership_year: year, join_date: normalizedJoinDate, status: status || 'pending', notes,
      });

      req.session.flash_success = `Member ${first_name} ${last_name} created.`;
    }
  } catch (e) {
    req.session.flash_error = (e.message.includes('UNIQUE') || e.code === '23505') ? 'A member with that email already exists.' : e.message;
    return res.redirect('/admin/members/new');
  }
  res.redirect('/admin/members');
});

router.get('/members/:id', async (req, res, next) => {
  try {
    const member = await memberRepo.findById(req.params.id);
    if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }

    if (req.query.edit) {
      return res.render('admin/members/form', { member });
    }

    const [payments, cards, emails] = await Promise.all([
      paymentRepo.findByMemberId(member.id),
      cardsRepo.findByMemberId(member.id),
      emailLogRepo.listByMemberId(member.id, 10)
    ]);

    // Get family relationships
    let familyMembers = [];
    let primaryMember = null;

    if (member.membership_type === 'family') {
      if (member.primary_member_id) {
        // This is a family member
        primaryMember = await memberRepo.findById(member.primary_member_id);
        const allFamily = await memberRepo.findFamilyMembers(member.primary_member_id);
        familyMembers = allFamily.filter(fm => fm.id !== member.id);
      } else {
        // This is a primary member
        familyMembers = await memberRepo.findFamilyMembers(member.id);
      }
    }

    res.render('admin/members/view', { member, payments, cards, emails, familyMembers, primaryMember });
  } catch (err) {
    next(err);
  }
});

router.post('/members/:id', async (req, res) => {
  const { first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, join_date, status, notes } = req.body;
  const normalizedJoinDate = join_date?.trim() || undefined;
  try {
    await memberRepo.update(req.params.id, {
      first_name, last_name, email, phone,
      address_street, address_city, address_state, address_zip,
      membership_year, join_date: normalizedJoinDate, status, notes,
    });
    req.session.flash_success = 'Member updated.';
  } catch (e) {
    req.session.flash_error = e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

router.post('/members/:id/delete', async (req, res) => {
  await memberRepo.deleteById(req.params.id);
  req.session.flash_success = 'Member deleted.';
  res.redirect('/admin/members');
});

// --- Member Card Generation ---
router.post('/members/:id/card', async (req, res) => {
  const member = await memberRepo.findById(req.params.id);
  if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }
  try {
    const { generatePDF, generatePNG } = require('../services/card');
    await generatePDF(member);
    await generatePNG(member);
    (req.logger || logger).info('Card generated', {memberId: member.id, memberNumber: member.member_number});
    req.session.flash_success = 'Membership card generated.';
  } catch (e) {
    (req.logger || logger).error('Card generation failed', {error: e.message, stack: e.stack, memberId: member.id});
    req.session.flash_error = 'Card generation failed: ' + e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

router.get('/members/:id/card/pdf', async (req, res) => {
  const card = await cardsRepo.findLatestByMemberId(req.params.id);
  if (!card || !card.pdf_path) { req.session.flash_error = 'No card found.'; return res.redirect(`/admin/members/${req.params.id}`); }
  res.download(path.join(__dirname, '..', card.pdf_path));
});

router.get('/members/:id/card/png', async (req, res) => {
  const card = await cardsRepo.findLatestByMemberId(req.params.id);
  if (!card || !card.png_path) { req.session.flash_error = 'No card found.'; return res.redirect(`/admin/members/${req.params.id}`); }
  res.download(path.join(__dirname, '..', card.png_path));
});

router.post('/members/:id/email-card', async (req, res) => {
  const member = await memberRepo.findById(req.params.id);
  if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }
  try {
    const emailService = require('../services/email');
    await emailService.sendCardEmail(member);
    (req.logger || logger).info('Card emailed', {memberId: member.id, email: member.email});
    req.session.flash_success = 'Card emailed to member.';
  } catch (e) {
    (req.logger || logger).error('Card email failed', {error: e.message, memberId: member.id});
    req.session.flash_error = 'Failed to email card: ' + e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Send Renewal Reminder ---
router.post('/members/:id/send-renewal', async (req, res) => {
  const member = await memberRepo.findById(req.params.id);
  if (!member) {
    req.session.flash_error = 'Member not found.';
    return res.redirect('/admin/members');
  }
  try {
    const renewalService = require('../services/renewal');
    const emailService = require('../services/email');
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const token = await renewalService.generateRenewalToken(member.id);
    const renewalLink = `${baseUrl}/renew/${token}`;
    await emailService.sendRenewalReminderEmail(member, renewalLink);
    (req.logger || logger).info('Renewal reminder sent', {memberId: member.id, email: member.email});
    req.session.flash_success = `Renewal reminder sent to ${member.email}.`;
  } catch (e) {
    (req.logger || logger).error('Renewal reminder failed', {error: e.message, stack: e.stack, memberId: member.id});
    req.session.flash_error = 'Failed to send renewal reminder: ' + e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Offline Payment ---
router.post('/members/:id/payments', async (req, res) => {
  const member = await memberRepo.findById(req.params.id);
  if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }

  const { amount, payment_method, description, activate_member } = req.body;
  const dollars = parseFloat(amount);
  if (!amount || isNaN(dollars) || dollars <= 0) {
    req.session.flash_error = 'A valid payment amount is required.';
    return res.redirect(`/admin/members/${req.params.id}`);
  }

  const amountCents = Math.round(dollars * 100);
  const isActivating = activate_member === 'on' && member.status !== 'active';
  await paymentsService.recordOfflinePayment({
    memberId: member.id,
    amountCents,
    paymentMethod: payment_method,
    description,
    activateMember: isActivating,
  });

  (req.logger || logger).info('Offline payment recorded', {
    memberId: member.id,
    amountCents,
    paymentMethod: payment_method || 'cash',
    activating: isActivating,
  });

  if (isActivating) {
    const expiryDate = await settingsRepo.get('membership_expiry_date');
    if (expiryDate) {
      await memberRepo.setExpiryDate(member.id, expiryDate);
      // Also activate and set expiry on family members
      if (member.membership_type === 'family') {
        const familyMembers = await memberRepo.findFamilyMembers(member.id);
        for (const fm of familyMembers) {
          await memberRepo.activate(fm.id);
          await memberRepo.setExpiryDate(fm.id, expiryDate);
        }
      }
    }
    (req.logger || logger).info('Member activated via offline payment', {
      memberId: member.id,
      memberNumber: member.member_number,
      expiryDate: await settingsRepo.get('membership_expiry_date'),
    });
  }

  req.session.flash_success = `Payment of $${dollars.toFixed(2)} recorded.`;
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Announcements CRUD ---
router.get('/announcements', async (req, res) => {
  const announcements = await contentService.listAnnouncements();
  res.render('admin/announcements/list', { announcements });
});

router.get('/announcements/new', (req, res) => {
  res.render('admin/announcements/form', { announcement: null });
});

router.post('/announcements', async (req, res) => {
  const { title, body, link_url, link_text, is_published, sort_order } = req.body;
  const image_path = req.file ? await handleUpload(req.file, 'announcements') : (req.body.existing_image || null);
  await contentService.createAnnouncement({ title, body, image_path, link_url, link_text, is_published, sort_order });
  req.session.flash_success = 'Announcement created.';
  res.redirect('/admin/announcements');
});

router.get('/announcements/:id', async (req, res) => {
  const announcement = await contentService.getAnnouncement(req.params.id);
  if (!announcement) { req.session.flash_error = 'Not found.'; return res.redirect('/admin/announcements'); }
  res.render('admin/announcements/form', { announcement });
});

router.post('/announcements/:id', async (req, res) => {
  const { title, body, link_url, link_text, is_published, sort_order } = req.body;
  const existingImagePath = await contentService.getAnnouncementImagePath(req.params.id);
  let image_path;
  if (req.file) {
    image_path = await handleUpload(req.file, 'announcements');
    storage.deleteFile(existingImagePath).catch(() => {});
  } else {
    image_path = req.body.existing_image || existingImagePath || null;
  }
  await contentService.updateAnnouncement(req.params.id, { title, body, image_path, link_url, link_text, is_published, sort_order });
  req.session.flash_success = 'Announcement updated.';
  res.redirect('/admin/announcements');
});

router.post('/announcements/:id/delete', async (req, res) => {
  await contentService.deleteAnnouncement(req.params.id);
  req.session.flash_success = 'Announcement deleted.';
  res.redirect('/admin/announcements');
});

// --- Gallery CRUD ---
router.get('/gallery', async (req, res) => {
  const images = await contentService.listGalleryImages();
  res.render('admin/gallery/list', { images });
});

router.get('/gallery/new', (req, res) => {
  res.render('admin/gallery/form', { image: null });
});

router.post('/gallery', async (req, res) => {
  const { alt_text, caption, sort_order, is_visible } = req.body;
  const filename = req.file ? await handleUpload(req.file, 'gallery') : (req.body.existing_image || '');
  if (!filename) { req.session.flash_error = 'Image file is required.'; return res.redirect('/admin/gallery/new'); }
  await contentService.createGalleryImage({ filename, alt_text, caption, sort_order, is_visible });
  req.session.flash_success = 'Image added.';
  res.redirect('/admin/gallery');
});

router.get('/gallery/:id', async (req, res) => {
  const image = await contentService.getGalleryImage(req.params.id);
  if (!image) { req.session.flash_error = 'Not found.'; return res.redirect('/admin/gallery'); }
  res.render('admin/gallery/form', { image });
});

router.post('/gallery/:id', async (req, res) => {
  const { alt_text, caption, sort_order, is_visible } = req.body;
  const existingFilename = await contentService.getGalleryFilename(req.params.id);
  let filename;
  if (req.file) {
    filename = await handleUpload(req.file, 'gallery');
    storage.deleteFile(existingFilename).catch(() => {});
  } else {
    filename = req.body.existing_image || existingFilename || '';
  }
  await contentService.updateGalleryImage(req.params.id, { filename, alt_text, caption, sort_order, is_visible });
  req.session.flash_success = 'Image updated.';
  res.redirect('/admin/gallery');
});

router.post('/gallery/:id/delete', async (req, res) => {
  await contentService.deleteGalleryImage(req.params.id);
  req.session.flash_success = 'Image deleted.';
  res.redirect('/admin/gallery');
});

// --- Bios CRUD ---
router.get('/bios', async (req, res) => {
  const bios = await contentService.listBios();
  res.render('admin/bios/list', { bios });
});

router.get('/bios/new', (req, res) => {
  res.render('admin/bios/form', { bio: null });
});

router.post('/bios', async (req, res) => {
  const { name, role, bio_text, sort_order, is_visible } = req.body;
  const photo_path = req.file ? await handleUpload(req.file, 'bios') : (req.body.existing_photo || null);
  await contentService.createBio({ name, role, bio_text, photo_path, sort_order, is_visible });
  req.session.flash_success = 'Bio created.';
  res.redirect('/admin/bios');
});

router.get('/bios/:id', async (req, res) => {
  const bio = await contentService.getBio(req.params.id);
  if (!bio) { req.session.flash_error = 'Not found.'; return res.redirect('/admin/bios'); }
  res.render('admin/bios/form', { bio });
});

router.post('/bios/:id', async (req, res) => {
  const { name, role, bio_text, sort_order, is_visible } = req.body;
  const existingPhotoPath = await contentService.getBioPhotoPath(req.params.id);
  let photo_path;
  if (req.file) {
    photo_path = await handleUpload(req.file, 'bios');
    storage.deleteFile(existingPhotoPath).catch(() => {});
  } else {
    photo_path = req.body.existing_photo || existingPhotoPath || null;
  }
  await contentService.updateBio(req.params.id, { name, role, bio_text, photo_path, sort_order, is_visible });
  req.session.flash_success = 'Bio updated.';
  res.redirect('/admin/bios');
});

router.post('/bios/:id/delete', async (req, res) => {
  await contentService.deleteBio(req.params.id);
  req.session.flash_success = 'Bio deleted.';
  res.redirect('/admin/bios');
});

// --- Settings (super_admin only) ---
router.get('/settings', requireSuperAdmin, (req, res) => {
  res.render('admin/settings');
});

router.post('/settings', requireSuperAdmin, async (req, res) => {
  const keys = [
    'hero_title', 'hero_subtitle', 'hero_button_text', 'hero_button_url',
    'hero_media_type',
    'about_quote', 'about_text', 'gallery_album_url', 'dues_amount_cents',
    'contact_email', 'stripe_publishable_key',
    'membership_expiry_date', 'renewal_reminder_days_before',
  ];
  const keyValues = {};
  for (const key of keys) {
    if (req.body[key] !== undefined) {
      keyValues[key] = req.body[key];
    }
  }

  // Handle hero media upload if provided
  if (req.file) {
    const heroMediaUrl = await handleUpload(req.file, 'hero');
    keyValues.hero_media_url = heroMediaUrl;
  } else if (req.body.hero_media_url) {
    // Keep existing URL if no new file uploaded
    keyValues.hero_media_url = req.body.hero_media_url;
  }

  await settingsRepo.upsertMany(keyValues);
  req.session.flash_success = 'Settings saved.';
  res.redirect('/admin/settings');
});

// --- Payments list ---
router.get('/payments', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const { payments, total } = await paymentRepo.listWithMembers({ limit, offset });
    const totalPages = Math.ceil(total / limit);
    res.render('admin/payments', { payments, page, totalPages, total });
  } catch (err) {
    next(err);
  }
});

router.get('/payments/export', async (req, res, next) => {
  try {
    const { toCsv } = require('../services/csv');
    const payments = await paymentRepo.listAllWithMembers();
    const columns = ['member_number', 'first_name', 'last_name', 'amount_cents', 'currency', 'status', 'payment_method', 'description', 'created_at'];
    const headers = ['Member Number', 'First Name', 'Last Name', 'Amount (cents)', 'Currency', 'Status', 'Payment Method', 'Description', 'Date'];
    const csv = toCsv(payments, columns, headers);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ysh-payments-${date}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// --- Email log ---
router.get('/emails', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const { emails, total } = await emailLogRepo.list({ limit, offset });
    const totalPages = Math.ceil(total / limit);
    res.render('admin/emails/log', { emails, page, totalPages, total });
  } catch (err) {
    next(err);
  }
});

// --- Renewal reminders ---
router.get('/emails/renewal', async (req, res, next) => {
  try {
    const renewalService = require('../services/renewal');
    const members = await renewalService.findMembersNeedingRenewal();
    const expiryDate = await settingsRepo.get('membership_expiry_date') || '';
    const daysBefore = await settingsRepo.get('renewal_reminder_days_before') || '30';
    res.render('admin/emails/renewal', {count: members.length, expiryDate, daysBefore});
  } catch (err) {
    next(err);
  }
});

router.post('/emails/renewal', async (req, res) => {
  try {
    const renewalService = require('../services/renewal');
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const result = await renewalService.sendBulkRenewalReminders(baseUrl);
    req.session.flash_success = `Renewal reminders sent: ${result.sent} sent, ${result.failed} failed (${result.total} eligible).`;
  } catch (e) {
    req.session.flash_error = 'Failed to send renewal reminders: ' + e.message;
  }
  res.redirect('/admin/emails');
});

// --- Email blast ---
router.get('/emails/blast', async (req, res, next) => {
  try {
    const activeCount = await memberRepo.countActive();
    res.render('admin/emails/blast', { activeCount });
  } catch (err) {
    next(err);
  }
});

router.post('/emails/blast', async (req, res) => {
  const { subject, body_html } = req.body;
  if (!subject || !body_html) {
    req.session.flash_error = 'Subject and body are required.';
    return res.redirect('/admin/emails/blast');
  }
  try {
    const emailService = require('../services/email');
    const members = await memberRepo.listActiveMembers();
    let sent = 0;
    for (const member of members) {
      try {
        await emailService.sendBlastEmail(member, subject, body_html);
        sent++;
      } catch (e) {
        (req.logger || logger).error('Blast email failed', {
          error: e.message,
          memberId: member.id,
          email: member.email
        });
      }
    }
    (req.logger || logger).info('Email blast completed', {sent, total: members.length, subject});
    req.session.flash_success = `Blast sent to ${sent} of ${members.length} members.`;
  } catch (e) {
    (req.logger || logger).error('Email blast failed', {error: e.message, stack: e.stack});
    req.session.flash_error = 'Blast failed: ' + e.message;
  }
  res.redirect('/admin/emails');
});

// --- Audit log (super_admin only) ---
router.get('/audit', requireSuperAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;
    const tableName = req.query.table || '';
    const {rows, total} = await auditLogRepo.list({limit, offset, tableName: tableName || undefined});
    const totalPages = Math.ceil(total / limit);
    const tables = ['members', 'payments', 'announcements', 'bios', 'gallery_images', 'site_settings', 'emails_log', 'membership_cards'];
    res.render('admin/audit', {rows, page, totalPages, total, tableName, tables});
  } catch (err) {
    next(err);
  }
});

// --- Admin management (super_admin only) ---
router.get('/admins', requireSuperAdmin, async (req, res, next) => {
  try {
    const admins = await adminService.listAdmins();
    res.render('admin/admins', { admins });
  } catch (err) {
    next(err);
  }
});

router.post('/admins', requireSuperAdmin, async (req, res) => {
  const { email, first_name, last_name, role } = req.body;

  if (!email || !first_name || !last_name) {
    req.session.flash_error = 'Email, first name, and last name are required.';
    return res.redirect('/admin/admins');
  }

  try {
    await adminService.addAdmin({ email, first_name, last_name, role });
    req.session.flash_success = `Admin ${first_name} ${last_name} added.`;
  } catch (e) {
    req.session.flash_error = e.message;
  }
  res.redirect('/admin/admins');
});

router.post('/admins/:id/delete', requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.adminId) {
    req.session.flash_error = 'You cannot demote your own account.';
    return res.redirect('/admin/admins');
  }
  await adminService.demoteAdmin(id);
  req.session.flash_success = 'Admin demoted.';
  res.redirect('/admin/admins');
});

module.exports = router;
