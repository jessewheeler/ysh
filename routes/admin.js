const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const storage = require('../services/storage');
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

  const admin = db.prepare('SELECT * FROM members WHERE email = ? AND role IS NOT NULL').get(email.trim().toLowerCase());

  // Always show generic message to prevent enumeration
  req.session.flash_success = 'If that email is registered, a login code has been sent.';

  if (admin) {
    const otp = isDevOrTest ? '000000' : String(crypto.randomInt(100000, 999999));
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    db.prepare(
      "UPDATE members SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(otpHash, expiresAt, admin.id);

    console.log(isDevOrTest);

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

  const admin = db.prepare('SELECT * FROM members WHERE email = ? AND role IS NOT NULL').get(email);

  if (!admin || !admin.otp_hash) {
    req.session.flash_error = 'Invalid or expired code.';
    return res.redirect('/admin/login/verify');
  }

  if (admin.otp_attempts >= 5) {
    req.session.flash_error = 'Too many attempts. Please request a new code.';
    return res.redirect('/admin/login/verify');
  }

  if (new Date(admin.otp_expires_at) < new Date()) {
    req.session.flash_error = 'Code has expired. Please request a new code.';
    return res.redirect('/admin/login/verify');
  }

  const match = await bcrypt.compare(code || '', admin.otp_hash);

  if (!match) {
    db.prepare(
      "UPDATE members SET otp_attempts = otp_attempts + 1, updated_at = datetime('now') WHERE id = ?"
    ).run(admin.id);
    req.session.flash_error = 'Invalid code.';
    return res.redirect('/admin/login/verify');
  }

  // Clear OTP fields
  db.prepare(
    "UPDATE members SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0, updated_at = datetime('now') WHERE id = ?"
  ).run(admin.id);

  req.session.adminId = admin.id;
  req.session.adminRole = admin.role;
  req.session.adminEmail = admin.email;
  delete req.session.otpEmail;

  delete req.session.returnTo;
  const returnTo = '/admin/dashboard';
  res.redirect(returnTo);
});

router.post('/login/resend', async (req, res) => {
  const email = req.session.otpEmail;
  if (!email) return res.redirect('/admin/login');

  const admin = db.prepare('SELECT * FROM members WHERE email = ? AND role IS NOT NULL').get(email);

  if (admin) {
    const otp = isDevOrTest ? '000000' : String(crypto.randomInt(100000, 999999));
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    db.prepare(
      "UPDATE members SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(otpHash, expiresAt, admin.id);

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
  const totalMembers = db.prepare('SELECT COUNT(*) as c FROM members').get().c;
  const activeMembers = db.prepare("SELECT COUNT(*) as c FROM members WHERE status = 'active'").get().c;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) as c FROM payments WHERE status = 'completed'").get().c;
  const emailsSent = db.prepare('SELECT COUNT(*) as c FROM emails_log').get().c;
  const recentMembers = db.prepare('SELECT * FROM members ORDER BY created_at DESC LIMIT 5').all();
  const recentPayments = db.prepare(
    `SELECT p.*, m.first_name, m.last_name, m.member_number
     FROM payments p LEFT JOIN members m ON p.member_id = m.id
     ORDER BY p.created_at DESC LIMIT 5`
  ).all();

  res.render('admin/dashboard', {
    stats: { totalMembers, activeMembers, totalRevenue, emailsSent },
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

  let where = '';
  let params = [];
  if (search) {
    where = "WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR member_number LIKE ?";
    const s = `%${search}%`;
    params = [s, s, s, s];
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM members ${where}`).get(...params).c;
  const members = db.prepare(`SELECT * FROM members ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const totalPages = Math.ceil(total / limit);

  res.render('admin/members/list', { members, page, totalPages, search, total });
});

router.get('/members/export', (req, res) => {
  const { toCsv } = require('../services/csv');
  const members = db.prepare('SELECT * FROM members ORDER BY created_at DESC').all();
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
  const count = db.prepare('SELECT COUNT(*) as c FROM members WHERE membership_year = ?').get(year).c;
  const member_number = `YSH-${year}-${String(count + 1).padStart(4, '0')}`;

  try {
    db.prepare(
      `INSERT INTO members (member_number, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(member_number, first_name, last_name, email, phone || null, address_street || null, address_city || null, address_state || null, address_zip || null, year, status || 'pending', notes || null);

    req.session.flash_success = `Member ${first_name} ${last_name} created.`;
  } catch (e) {
    req.session.flash_error = e.message.includes('UNIQUE') ? 'A member with that email already exists.' : e.message;
    return res.redirect('/admin/members/new');
  }
  res.redirect('/admin/members');
});

router.get('/members/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }

  const payments = db.prepare('SELECT * FROM payments WHERE member_id = ? ORDER BY created_at DESC').all(member.id);
  const cards = db.prepare('SELECT * FROM membership_cards WHERE member_id = ? ORDER BY created_at DESC').all(member.id);
  const emails = db.prepare('SELECT * FROM emails_log WHERE member_id = ? ORDER BY created_at DESC LIMIT 10').all(member.id);

  res.render('admin/members/view', { member, payments, cards, emails });
});

router.post('/members/:id', (req, res) => {
  const { first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, status, notes } = req.body;
  try {
    db.prepare(
      `UPDATE members SET first_name=?, last_name=?, email=?, phone=?, address_street=?, address_city=?, address_state=?, address_zip=?, membership_year=?, status=?, notes=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(first_name, last_name, email, phone || null, address_street || null, address_city || null, address_state || null, address_zip || null, membership_year, status, notes || null, req.params.id);
    req.session.flash_success = 'Member updated.';
  } catch (e) {
    req.session.flash_error = e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

router.post('/members/:id/delete', (req, res) => {
  db.prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
  req.session.flash_success = 'Member deleted.';
  res.redirect('/admin/members');
});

// --- Member Card Generation ---
router.post('/members/:id/card', async (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
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
  const card = db.prepare(
    'SELECT * FROM membership_cards WHERE member_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(req.params.id);
  if (!card || !card.pdf_path) { req.session.flash_error = 'No card found.'; return res.redirect(`/admin/members/${req.params.id}`); }
  const path = require('path');
  res.download(path.join(__dirname, '..', card.pdf_path));
});

router.get('/members/:id/card/png', (req, res) => {
  const card = db.prepare(
    'SELECT * FROM membership_cards WHERE member_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(req.params.id);
  if (!card || !card.png_path) { req.session.flash_error = 'No card found.'; return res.redirect(`/admin/members/${req.params.id}`); }
  const path = require('path');
  res.download(path.join(__dirname, '..', card.png_path));
});

router.post('/members/:id/email-card', async (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
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
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }

  const { amount, payment_method, description, activate_member } = req.body;
  const dollars = parseFloat(amount);
  if (!amount || isNaN(dollars) || dollars <= 0) {
    req.session.flash_error = 'A valid payment amount is required.';
    return res.redirect(`/admin/members/${req.params.id}`);
  }

  const amountCents = Math.round(dollars * 100);
  db.prepare(
    `INSERT INTO payments (member_id, amount_cents, currency, status, description, payment_method)
     VALUES (?, ?, 'usd', 'completed', ?, ?)`
  ).run(member.id, amountCents, description || 'Offline payment', payment_method || 'cash');

  if (activate_member === 'on' && member.status !== 'active') {
    const { activateMember } = require('../services/members');
    activateMember(member.id);
  }

  req.session.flash_success = `Payment of $${dollars.toFixed(2)} recorded.`;
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Announcements CRUD ---
router.get('/announcements', (req, res) => {
  const announcements = db.prepare('SELECT * FROM announcements ORDER BY sort_order ASC').all();
  res.render('admin/announcements/list', { announcements });
});

router.get('/announcements/new', (req, res) => {
  res.render('admin/announcements/form', { announcement: null });
});

router.post('/announcements', async (req, res) => {
  const { title, body, link_url, link_text, is_published, sort_order } = req.body;
  const image_path = req.file ? await handleUpload(req.file, 'announcements') : (req.body.existing_image || null);
  db.prepare(
    'INSERT INTO announcements (title, body, image_path, link_url, link_text, is_published, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(title, body || null, image_path, link_url || null, link_text || null, is_published ? 1 : 0, parseInt(sort_order) || 0);
  req.session.flash_success = 'Announcement created.';
  res.redirect('/admin/announcements');
});

router.get('/announcements/:id', (req, res) => {
  const announcement = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!announcement) { req.session.flash_error = 'Not found.'; return res.redirect('/admin/announcements'); }
  res.render('admin/announcements/form', { announcement });
});

router.post('/announcements/:id', async (req, res) => {
  const { title, body, link_url, link_text, is_published, sort_order } = req.body;
  const existing = db.prepare('SELECT image_path FROM announcements WHERE id = ?').get(req.params.id);
  let image_path;
  if (req.file) {
    image_path = await handleUpload(req.file, 'announcements');
    storage.deleteFile(existing?.image_path).catch(() => {});
  } else {
    image_path = req.body.existing_image || existing?.image_path || null;
  }
  db.prepare(
    `UPDATE announcements SET title=?, body=?, image_path=?, link_url=?, link_text=?, is_published=?, sort_order=?, updated_at=datetime('now') WHERE id=?`
  ).run(title, body || null, image_path, link_url || null, link_text || null, is_published ? 1 : 0, parseInt(sort_order) || 0, req.params.id);
  req.session.flash_success = 'Announcement updated.';
  res.redirect('/admin/announcements');
});

router.post('/announcements/:id/delete', async (req, res) => {
  const existing = db.prepare('SELECT image_path FROM announcements WHERE id = ?').get(req.params.id);
  storage.deleteFile(existing?.image_path).catch(() => {});
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  req.session.flash_success = 'Announcement deleted.';
  res.redirect('/admin/announcements');
});

// --- Gallery CRUD ---
router.get('/gallery', (req, res) => {
  const images = db.prepare('SELECT * FROM gallery_images ORDER BY sort_order ASC').all();
  res.render('admin/gallery/list', { images });
});

router.get('/gallery/new', (req, res) => {
  res.render('admin/gallery/form', { image: null });
});

router.post('/gallery', async (req, res) => {
  const { alt_text, caption, sort_order, is_visible } = req.body;
  const filename = req.file ? await handleUpload(req.file, 'gallery') : (req.body.existing_image || '');
  if (!filename) { req.session.flash_error = 'Image file is required.'; return res.redirect('/admin/gallery/new'); }
  db.prepare(
    'INSERT INTO gallery_images (filename, alt_text, caption, sort_order, is_visible) VALUES (?, ?, ?, ?, ?)'
  ).run(filename, alt_text || null, caption || null, parseInt(sort_order) || 0, is_visible ? 1 : 0);
  req.session.flash_success = 'Image added.';
  res.redirect('/admin/gallery');
});

router.get('/gallery/:id', (req, res) => {
  const image = db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(req.params.id);
  if (!image) { req.session.flash_error = 'Not found.'; return res.redirect('/admin/gallery'); }
  res.render('admin/gallery/form', { image });
});

router.post('/gallery/:id', async (req, res) => {
  const { alt_text, caption, sort_order, is_visible } = req.body;
  const existing = db.prepare('SELECT filename FROM gallery_images WHERE id = ?').get(req.params.id);
  let filename;
  if (req.file) {
    filename = await handleUpload(req.file, 'gallery');
    storage.deleteFile(existing?.filename).catch(() => {});
  } else {
    filename = req.body.existing_image || existing?.filename || '';
  }
  db.prepare(
    'UPDATE gallery_images SET filename=?, alt_text=?, caption=?, sort_order=?, is_visible=? WHERE id=?'
  ).run(filename, alt_text || null, caption || null, parseInt(sort_order) || 0, is_visible ? 1 : 0, req.params.id);
  req.session.flash_success = 'Image updated.';
  res.redirect('/admin/gallery');
});

router.post('/gallery/:id/delete', async (req, res) => {
  const existing = db.prepare('SELECT filename FROM gallery_images WHERE id = ?').get(req.params.id);
  storage.deleteFile(existing?.filename).catch(() => {});
  db.prepare('DELETE FROM gallery_images WHERE id = ?').run(req.params.id);
  req.session.flash_success = 'Image deleted.';
  res.redirect('/admin/gallery');
});

// --- Bios CRUD ---
router.get('/bios', (req, res) => {
  const bios = db.prepare('SELECT * FROM bios ORDER BY sort_order ASC').all();
  res.render('admin/bios/list', { bios });
});

router.get('/bios/new', (req, res) => {
  res.render('admin/bios/form', { bio: null });
});

router.post('/bios', async (req, res) => {
  const { name, role, bio_text, sort_order, is_visible } = req.body;
  const photo_path = req.file ? await handleUpload(req.file, 'bios') : (req.body.existing_photo || null);
  db.prepare(
    'INSERT INTO bios (name, role, bio_text, photo_path, sort_order, is_visible) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, role || null, bio_text || null, photo_path, parseInt(sort_order) || 0, is_visible ? 1 : 0);
  req.session.flash_success = 'Bio created.';
  res.redirect('/admin/bios');
});

router.get('/bios/:id', (req, res) => {
  const bio = db.prepare('SELECT * FROM bios WHERE id = ?').get(req.params.id);
  if (!bio) { req.session.flash_error = 'Not found.'; return res.redirect('/admin/bios'); }
  res.render('admin/bios/form', { bio });
});

router.post('/bios/:id', async (req, res) => {
  const { name, role, bio_text, sort_order, is_visible } = req.body;
  const existing = db.prepare('SELECT photo_path FROM bios WHERE id = ?').get(req.params.id);
  let photo_path;
  if (req.file) {
    photo_path = await handleUpload(req.file, 'bios');
    storage.deleteFile(existing?.photo_path).catch(() => {});
  } else {
    photo_path = req.body.existing_photo || existing?.photo_path || null;
  }
  db.prepare(
    `UPDATE bios SET name=?, role=?, bio_text=?, photo_path=?, sort_order=?, is_visible=?, updated_at=datetime('now') WHERE id=?`
  ).run(name, role || null, bio_text || null, photo_path, parseInt(sort_order) || 0, is_visible ? 1 : 0, req.params.id);
  req.session.flash_success = 'Bio updated.';
  res.redirect('/admin/bios');
});

router.post('/bios/:id/delete', async (req, res) => {
  const existing = db.prepare('SELECT photo_path FROM bios WHERE id = ?').get(req.params.id);
  storage.deleteFile(existing?.photo_path).catch(() => {});
  db.prepare('DELETE FROM bios WHERE id = ?').run(req.params.id);
  req.session.flash_success = 'Bio deleted.';
  res.redirect('/admin/bios');
});

// --- Settings (super_admin only) ---
router.get('/settings', requireSuperAdmin, (req, res) => {
  res.render('admin/settings');
});

router.post('/settings', requireSuperAdmin, (req, res) => {
  const upsert = db.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  );
  const keys = [
    'hero_title', 'hero_subtitle', 'hero_button_text', 'hero_button_url',
    'about_quote', 'about_text', 'gallery_album_url', 'dues_amount_cents',
    'contact_email', 'stripe_publishable_key',
  ];
  const txn = db.transaction(() => {
    for (const key of keys) {
      if (req.body[key] !== undefined) {
        upsert.run(key, req.body[key]);
      }
    }
  });
  txn();
  req.session.flash_success = 'Settings saved.';
  res.redirect('/admin/settings');
});

// --- Payments list ---
router.get('/payments', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;
  const total = db.prepare('SELECT COUNT(*) as c FROM payments').get().c;
  const payments = db.prepare(
    `SELECT p.*, m.first_name, m.last_name, m.member_number
     FROM payments p LEFT JOIN members m ON p.member_id = m.id
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);
  const totalPages = Math.ceil(total / limit);
  res.render('admin/payments', { payments, page, totalPages, total });
});

router.get('/payments/export', (req, res) => {
  const { toCsv } = require('../services/csv');
  const payments = db.prepare(
    `SELECT p.*, m.first_name, m.last_name, m.member_number
     FROM payments p LEFT JOIN members m ON p.member_id = m.id
     ORDER BY p.created_at DESC`
  ).all();
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
  const total = db.prepare('SELECT COUNT(*) as c FROM emails_log').get().c;
  const emails = db.prepare('SELECT * FROM emails_log ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  const totalPages = Math.ceil(total / limit);
  res.render('admin/emails/log', { emails, page, totalPages, total });
});

// --- Email blast ---
router.get('/emails/blast', (req, res) => {
  const activeCount = db.prepare("SELECT COUNT(*) as c FROM members WHERE status = 'active'").get().c;
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
    const members = db.prepare("SELECT * FROM members WHERE status = 'active'").all();
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
  const admins = db.prepare('SELECT id, email, first_name, last_name, role, created_at FROM members WHERE role IS NOT NULL ORDER BY created_at ASC').all();
  res.render('admin/admins', { admins });
});

router.post('/admins', requireSuperAdmin, (req, res) => {
  const { email, first_name, last_name, role } = req.body;

  if (!email || !first_name || !last_name) {
    req.session.flash_error = 'Email, first name, and last name are required.';
    return res.redirect('/admin/admins');
  }

  const adminRole = (role === 'super_admin') ? 'super_admin' : 'editor';
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const existing = db.prepare('SELECT id FROM members WHERE email = ?').get(normalizedEmail);
    if (existing) {
      db.prepare("UPDATE members SET role = ?, updated_at = datetime('now') WHERE id = ?").run(adminRole, existing.id);
    } else {
      db.prepare('INSERT INTO members (first_name, last_name, email, role) VALUES (?, ?, ?, ?)').run(
        first_name.trim(), last_name.trim(), normalizedEmail, adminRole
      );
    }
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
  db.prepare("UPDATE members SET role = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
  req.session.flash_success = 'Admin demoted.';
  res.redirect('/admin/admins');
});

module.exports = router;
