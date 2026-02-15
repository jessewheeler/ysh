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

  const admin = authService.findAdminByEmail(email.trim().toLowerCase());

  // Always show generic message to prevent enumeration
  req.session.flash_success = 'If that email is registered, a login code has been sent.';

  if (admin) {
    const otp = await authService.generateAndStoreOtp(admin.id);

    if (isDevOrTest) {
      console.log(`DEV OTP for ${admin.email}: ${otp}`);
    } else {
      try {
        const emailService = require('../services/email');
        await emailService.sendOtpEmail({ to: admin.email, toName: `${admin.first_name} ${admin.last_name}`, otp });
      } catch (e) {
        console.error('OTP email error:', e);
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

  const admin = authService.findAdminByEmail(email);
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

  const admin = authService.findAdminByEmail(email);

  if (admin) {
    const otp = await authService.generateAndStoreOtp(admin.id);

    if (isDevOrTest) {
      console.log(`DEV OTP for ${admin.email}: ${otp}`);
    } else {
      try {
        const emailService = require('../services/email');
        await emailService.sendOtpEmail({ to: admin.email, toName: `${admin.first_name} ${admin.last_name}`, otp });
      } catch (e) {
        console.error('OTP resend error:', e);
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
router.get('/dashboard', (req, res) => {
  const stats = dashboardService.getStats();
  const { recentMembers, recentPayments } = dashboardService.getRecentActivity();

  res.render('admin/dashboard', {
    stats,
    recentMembers,
    recentPayments,
  });
});

// --- Members CRUD ---
router.get('/members', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';

  const { members, total } = memberRepo.search({ search, limit, offset });
  const totalPages = Math.ceil(total / limit);

  res.render('admin/members/list', { members, page, totalPages, search, total });
});

router.get('/members/export', (req, res) => {
  const { toCsv } = require('../services/csv');
  const members = memberRepo.listAll();
  const columns = ['member_number', 'first_name', 'last_name', 'email', 'phone', 'address_street', 'address_city', 'address_state', 'address_zip', 'membership_year', 'status', 'notes', 'created_at'];
  const headers = ['Member Number', 'First Name', 'Last Name', 'Email', 'Phone', 'Street', 'City', 'State', 'Zip', 'Year', 'Status', 'Notes', 'Created'];
  const csv = toCsv(members, columns, headers);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="ysh-members-${date}.csv"`);
  res.send(csv);
});

router.get('/members/new', (req, res) => {
  res.render('admin/members/form', { member: null });
});

router.post('/members', (req, res) => {
  const { first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, status, notes } = req.body;

  // Generate member number
  const year = membership_year || new Date().getFullYear();
  const { generateMemberNumber } = require('../services/members');
  const member_number = generateMemberNumber(year);

  try {
    memberRepo.create({
      member_number, first_name, last_name, email, phone,
      address_street, address_city, address_state, address_zip,
      membership_year: year, status: status || 'pending', notes,
    });

    req.session.flash_success = `Member ${first_name} ${last_name} created.`;
  } catch (e) {
    req.session.flash_error = e.message.includes('UNIQUE') ? 'A member with that email already exists.' : e.message;
    return res.redirect('/admin/members/new');
  }
  res.redirect('/admin/members');
});

router.get('/members/:id', (req, res) => {
  const member = memberRepo.findById(req.params.id);
  if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }

  if (req.query.edit) {
    return res.render('admin/members/form', { member });
  }
  
  const payments = paymentRepo.findByMemberId(member.id);
  const cards = cardsRepo.findByMemberId(member.id);
  const emails = emailLogRepo.listByMemberId(member.id, 10);

  res.render('admin/members/view', { member, payments, cards, emails });
});

router.post('/members/:id', (req, res) => {
  const { first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, status, notes } = req.body;
  try {
    memberRepo.update(req.params.id, {
      first_name, last_name, email, phone,
      address_street, address_city, address_state, address_zip,
      membership_year, status, notes,
    });
    req.session.flash_success = 'Member updated.';
  } catch (e) {
    req.session.flash_error = e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

router.post('/members/:id/delete', (req, res) => {
  memberRepo.deleteById(req.params.id);
  req.session.flash_success = 'Member deleted.';
  res.redirect('/admin/members');
});

// --- Member Card Generation ---
router.post('/members/:id/card', async (req, res) => {
  const member = memberRepo.findById(req.params.id);
  if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }
  try {
    const { generatePDF, generatePNG } = require('../services/card');
    await generatePDF(member);
    await generatePNG(member);
    req.session.flash_success = 'Membership card generated.';
  } catch (e) {
    console.error('Card gen error:', e);
    req.session.flash_error = 'Card generation failed: ' + e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

router.get('/members/:id/card/pdf', (req, res) => {
  const card = cardsRepo.findLatestByMemberId(req.params.id);
  if (!card || !card.pdf_path) { req.session.flash_error = 'No card found.'; return res.redirect(`/admin/members/${req.params.id}`); }
  res.download(path.join(__dirname, '..', card.pdf_path));
});

router.get('/members/:id/card/png', (req, res) => {
  const card = cardsRepo.findLatestByMemberId(req.params.id);
  if (!card || !card.png_path) { req.session.flash_error = 'No card found.'; return res.redirect(`/admin/members/${req.params.id}`); }
  res.download(path.join(__dirname, '..', card.png_path));
});

router.post('/members/:id/email-card', async (req, res) => {
  const member = memberRepo.findById(req.params.id);
  if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }
  try {
    const emailService = require('../services/email');
    await emailService.sendCardEmail(member);
    req.session.flash_success = 'Card emailed to member.';
  } catch (e) {
    console.error('Email card error:', e);
    req.session.flash_error = 'Failed to email card: ' + e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Offline Payment ---
router.post('/members/:id/payments', (req, res) => {
  const member = memberRepo.findById(req.params.id);
  if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }

  const { amount, payment_method, description, activate_member } = req.body;
  const dollars = parseFloat(amount);
  if (!amount || isNaN(dollars) || dollars <= 0) {
    req.session.flash_error = 'A valid payment amount is required.';
    return res.redirect(`/admin/members/${req.params.id}`);
  }

  const amountCents = Math.round(dollars * 100);
  paymentsService.recordOfflinePayment({
    memberId: member.id,
    amountCents,
    paymentMethod: payment_method,
    description,
    activateMember: activate_member === 'on' && member.status !== 'active',
  });

  req.session.flash_success = `Payment of $${dollars.toFixed(2)} recorded.`;
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Announcements CRUD ---
router.get('/announcements', (req, res) => {
  const announcements = contentService.listAnnouncements();
  res.render('admin/announcements/list', { announcements });
});

router.get('/announcements/new', (req, res) => {
  res.render('admin/announcements/form', { announcement: null });
});

router.post('/announcements', async (req, res) => {
  const { title, body, link_url, link_text, is_published, sort_order } = req.body;
  const image_path = req.file ? await handleUpload(req.file, 'announcements') : (req.body.existing_image || null);
  contentService.createAnnouncement({ title, body, image_path, link_url, link_text, is_published, sort_order });
  req.session.flash_success = 'Announcement created.';
  res.redirect('/admin/announcements');
});

router.get('/announcements/:id', (req, res) => {
  const announcement = contentService.getAnnouncement(req.params.id);
  if (!announcement) { req.session.flash_error = 'Not found.'; return res.redirect('/admin/announcements'); }
  res.render('admin/announcements/form', { announcement });
});

router.post('/announcements/:id', async (req, res) => {
  const { title, body, link_url, link_text, is_published, sort_order } = req.body;
  const existingImagePath = contentService.getAnnouncementImagePath(req.params.id);
  let image_path;
  if (req.file) {
    image_path = await handleUpload(req.file, 'announcements');
    storage.deleteFile(existingImagePath).catch(() => {});
  } else {
    image_path = req.body.existing_image || existingImagePath || null;
  }
  contentService.updateAnnouncement(req.params.id, { title, body, image_path, link_url, link_text, is_published, sort_order });
  req.session.flash_success = 'Announcement updated.';
  res.redirect('/admin/announcements');
});

router.post('/announcements/:id/delete', async (req, res) => {
  await contentService.deleteAnnouncement(req.params.id);
  req.session.flash_success = 'Announcement deleted.';
  res.redirect('/admin/announcements');
});

// --- Gallery CRUD ---
router.get('/gallery', (req, res) => {
  const images = contentService.listGalleryImages();
  res.render('admin/gallery/list', { images });
});

router.get('/gallery/new', (req, res) => {
  res.render('admin/gallery/form', { image: null });
});

router.post('/gallery', async (req, res) => {
  const { alt_text, caption, sort_order, is_visible } = req.body;
  const filename = req.file ? await handleUpload(req.file, 'gallery') : (req.body.existing_image || '');
  if (!filename) { req.session.flash_error = 'Image file is required.'; return res.redirect('/admin/gallery/new'); }
  contentService.createGalleryImage({ filename, alt_text, caption, sort_order, is_visible });
  req.session.flash_success = 'Image added.';
  res.redirect('/admin/gallery');
});

router.get('/gallery/:id', (req, res) => {
  const image = contentService.getGalleryImage(req.params.id);
  if (!image) { req.session.flash_error = 'Not found.'; return res.redirect('/admin/gallery'); }
  res.render('admin/gallery/form', { image });
});

router.post('/gallery/:id', async (req, res) => {
  const { alt_text, caption, sort_order, is_visible } = req.body;
  const existingFilename = contentService.getGalleryFilename(req.params.id);
  let filename;
  if (req.file) {
    filename = await handleUpload(req.file, 'gallery');
    storage.deleteFile(existingFilename).catch(() => {});
  } else {
    filename = req.body.existing_image || existingFilename || '';
  }
  contentService.updateGalleryImage(req.params.id, { filename, alt_text, caption, sort_order, is_visible });
  req.session.flash_success = 'Image updated.';
  res.redirect('/admin/gallery');
});

router.post('/gallery/:id/delete', async (req, res) => {
  await contentService.deleteGalleryImage(req.params.id);
  req.session.flash_success = 'Image deleted.';
  res.redirect('/admin/gallery');
});

// --- Bios CRUD ---
router.get('/bios', (req, res) => {
  const bios = contentService.listBios();
  res.render('admin/bios/list', { bios });
});

router.get('/bios/new', (req, res) => {
  res.render('admin/bios/form', { bio: null });
});

router.post('/bios', async (req, res) => {
  const { name, role, bio_text, sort_order, is_visible } = req.body;
  const photo_path = req.file ? await handleUpload(req.file, 'bios') : (req.body.existing_photo || null);
  contentService.createBio({ name, role, bio_text, photo_path, sort_order, is_visible });
  req.session.flash_success = 'Bio created.';
  res.redirect('/admin/bios');
});

router.get('/bios/:id', (req, res) => {
  const bio = contentService.getBio(req.params.id);
  if (!bio) { req.session.flash_error = 'Not found.'; return res.redirect('/admin/bios'); }
  res.render('admin/bios/form', { bio });
});

router.post('/bios/:id', async (req, res) => {
  const { name, role, bio_text, sort_order, is_visible } = req.body;
  const existingPhotoPath = contentService.getBioPhotoPath(req.params.id);
  let photo_path;
  if (req.file) {
    photo_path = await handleUpload(req.file, 'bios');
    storage.deleteFile(existingPhotoPath).catch(() => {});
  } else {
    photo_path = req.body.existing_photo || existingPhotoPath || null;
  }
  contentService.updateBio(req.params.id, { name, role, bio_text, photo_path, sort_order, is_visible });
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

router.post('/settings', requireSuperAdmin, (req, res) => {
  const keys = [
    'hero_title', 'hero_subtitle', 'hero_button_text', 'hero_button_url',
    'about_quote', 'about_text', 'gallery_album_url', 'dues_amount_cents',
    'contact_email', 'stripe_publishable_key',
  ];
  const keyValues = {};
  for (const key of keys) {
    if (req.body[key] !== undefined) {
      keyValues[key] = req.body[key];
    }
  }
  settingsRepo.upsertMany(keyValues);
  req.session.flash_success = 'Settings saved.';
  res.redirect('/admin/settings');
});

// --- Payments list ---
router.get('/payments', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;
  const { payments, total } = paymentRepo.listWithMembers({ limit, offset });
  const totalPages = Math.ceil(total / limit);
  res.render('admin/payments', { payments, page, totalPages, total });
});

router.get('/payments/export', (req, res) => {
  const { toCsv } = require('../services/csv');
  const payments = paymentRepo.listAllWithMembers();
  const columns = ['member_number', 'first_name', 'last_name', 'amount_cents', 'currency', 'status', 'payment_method', 'description', 'created_at'];
  const headers = ['Member Number', 'First Name', 'Last Name', 'Amount (cents)', 'Currency', 'Status', 'Payment Method', 'Description', 'Date'];
  const csv = toCsv(payments, columns, headers);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="ysh-payments-${date}.csv"`);
  res.send(csv);
});

// --- Email log ---
router.get('/emails', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;
  const { emails, total } = emailLogRepo.list({ limit, offset });
  const totalPages = Math.ceil(total / limit);
  res.render('admin/emails/log', { emails, page, totalPages, total });
});

// --- Email blast ---
router.get('/emails/blast', (req, res) => {
  const activeCount = memberRepo.countActive();
  res.render('admin/emails/blast', { activeCount });
});

router.post('/emails/blast', async (req, res) => {
  const { subject, body_html } = req.body;
  if (!subject || !body_html) {
    req.session.flash_error = 'Subject and body are required.';
    return res.redirect('/admin/emails/blast');
  }
  try {
    const emailService = require('../services/email');
    const members = memberRepo.listActiveMembers();
    let sent = 0;
    for (const member of members) {
      try {
        await emailService.sendBlastEmail(member, subject, body_html);
        sent++;
      } catch (e) {
        console.error(`Blast email failed for ${member.email}:`, e.message);
      }
    }
    req.session.flash_success = `Blast sent to ${sent} of ${members.length} members.`;
  } catch (e) {
    req.session.flash_error = 'Blast failed: ' + e.message;
  }
  res.redirect('/admin/emails');
});

// --- Admin management (super_admin only) ---
router.get('/admins', requireSuperAdmin, (req, res) => {
  const admins = adminService.listAdmins();
  res.render('admin/admins', { admins });
});

router.post('/admins', requireSuperAdmin, (req, res) => {
  const { email, first_name, last_name, role } = req.body;

  if (!email || !first_name || !last_name) {
    req.session.flash_error = 'Email, first name, and last name are required.';
    return res.redirect('/admin/admins');
  }

  try {
    adminService.addAdmin({ email, first_name, last_name, role });
    req.session.flash_success = `Admin ${first_name} ${last_name} added.`;
  } catch (e) {
    req.session.flash_error = e.message;
  }
  res.redirect('/admin/admins');
});

router.post('/admins/:id/delete', requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.adminId) {
    req.session.flash_error = 'You cannot demote your own account.';
    return res.redirect('/admin/admins');
  }
  adminService.demoteAdmin(id);
  req.session.flash_success = 'Admin demoted.';
  res.redirect('/admin/admins');
});

module.exports = router;
