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
const activation = require('../services/activation');
const memberRepo = require('../db/repos/members');
const paymentRepo = require('../db/repos/payments');
const emailLogRepo = require('../db/repos/emailLog');
const cardsRepo = require('../db/repos/cards');
const settingsRepo = require('../db/repos/settings');
const auditLogRepo = require('../db/repos/auditLog');
const periodsRepo = require('../db/repos/membershipPeriods');
const membershipYearsRepo = require('../db/repos/membershipYears');
const membershipPeriodsService = require('../services/membershipPeriods');
const campaignsRepo = require('../db/repos/campaigns');
const campaignVisitsRepo = require('../db/repos/campaignVisits');
const contactSubmissionsRepo = require('../db/repos/contactSubmissions');
const campaignsService = require('../services/campaigns');
const attentionService = require('../services/attention');
const memberAttentionRepo = require('../db/repos/memberAttention');
const councilReport = require('../services/councilReport');
const eventsRepo = require('../db/repos/events');
const checkInsRepo = require('../db/repos/checkIns');
const eventsService = require('../services/events');
const checkInService = require('../services/checkIn');
const familyDowngrade = require('../services/familyDowngrade');
const archivedMembersRepo = require('../db/repos/archivedMembers');
const nflSchedule = require('../services/nflSchedule');
const logger = require('../services/logger');
const isDevOrTest = ['development', 'test', 'dev'].includes(process.env.NODE_ENV);

async function handleUpload(file, folder) {
  if (storage.isConfigured()) {
    return storage.uploadFile(file.buffer, file.originalname, folder);
  }
  const localName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`;
  // server.js mkdirs this at boot, but the write is what needs it: data/ is gitignored,
  // so anything that reaches here without booting the server (Jest, a CLI script) hit
  // ENOENT and reported it as an upload failure.
  const dir = path.join(__dirname, '..', 'data', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, localName), file.buffer);
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

    if (isDevOrTest || process.env.LOG_OTP === 'true') {
      logger.info('LOGIN OTP', {email: admin.email, otp});
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

  const returnTo = req.session.returnTo;
  delete req.session.returnTo;
  const safeReturnTo = (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) ? returnTo : '/admin/dashboard';
  res.redirect(safeReturnTo);
});

router.post('/login/resend', async (req, res) => {
  const email = req.session.otpEmail;
  if (!email) return res.redirect('/admin/login');

  const admin = await authService.findAdminByEmail(email);

  if (admin) {
    const otp = await authService.generateAndStoreOtp(admin.id);

    if (isDevOrTest || process.env.LOG_OTP === 'true') {
      logger.info('LOGIN OTP', {email: admin.email, otp});
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
const MEMBER_VIEWS = ['all', 'active', 'needs-renewal', 'recently-renewed', 'pending', 'lifetime', 'needs-attention'];
const MEMBER_SORTS = ['member_number', 'name', 'email', 'year', 'status', 'created_at'];
const MEMBER_STATUSES = ['active', 'expired', 'pending', 'cancelled'];
const MEMBER_SIGNALS = attentionService.SIGNAL_KEYS;

function parseMemberListQuery(req) {
  return {
    view: MEMBER_VIEWS.includes(req.query.view) ? req.query.view : 'all',
    sort: MEMBER_SORTS.includes(req.query.sort) ? req.query.sort : 'created_at',
    dir: req.query.dir === 'asc' ? 'asc' : 'desc',
    search: req.query.search || '',
    status: MEMBER_STATUSES.includes(req.query.status) ? req.query.status : '',
    periodId: parseInt(req.query.period) || null,
    signal: MEMBER_SIGNALS.includes(req.query.signal) ? req.query.signal : '',
  };
}

function memberListQs(state, overrides = {}) {
  const q = { ...state, ...overrides };
  const params = new URLSearchParams();
  if (q.view && q.view !== 'all') params.set('view', q.view);
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.period) params.set('period', q.period);
  if (q.signal) params.set('signal', q.signal);
  if (q.sort && q.sort !== 'created_at') params.set('sort', q.sort);
  if (q.dir && q.dir !== 'desc') params.set('dir', q.dir);
  if (q.page && q.page > 1) params.set('page', q.page);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Attaches the list of signals that fired to each member, for badges and CSV.
 * Only meaningful under the needs-attention view.
 */
async function attachAttentionSignals(members, attentionCtx) {
  if (!members.length) return;
  const byId = await memberAttentionRepo.signalsForIds(members.map(m => m.id), attentionCtx);
  for (const member of members) {
    member.attention_signals = byId.get(member.id) || [];
  }
}

router.get('/members', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const parsed = parseMemberListQuery(req);

    // The attention context carries the current period as well as the thresholds, so
    // it doubles as the view context for every other view.
    const attentionCtx = await attentionService.buildContext();
    const [{ members, total }, counts, periods] = await Promise.all([
      memberRepo.search({ ...parsed, ...attentionCtx, limit, offset }),
      memberRepo.countByView(attentionCtx),
      periodsRepo.list(),
    ]);
    const totalPages = Math.ceil(total / limit);

    const { view, sort, dir, search, status, periodId, signal } = parsed;
    if (view === 'needs-attention') {
      await attachAttentionSignals(members, { ...attentionCtx, signal });
    }

    res.render('admin/members/list', {
      members, page, totalPages, total,
      view, sort, dir, search, status, periodId, signal,
      counts, periods,
      signalOptions: attentionService.SIGNAL_LABELS,
      qs: (overrides) => memberListQs({ view, search, status, period: periodId, signal, sort, dir }, overrides),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/members/export', async (req, res, next) => {
  try {
    const { toCsv } = require('../services/csv');
    const parsed = parseMemberListQuery(req);
    const attentionCtx = await attentionService.buildContext();
    const { members } = await memberRepo.search({ ...parsed, ...attentionCtx });
    const columns = ['member_number', 'first_name', 'last_name', 'email', 'phone', 'address_street', 'address_city', 'address_state', 'address_zip', 'membership_year', 'status', 'notes', 'created_at'];
    const headers = ['Member Number', 'First Name', 'Last Name', 'Email', 'Phone', 'Street', 'City', 'State', 'Zip', 'Year', 'Status', 'Notes', 'Created'];

    // The whole point of this export is the outreach call list, so the signals have to
    // travel with it — a row without them tells the Coordinator nothing about why.
    if (parsed.view === 'needs-attention') {
      await attachAttentionSignals(members, { ...attentionCtx, signal: parsed.signal });
      for (const member of members) {
        member.attention_signal_labels = member.attention_signals.map(s => s.label).join('; ');
      }
      columns.push('attention_signal_labels');
      headers.push('Signals');
    }

    const csv = toCsv(members, columns, headers);
    const date = new Date().toISOString().slice(0, 10);
    const viewPart = parsed.view !== 'all' ? `${parsed.view}-` : '';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ysh-members-${viewPart}${date}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// --- Reports: Sea Hawkers Central Council membership report ---

/**
 * Gathers everything the Council report needs for a period, plus the defaults the
 * report form is prefilled with. Shared by the preview page and the download.
 */
async function collectCouncilReportData(req) {
  const periods = await periodsRepo.list();
  const requestedId = parseInt(req.query.period, 10);
  const period = Number.isInteger(requestedId)
    ? await periodsRepo.get(requestedId)
    : await periodsRepo.getCurrent();

  const [members, bios] = await Promise.all([
    period ? membershipYearsRepo.listMembersByPeriod(period.id) : Promise.resolve([]),
    // Visible bios only — the same set the public Bios page shows as the current board.
    contentService.listVisibleBios(),
  ]);
  const { board, warnings } = councilReport.resolveBoard(bios);

  const admin = req.session.adminId ? await memberRepo.findById(req.session.adminId) : null;
  const adminName = admin ? `${admin.first_name} ${admin.last_name}`.trim() : (req.session.adminEmail || '');

  return {
    periods,
    period,
    members,
    board,
    warnings: [...warnings, ...councilReport.memberWarnings(members)],
    chapterName: req.query.chapter_name || councilReport.DEFAULT_CHAPTER_NAME,
    monthYearEnding: req.query.month_year || councilReport.monthYearEndingFrom(period && period.end_date),
    submittedBy: req.query.submitted_by || adminName,
    reportFilename: req.query.filename || councilReport.defaultFilename(period && period.end_date),
  };
}

router.get('/reports/membership', async (req, res, next) => {
  try {
    const data = await collectCouncilReportData(req);
    res.render('admin/reports/membership', {
      ...data,
      social: councilReport.SOCIAL,
      boardCapacity: councilReport.BOARD_ROWS,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/reports/membership/download', async (req, res, next) => {
  try {
    const data = await collectCouncilReportData(req);
    const buffer = await councilReport.buildWorkbook({
      chapterName: data.chapterName,
      monthYearEnding: data.monthYearEnding,
      submittedBy: data.submittedBy,
      board: data.board,
      members: data.members,
    });
    const filename = councilReport.sanitizeFilename(data.reportFilename);
    res.setHeader('Content-Type', councilReport.CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// --- Archived family members (issue #107) ---
// Registered ahead of /members/:id, which would otherwise take "archived" as an id.
router.get('/members/archived', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const archived = await archivedMembersRepo.search({ q: q || undefined });
    res.render('admin/members/archived', { archived, q });
  } catch (err) {
    next(err);
  }
});

// Suggestions for the Add Family Member form, keyed on what has been typed as a last name.
router.get('/members/archived/search', async (req, res, next) => {
  try {
    const lastName = (req.query.last_name || '').trim();
    if (lastName.length < 2) return res.json([]);
    const rows = await archivedMembersRepo.search({ lastName, limit: 10 });
    res.json(rows.map(r => ({
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      join_date: r.join_date,
      member_numbers: r.member_numbers,
    })));
  } catch (err) {
    next(err);
  }
});

router.post('/members/archived/:id/restore', async (req, res) => {
  try {
    const member = await familyDowngrade.restoreFromArchive(req.params.id, { email: req.body.email });
    await require('../services/sender').syncMemberSafe(member.id);
    req.session.flash_success = `${member.first_name} ${member.last_name} restored as ${member.member_number}. Record a payment or send a renewal link to activate them.`;
    return res.redirect(`/admin/members/${member.id}`);
  } catch (e) {
    (req.logger || logger).warn('Archive restore refused', { archivedId: req.params.id, error: e.message });
    req.session.flash_error = e.message;
    req.session.flash_reopen = `restore-${req.params.id}`;
    const q = (req.body.q || '').trim();
    return res.redirect(`/admin/members/archived${q ? `?q=${encodeURIComponent(q)}` : ''}`);
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

      // Activate all members if status is active. Goes through the activation service so
      // an admin-created active family lands with the same expiry, membership year and
      // period enrollment a paid signup gets. No cards or email — nobody paid here.
      const primaryRecord = await memberRepo.findByEmail(email);
      if (status === 'active' && primaryRecord) {
        await activation.activateForPeriod({
          memberId: primaryRecord.id,
          period: await periodsRepo.getCurrent(),
          membershipYear: year,
        });
      }

      // Sender only ever sees the primary here — family members share their email.
      if (primaryRecord) {
        await require('../services/sender').syncMemberSafe(primaryRecord.id);
      }

      const count = familyMembers.length + 1;
      req.session.flash_success = `Family membership created: ${first_name} ${last_name} + ${familyMembers.length} family member(s) (${count} total).`;
    } else {
      // Create individual member
      const { generateMemberNumber } = require('../services/members');
      const member_number = await generateMemberNumber(year);

      const created = await memberRepo.create({
        member_number, first_name, last_name, email, phone,
        address_street, address_city, address_state, address_zip,
        membership_year: year, join_date: normalizedJoinDate, status: status || 'pending',
        is_lifetime: req.body.is_lifetime === 'on', notes,
      });

      if (status === 'active') {
        await activation.activateForPeriod({
          memberId: created.lastInsertRowid,
          period: await periodsRepo.getCurrent(),
          membershipYear: year,
        });
      }

      await require('../services/sender').syncMemberSafe(created.lastInsertRowid);

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

    const [payments, cards, emails, membershipYears] = await Promise.all([
      paymentRepo.findByMemberId(member.id),
      cardsRepo.findByMemberId(member.id),
      emailLogRepo.listByMemberId(member.id, 10),
      membershipYearsRepo.findByMember(member.id)
    ]);

    // Get family relationships
    let familyMembers = [];
    let primaryMember = null;
    let familyPrimaries = [];

    if (member.membership_type === 'family') {
      if (member.primary_member_id) {
        // This is a family member
        primaryMember = await memberRepo.findById(member.primary_member_id);
        const allFamily = await memberRepo.findFamilyMembers(member.primary_member_id);
        familyMembers = allFamily.filter(fm => fm.id !== member.id);
      } else {
        // This is a primary member — annotate each family member with conflict info
        const raw = await memberRepo.findFamilyMembers(member.id);
        familyMembers = await Promise.all(raw.map(async (fm) => ({
          ...fm,
          wouldDeleteOnRemove: await memberRepo.emailConflictsWithPrimary(fm.email, fm.id),
        })));
      }
    }

    if (member.membership_type !== 'family' && !member.primary_member_id) {
      familyPrimaries = await memberRepo.listFamilyPrimaries();
    }

    // Prefills the offline-payment amount. duesForType returns undefined when a period
    // has no dues set for the type, and centsToDollars(undefined) yields the string
    // "NaN" — which would render as value="NaN" and fail number validation silently.
    const currentPeriod = await periodsRepo.getCurrent();
    // Offers a Check in button when there's a game-day event today.
    const [checkInEvent] = await eventsRepo.listOnDate(eventsService.localDate());
    const {duesForType, centsToDollars} = membershipPeriodsService;
    const duesCents = currentPeriod
        ? duesForType(currentPeriod, member.membership_type)
        : null;
    const defaultPaymentDollars = Number.isFinite(duesCents)
        ? centsToDollars(duesCents)
        : '';

    res.render('admin/members/view', {
      member,
      payments,
      cards,
      emails,
      membershipYears,
      familyMembers,
      primaryMember,
      familyPrimaries,
      currentPeriod,
      defaultPaymentDollars,
      voidReasons: paymentsService.VOID_REASONS,
      checkInEvent: checkInEvent || null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/members/:id', async (req, res) => {
  const { first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, join_date, status, notes } = req.body;
  const normalizedJoinDate = join_date?.trim() || undefined;
  try {
    const before = await memberRepo.findById(req.params.id);
    await memberRepo.update(req.params.id, {
      first_name, last_name, email, phone,
      address_street, address_city, address_state, address_zip,
      membership_year, join_date: normalizedJoinDate, status,
      is_lifetime: req.body.is_lifetime === 'on', notes,
    });
    // Flipping the status field to active is an activation like any other: stamp the
    // current period on the member and their family. Only on the transition, so editing
    // an already-active member's phone number doesn't silently re-date their membership.
    // Data only — an edit is not a payment, so no cards and no welcome email.
    if (status === 'active' && before && before.status !== 'active') {
      await activation.activateForPeriod({
        memberId: req.params.id,
        period: await periodsRepo.getCurrent(),
        clearRenewalToken: false,
        membershipYear: membership_year || null,
      });
    }
    // Propagate status/name changes to Sender. Logs and swallows any Sender failure.
    await require('../services/sender').syncMemberSafe(req.params.id);
    req.session.flash_success = 'Member updated.';
  } catch (e) {
    req.session.flash_error = e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

router.post('/members/:id/delete', async (req, res) => {
  if (parseInt(req.params.id) === req.session.adminId) {
    req.session.flash_error = 'You cannot delete your own account while logged in.';
    return res.redirect(`/admin/members/${req.params.id}`);
  }
  const doomed = await memberRepo.findById(req.params.id);
  await memberRepo.deleteById(req.params.id);
  // Drop the address from both Sender groups unless another member still holds it —
  // otherwise a deleted member keeps receiving newsletters, and no later sync can fix
  // it because syncAllMembers only ever sees members who still exist.
  if (doomed) await require('../services/sender').syncEmailSafe(doomed.email);
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
  const member = await memberRepo.findById(req.params.id);
  if (!member) {
    req.session.flash_error = 'Member not found.';
    return res.redirect('/admin/members');
  }
  const card = await cardsRepo.findByMemberAndYear(member.id, member.membership_year)
    || await cardsRepo.findLatestByMemberId(req.params.id);
  if (!card || !card.pdf_path) { req.session.flash_error = 'No card found.'; return res.redirect(`/admin/members/${req.params.id}`); }
  const filename = `YSH-${member.first_name}-${member.last_name}-${card.year || 'card'}.pdf`;
  if (card.pdf_path.startsWith('http')) {
    const resp = await fetch(card.pdf_path);
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  }
  const cardsDir = path.resolve(__dirname, '..', 'data', 'cards');
  const resolved = path.resolve(__dirname, '..', card.pdf_path);
  if (!resolved.startsWith(cardsDir + path.sep) && resolved !== cardsDir) {
    return res.status(403).send('Invalid file path');
  }
  res.download(resolved, filename, (err) => {
    if (err && err.code === 'ENOENT') {
      req.session.flash_error = 'Card file not found on disk — please regenerate the card.';
      res.redirect(`/admin/members/${req.params.id}`);
    }
  });
});

router.get('/members/:id/card/png', async (req, res) => {
  const member = await memberRepo.findById(req.params.id);
  if (!member) {
    req.session.flash_error = 'Member not found.';
    return res.redirect('/admin/members');
  }
  const card = await cardsRepo.findByMemberAndYear(member.id, member.membership_year)
    || await cardsRepo.findLatestByMemberId(req.params.id);
  if (!card || !card.png_path) { req.session.flash_error = 'No card found.'; return res.redirect(`/admin/members/${req.params.id}`); }
  const filename = `YSH-${member.first_name}-${member.last_name}-${card.year || 'card'}.png`;
  if (card.png_path.startsWith('http')) {
    const resp = await fetch(card.png_path);
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  }
  const cardsDir = path.resolve(__dirname, '..', 'data', 'cards');
  const resolved = path.resolve(__dirname, '..', card.png_path);
  if (!resolved.startsWith(cardsDir + path.sep) && resolved !== cardsDir) {
    return res.status(403).send('Invalid file path');
  }
  res.download(resolved, filename, (err) => {
    if (err && err.code === 'ENOENT') {
      req.session.flash_error = 'Card file not found on disk — please regenerate the card.';
      res.redirect(`/admin/members/${req.params.id}`);
    }
  });
});

router.post('/members/:id/email-card', async (req, res) => {
  const member = await memberRepo.findById(req.params.id);
  if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }
  try {
    const emailService = require('../services/email');
    await emailService.sendCardEmail(member);
    (req.logger || logger).info('Card emailed', {memberId: member.id});
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
    (req.logger || logger).info('Renewal reminder sent', {memberId: member.id});
    req.session.flash_success = `Renewal reminder sent to ${member.email}.`;
  } catch (e) {
    (req.logger || logger).error('Renewal reminder failed', {error: e.message, stack: e.stack, memberId: member.id});
    req.session.flash_error = 'Failed to send renewal reminder: ' + e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Generate Renewal Link ---
// Same token step as send-renewal, but hands the link back to the admin instead of emailing it —
// for the member whose email is bouncing or who is on the phone right now.
router.post('/members/:id/renewal-link', async (req, res) => {
  const member = await memberRepo.findById(req.params.id);
  if (!member) {
    req.session.flash_error = 'Member not found.';
    return res.redirect('/admin/members');
  }
  try {
    const renewalService = require('../services/renewal');
    const token = await renewalService.generateRenewalToken(member.id);
    // generateRenewalToken returns only the token; re-read for the expiry it just wrote.
    const updated = await memberRepo.findById(member.id);
    req.session.flash_renewal_link = {
      url: `${campaignsService.resolveBaseUrl()}/renew/${token}`,
      expiresAt: updated.renewal_token_expires_at,
    };
    (req.logger || logger).info('Renewal link generated', {memberId: member.id});
    req.session.flash_success = `Renewal link generated for ${member.first_name} ${member.last_name}.`;
  } catch (e) {
    (req.logger || logger).error('Renewal link generation failed', {error: e.message, stack: e.stack, memberId: member.id});
    req.session.flash_error = 'Failed to generate renewal link: ' + e.message;
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
    req.session.flash_reopen = 'record-payment';
    return res.redirect(`/admin/members/${req.params.id}`);
  }

  const amountCents = Math.round(dollars * 100);
  const method = payment_method || 'cash';

  // The submit button disables itself on the first click, but that is a convenience, not a
  // defense: a refresh or a slow network posts twice regardless, and with Activate ticked
  // each post re-ran activation and mailed a second welcome and receipt. An identical
  // payment recorded within the last minute is the same one arriving again.
  if (await paymentsService.isRecentOfflineDuplicate({ memberId: member.id, amountCents, paymentMethod: method })) {
    (req.logger || logger).warn('Duplicate offline payment ignored', { memberId: member.id, amountCents, paymentMethod: method });
    req.session.flash_error = `A ${method} payment of $${dollars.toFixed(2)} was recorded for this member less than a minute ago, so this one was not recorded again. If it really is a second payment, wait a minute and record it again.`;
    return res.redirect(`/admin/members/${req.params.id}`);
  }

  // Deliberately not gated on the member's current status: a renewal paid by an
  // already-active member still has to move them onto the new period, which is what the
  // old `member.status !== 'active'` guard silently skipped.
  const isActivating = activate_member === 'on';
  const paymentId = await paymentsService.recordOfflinePayment({
    memberId: member.id,
    amountCents,
    paymentMethod: payment_method,
    description,
  });

  (req.logger || logger).info('Offline payment recorded', {
    memberId: member.id,
    amountCents,
    paymentMethod: method,
    activating: isActivating,
  });

  const currentPeriod = isActivating ? await periodsRepo.getCurrent() : null;

  if (isActivating && !currentPeriod) {
    // Activating with nowhere to activate them *to* would leave a member marked active
    // with no expiry, no year and no enrollment, and would mail them a welcome carrying
    // last season's card. Keep the payment, refuse the activation, and say why.
    req.session.flash_error = 'Payment recorded, but the member was not activated: no membership period is currently open, so no expiry date or membership year could be set. Create a period under Membership Periods, then record the activation.';
    await require('../services/sender').syncMemberSafe(member.primary_member_id || member.id);
  } else if (isActivating) {
    const { primary, members } = await activation.activateForPeriod({
      memberId: member.id,
      period: currentPeriod,
      paymentId,
    });
    await activation.deliverActivation({ primary, members, receipt: { amount_total: amountCents } });

    (req.logger || logger).info('Member activated via offline payment', {
      memberId: member.id,
      memberNumber: member.member_number,
      periodId: currentPeriod.id,
      membersActivated: members.length,
    });
  } else {
    // Sync even without an activation: the payment itself is worth reflecting, and
    // deliverActivation already handles the sync on the activating branch. Family
    // sub-members share the primary's email, so the primary is what Sender sees.
    await require('../services/sender').syncMemberSafe(member.primary_member_id || member.id);
  }

  req.session.flash_success = `Payment of $${dollars.toFixed(2)} recorded.`;
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Void a mistaken offline payment (issue #108) ---
// Super-admin only: this changes what the dashboard and the CSV report as money taken.
// A soft delete — the row stays as 'voided' with the reason, so the audit trail and any
// membership_years citation survive. Stripe rows are refused in the service.
router.post('/members/:memberId/payments/:id/void', requireSuperAdmin, async (req, res) => {
  const member = await memberRepo.findById(req.params.memberId);
  if (!member) { req.session.flash_error = 'Member not found.'; return res.redirect('/admin/members'); }

  const { void_reason, void_note } = req.body;
  try {
    const voided = await paymentsService.voidPayment({
      paymentId: req.params.id,
      memberId: member.id,
      reason: void_reason,
      note: void_note,
    });
    (req.logger || logger).info('Payment voided', {
      paymentId: voided.id,
      memberId: member.id,
      amountCents: voided.amount_cents,
      reason: voided.void_reason,
    });
    req.session.flash_success = `Payment of $${(voided.amount_cents / 100).toFixed(2)} voided (${voided.void_reason}).`;
  } catch (e) {
    (req.logger || logger).warn('Payment void refused', { paymentId: req.params.id, memberId: member.id, error: e.message });
    req.session.flash_error = e.message;
    req.session.flash_reopen = `void-payment-${req.params.id}`;
  }
  res.redirect(`/admin/members/${member.id}`);
});

// --- Upgrade individual membership to family ---
router.post('/members/:id/upgrade-to-family', async (req, res) => {
  const member = await memberRepo.findById(req.params.id);
  if (!member) {
    req.session.flash_error = 'Member not found.';
    return res.redirect('/admin/members');
  }
  if (member.primary_member_id) {
    req.session.flash_error = 'Cannot upgrade a family sub-member — upgrade the primary account holder.';
    return res.redirect(`/admin/members/${req.params.id}`);
  }
  if (member.membership_type === 'family') {
    req.session.flash_error = 'Membership is already a family type.';
    return res.redirect(`/admin/members/${req.params.id}`);
  }
  try {
    await memberRepo.upgradeMembershipType(req.params.id, 'family');
    await require('../services/sender').syncMemberSafe(req.params.id);
    req.session.flash_success = `${member.first_name} ${member.last_name}'s membership upgraded to family.`;
  } catch (e) {
    req.session.flash_error = e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Downgrade family membership to individual ---
router.post('/members/:id/downgrade-to-individual', async (req, res) => {
  try {
    const { primary, detached, archived } = await familyDowngrade.downgradeToIndividual(req.params.id);
    const senderService = require('../services/sender');
    // After the commit: detached members are primaries in their own right now. Archived
    // people shared the primary's address, so the primary's sync covers them.
    await senderService.syncMemberSafe(primary.id);
    for (const fm of detached) await senderService.syncMemberSafe(fm.id);

    const names = (list) => list.map(m => `${m.first_name} ${m.last_name}`).join(', ');
    const parts = [`${primary.first_name} ${primary.last_name}'s membership downgraded to individual.`];
    if (detached.length) parts.push(`Now individual members: ${names(detached)}.`);
    if (archived.length) parts.push(`Archived: ${names(archived)}.`);
    req.session.flash_success = parts.join(' ');
  } catch (e) {
    req.session.flash_error = e.message;
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Attach an individual member to an existing family ---
router.post('/members/:id/attach-to-family', async (req, res) => {
  const member = await memberRepo.findById(req.params.id);
  if (!member) {
    req.session.flash_error = 'Member not found.';
    return res.redirect('/admin/members');
  }
  if (member.primary_member_id) {
    req.session.flash_error = 'Member is already part of a family.';
    return res.redirect(`/admin/members/${req.params.id}`);
  }
  const {primary_member_id} = req.body;
  if (!primary_member_id) {
    req.session.flash_error = 'Please select a family to attach to.';
    req.session.flash_reopen = 'attach-family';
    return res.redirect(`/admin/members/${req.params.id}`);
  }
  const primary = await memberRepo.findById(primary_member_id);
  if (!primary || primary.membership_type !== 'family' || primary.primary_member_id) {
    req.session.flash_error = 'Invalid primary member selected.';
    req.session.flash_reopen = 'attach-family';
    return res.redirect(`/admin/members/${req.params.id}`);
  }
  try {
    await memberRepo.attachToFamily(req.params.id, primary_member_id);
    req.session.flash_success = `${member.first_name} ${member.last_name} attached to ${primary.first_name} ${primary.last_name}'s family.`;
  } catch (e) {
    req.session.flash_error = e.message;
    req.session.flash_reopen = 'attach-family';
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Add family member to existing family membership ---
router.post('/members/:id/family-members', async (req, res) => {
  const member = await memberRepo.findById(req.params.id);
  if (!member) {
    req.session.flash_error = 'Member not found.';
    return res.redirect('/admin/members');
  }
  if (member.membership_type !== 'family' || member.primary_member_id) {
    req.session.flash_error = 'Only the primary account holder of a family membership can have family members added.';
    return res.redirect(`/admin/members/${req.params.id}`);
  }
  const {first_name, last_name, email, archived_member_id} = req.body;
  // Chosen from the archive suggestions: bring the same person back, number and all.
  if (archived_member_id) {
    try {
      const fm = await familyDowngrade.reattachFromArchive(member.id, archived_member_id, { email });
      req.session.flash_success = `Family member ${fm.first_name} ${fm.last_name} restored from the archive (${fm.member_number}).`;
    } catch (e) {
      req.session.flash_error = e.message;
      req.session.flash_reopen = 'add-family-member';
    }
    return res.redirect(`/admin/members/${req.params.id}`);
  }
  if (!first_name?.trim() || !last_name?.trim()) {
    req.session.flash_error = 'First and last name are required.';
    req.session.flash_reopen = 'add-family-member';
    return res.redirect(`/admin/members/${req.params.id}`);
  }
  try {
    await memberRepo.addFamilyMember(req.params.id, {
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      email: email?.trim() || member.email,
      membership_year: member.membership_year,
      status: member.status,
    });
    req.session.flash_success = `Family member ${first_name.trim()} ${last_name.trim()} added.`;
  } catch (e) {
    req.session.flash_error = e.message;
    req.session.flash_reopen = 'add-family-member';
  }
  res.redirect(`/admin/members/${req.params.id}`);
});

// --- Remove (detach) a family member ---
router.post('/members/:id/family-members/:familyId/remove', async (req, res) => {
  const familyMember = await memberRepo.findById(req.params.familyId);
  if (!familyMember || String(familyMember.primary_member_id) !== String(req.params.id)) {
    req.session.flash_error = 'Family member not found on this account.';
    return res.redirect(`/admin/members/${req.params.id}`);
  }
  try {
    const senderService = require('../services/sender');
    const wouldDelete = await memberRepo.emailConflictsWithPrimary(familyMember.email, familyMember.id);
    if (wouldDelete) {
      await memberRepo.deleteById(req.params.familyId);
      await senderService.syncEmailSafe(familyMember.email);
      req.session.flash_success = `${familyMember.first_name} ${familyMember.last_name} was deleted — their email (${familyMember.email}) is already used by another primary member.`;
    } else {
      await memberRepo.detachFamilyMember(req.params.familyId);
      // Now a primary in their own right, and cancelled — belongs in neither group.
      await senderService.syncMemberSafe(req.params.familyId);
      req.session.flash_success = `${familyMember.first_name} ${familyMember.last_name} removed from family membership and converted to individual.`;
    }
  } catch (e) {
    req.session.flash_error = e.message;
  }
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
  const { name, role, email, bio_text, sort_order, is_visible } = req.body;
  const photo_path = req.file ? await handleUpload(req.file, 'bios') : (req.body.existing_photo || null);
  await contentService.createBio({ name, role, email, bio_text, photo_path, sort_order, is_visible });
  req.session.flash_success = 'Bio created.';
  res.redirect('/admin/bios');
});

router.get('/bios/:id', async (req, res) => {
  const bio = await contentService.getBio(req.params.id);
  if (!bio) { req.session.flash_error = 'Not found.'; return res.redirect('/admin/bios'); }
  res.render('admin/bios/form', { bio });
});

router.post('/bios/:id', async (req, res) => {
  const { name, role, email, bio_text, sort_order, is_visible } = req.body;
  const existingPhotoPath = await contentService.getBioPhotoPath(req.params.id);
  let photo_path;
  if (req.file) {
    photo_path = await handleUpload(req.file, 'bios');
    storage.deleteFile(existingPhotoPath).catch(() => {});
  } else {
    photo_path = req.body.existing_photo || existingPhotoPath || null;
  }
  await contentService.updateBio(req.params.id, { name, role, email, bio_text, photo_path, sort_order, is_visible });
  req.session.flash_success = 'Bio updated.';
  res.redirect('/admin/bios');
});

router.post('/bios/:id/delete', async (req, res) => {
  await contentService.deleteBio(req.params.id);
  req.session.flash_success = 'Bio deleted.';
  res.redirect('/admin/bios');
});

// Convert an uploaded card template file (PNG or PDF) to a trimmed PNG buffer.
// The caller stores it through handleUpload — writing it into public/img/ instead
// meant every deploy replaced it with the committed default (issue #96).
async function processCardTemplate(file) {
  // Dispatch on the extension, not file.mimetype: multer's fileFilter (server.js) gates
  // on the extension and browsers report application/octet-stream for a .pdf often
  // enough to matter.  Trusting mimetype would upload raw PDF bytes named .png, which
  // fails loadImage and lands right back in the silent-default behavior of issue #96.
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.pdf' && ext !== '.png') {
    throw new Error('Card template must be a PNG or a PDF.');
  }
  if (ext !== '.pdf') return file.buffer;

  const {execFile} = require('child_process');
  const {promisify} = require('util');
  const execFileAsync = promisify(execFile);

  // Both tools want real files, and data/ is the persistent disk on Render.
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const tmpInput = path.join(dataDir, `tmp-card-${Date.now()}`);
  const tmpPng = `${tmpInput}.png`;
  const tmpTrimmed = `${tmpInput}-trimmed.png`;

  fs.writeFileSync(tmpInput, file.buffer);
  try {
    // A missing binary surfaces as ENOENT, which is indistinguishable from a
    // missing file further down — so map it to advice here, not around the read.
    try {
      await execFileAsync('gs', [
        '-dNOPAUSE', '-dBATCH', '-sDEVICE=png16m', '-r300',
        `-sOutputFile=${tmpPng}`, tmpInput,
      ]);
      const trimArgs = [tmpPng, '-trim', '-bordercolor', 'white', '-border', '20', tmpTrimmed];
      // ImageMagick 7 uses `magick`; IM6 (common on Ubuntu LTS) uses `convert`
      try {
        await execFileAsync('magick', trimArgs);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        await execFileAsync('convert', trimArgs);
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new Error('This server cannot convert PDFs (Ghostscript/ImageMagick missing). Upload a PNG instead.');
      }
      throw err;
    }
    return fs.readFileSync(tmpTrimmed);
  } finally {
    for (const p of [tmpInput, tmpPng, tmpTrimmed]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
}

// Store an uploaded card template and return the value for
// membership_periods.card_template_path — a B2 URL, or /uploads/<name> without B2.
async function uploadCardTemplate(file) {
  const buffer = await processCardTemplate(file);
  return handleUpload({ buffer, originalname: 'card-template.png' }, 'card-templates');
}

// --- Campaigns (issue #88) ---
// Available to editors as well as super admins: running outreach is exactly the job an editor
// has, and campaigns carry no member PII beyond what /admin/members already shows.

router.get('/campaigns', async (req, res, next) => {
  try {
    const campaigns = await campaignsRepo.listWithStats();
    res.render('admin/campaigns/list', {
      campaigns,
      baseUrl: campaignsService.resolveBaseUrl(),
      buildUrl: campaignsService.buildUrl,
      conversionRate: campaignsService.conversionRate,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/campaigns.csv', async (req, res, next) => {
  try {
    const campaigns = await campaignsRepo.listWithStats();
    const { toCsv } = require('../services/csv');
    const rows = campaigns.map(c => ({
      ...c,
      url: campaignsService.buildUrl(c),
      conversion_rate: campaignsService.conversionRate(c),
      is_active: c.is_active ? 'yes' : 'no',
    }));
    const columns = ['name', 'utm_campaign', 'utm_source', 'utm_medium', 'utm_content',
      'target_path', 'url', 'visit_count', 'signup_count', 'contact_count', 'conversion_rate',
      'is_active', 'created_at'];
    const headers = ['Name', 'Campaign', 'Source', 'Medium', 'Content', 'Target path', 'URL',
      'Visits', 'Signups', 'Contacts', 'Conversion', 'Active', 'Created'];
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ysh-campaigns-${date}.csv"`);
    res.send(toCsv(rows, columns, headers));
  } catch (err) {
    next(err);
  }
});

router.get('/campaigns/new', (req, res) => {
  res.render('admin/campaigns/form', {campaign: null, defaultTargetPath: campaignsService.DEFAULT_TARGET_PATH});
});

/** Turns a duplicate-code constraint violation into something an admin can act on. */
function campaignErrorMessage(err) {
  if (err.message.includes('UNIQUE') || err.code === '23505') {
    return 'Another campaign already uses that campaign code. Pick a different one.';
  }
  return err.message;
}

router.post('/campaigns', async (req, res) => {
  try {
    const data = campaignsService.validateCampaign(req.body);
    const campaign = await campaignsRepo.create(data);
    req.session.flash_success = 'Campaign created.';
    res.redirect(`/admin/campaigns/${campaign.id}`);
  } catch (err) {
    req.session.flash_error = campaignErrorMessage(err);
    res.redirect('/admin/campaigns/new');
  }
});

router.get('/campaigns/:id', async (req, res, next) => {
  try {
    const campaign = await campaignsRepo.get(req.params.id);
    if (!campaign) {
      req.session.flash_error = 'Campaign not found.';
      return res.redirect('/admin/campaigns');
    }
    const [stats, visits, signups, submissions] = await Promise.all([
      campaignsRepo.statsFor(campaign.id),
      campaignVisitsRepo.listRecent(campaign.id),
      campaignsRepo.listSignups(campaign.id),
      contactSubmissionsRepo.listByCampaign(campaign.id),
    ]);
    res.render('admin/campaigns/detail', {
      campaign,
      stats,
      visits,
      signups,
      submissions,
      url: campaignsService.buildUrl(campaign),
      conversion: campaignsService.conversionRate(stats),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/campaigns/:id/edit', async (req, res) => {
  const campaign = await campaignsRepo.get(req.params.id);
  if (!campaign) {
    req.session.flash_error = 'Campaign not found.';
    return res.redirect('/admin/campaigns');
  }
  res.render('admin/campaigns/form', {campaign, defaultTargetPath: campaignsService.DEFAULT_TARGET_PATH});
});

router.post('/campaigns/:id/edit', async (req, res) => {
  const id = req.params.id;
  try {
    const data = campaignsService.validateCampaign(req.body);
    await campaignsRepo.update(id, data);
    req.session.flash_success = 'Campaign updated.';
    res.redirect(`/admin/campaigns/${id}`);
  } catch (err) {
    req.session.flash_error = campaignErrorMessage(err);
    res.redirect(`/admin/campaigns/${id}/edit`);
  }
});

// Deactivate rather than delete: visits and attributed members reference the campaign, and a
// code that has already gone out on a flyer should stop attributing without losing its history.
router.post('/campaigns/:id/toggle', async (req, res) => {
  try {
    const campaign = await campaignsRepo.get(req.params.id);
    if (!campaign) {
      req.session.flash_error = 'Campaign not found.';
      return res.redirect('/admin/campaigns');
    }
    await campaignsRepo.setActive(campaign.id, !campaign.is_active);
    req.session.flash_success = campaign.is_active ? 'Campaign deactivated.' : 'Campaign reactivated.';
  } catch (err) {
    req.session.flash_error = err.message;
  }
  res.redirect('/admin/campaigns');
});

router.get('/campaigns/:id/qr.png', async (req, res, next) => {
  try {
    const campaign = await campaignsRepo.get(req.params.id);
    if (!campaign) return res.status(404).render('error', {status: 404, message: 'Campaign not found'});
    const png = await campaignsService.qrPng(campaignsService.buildUrl(campaign), {size: req.query.size});
    res.setHeader('Content-Type', 'image/png');
    if (req.query.download) {
      res.setHeader('Content-Disposition', `attachment; filename="${campaignsService.qrFilename(campaign, 'png')}"`);
    }
    res.send(png);
  } catch (err) {
    next(err);
  }
});

router.get('/campaigns/:id/qr.svg', async (req, res, next) => {
  try {
    const campaign = await campaignsRepo.get(req.params.id);
    if (!campaign) return res.status(404).render('error', {status: 404, message: 'Campaign not found'});
    const svg = await campaignsService.qrSvg(campaignsService.buildUrl(campaign));
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="${campaignsService.qrFilename(campaign, 'svg')}"`);
    res.send(svg);
  } catch (err) {
    next(err);
  }
});

// --- Events & game-day check-in (issue #114) ---
function csvDownload(res, filename, rows, columns, headers) {
  const { toCsv } = require('../services/csv');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(rows, columns, headers));
}

function householdName(row) {
  return row.primary_first_name ? `${row.primary_first_name} ${row.primary_last_name}` : '';
}

// ?period= picks a season; blank means the current one, and "all" means no filter.
async function resolvePeriodFilter(raw) {
  if (raw === 'all') return { periodId: null, periodParam: 'all' };
  const id = parseInt(raw, 10);
  if (id) return { periodId: id, periodParam: String(id) };
  const current = await periodsRepo.getCurrent(eventsService.localDate());
  return { periodId: current ? current.id : null, periodParam: current ? String(current.id) : 'all' };
}

// Links for the Events view pills, keeping the season. Defaults are left out of the URL.
function eventsQs({ view, period }) {
  const params = new URLSearchParams();
  if (view && view !== 'upcoming') params.set('view', view);
  if (period) params.set('period', period);
  const s = params.toString();
  return s ? `?${s}` : '';
}

router.get('/events', async (req, res, next) => {
  try {
    const { periodId, periodParam } = await resolvePeriodFilter(req.query.period);
    const view = eventsRepo.EVENT_VIEWS.includes(req.query.view) ? req.query.view : 'upcoming';
    const today = eventsService.localDate();
    const [events, counts, periods] = await Promise.all([
      eventsRepo.list({ periodId, view, today }),
      eventsRepo.countByView({ periodId, today }),
      periodsRepo.list(),
    ]);
    res.render('admin/events/list', {
      events,
      counts,
      view,
      periods,
      periodParam,
      periodId,
      today,
      localTime: eventsService.localTime,
      qs: (overrides) => eventsQs({ view, period: periodParam, ...overrides }),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/events/sync', async (req, res) => {
  try {
    const stats = await nflSchedule.syncSchedule();
    req.session.flash_success = `Seahawks schedule synced: ${stats.created} new, ${stats.updated} updated, ${stats.unchanged} unchanged.`;
  } catch (err) {
    logger.error('Seahawks schedule sync failed', { error: err.message });
    req.session.flash_error = 'Could not reach the ESPN schedule. Try again later, or add the event by hand.';
  }
  res.redirect('/admin/events');
});

router.get('/events/raffle.csv', async (req, res, next) => {
  try {
    const { periodId } = await resolvePeriodFilter(req.query.period);
    if (!periodId) {
      req.session.flash_error = 'Choose a season to export raffle entries for.';
      return res.redirect('/admin/events');
    }
    const rows = (await checkInsRepo.raffleEntries(periodId)).map(r => ({ ...r, household: householdName(r) }));
    csvDownload(res, `ysh-raffle-entries-${eventsService.localDate()}.csv`, rows,
      ['member_number', 'first_name', 'last_name', 'email', 'household', 'events_attended', 'tickets'],
      ['Member #', 'First name', 'Last name', 'Email', 'Family of', 'Events attended', 'Tickets']);
  } catch (err) {
    next(err);
  }
});

router.get('/events/new', async (req, res, next) => {
  try {
    res.render('admin/events/form', {
      event: null,
      values: { event_date: eventsService.localDate() },
      periods: await periodsRepo.list(),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/events', async (req, res, next) => {
  try {
    const { errors, fields } = eventsService.parseEventForm(req.body);
    if (errors.length) {
      res.locals.flash_error = errors.join(' ');
      return res.status(400).render('admin/events/form', { event: null, values: fields, periods: await periodsRepo.list() });
    }
    const event = await eventsService.createEvent(fields);
    req.session.flash_success = `Event "${event.name}" created.`;
    res.redirect(`/admin/events/${event.id}`);
  } catch (err) {
    next(err);
  }
});

router.get('/events/:id', async (req, res, next) => {
  try {
    const event = await eventsRepo.get(req.params.id);
    if (!event) { req.session.flash_error = 'Event not found.'; return res.redirect('/admin/events'); }
    const attendees = await checkInsRepo.listByEvent(event.id);
    res.render('admin/events/detail', {
      event,
      attendees,
      period: event.membership_period_id ? await periodsRepo.get(event.membership_period_id) : null,
      totalTickets: attendees.reduce((sum, a) => sum + Number(a.tickets_issued), 0),
      localTime: eventsService.localTime,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/events/:id/edit', async (req, res, next) => {
  try {
    const event = await eventsRepo.get(req.params.id);
    if (!event) { req.session.flash_error = 'Event not found.'; return res.redirect('/admin/events'); }
    res.render('admin/events/form', { event, values: event, periods: await periodsRepo.list() });
  } catch (err) {
    next(err);
  }
});

router.post('/events/:id', async (req, res, next) => {
  try {
    const event = await eventsRepo.get(req.params.id);
    if (!event) { req.session.flash_error = 'Event not found.'; return res.redirect('/admin/events'); }
    const { errors, fields } = eventsService.parseEventForm(req.body);
    if (errors.length) {
      res.locals.flash_error = errors.join(' ');
      return res.status(400).render('admin/events/form', { event, values: { ...event, ...fields }, periods: await periodsRepo.list() });
    }
    await eventsRepo.update(event.id, fields);
    req.session.flash_success = 'Event saved.';
    res.redirect(`/admin/events/${event.id}`);
  } catch (err) {
    next(err);
  }
});

router.get('/events/:id/attendance.csv', async (req, res, next) => {
  try {
    const event = await eventsRepo.get(req.params.id);
    if (!event) { req.session.flash_error = 'Event not found.'; return res.redirect('/admin/events'); }
    const rows = (await checkInsRepo.listByEvent(event.id)).map(r => ({
      ...r,
      household: householdName(r),
      enrolled: r.enrolled_at_check_in ? 'yes' : 'no',
      checked_in_time: eventsService.localTime(r.checked_in_at),
    }));
    csvDownload(res, `ysh-attendance-${event.event_date}-${event.id}.csv`, rows,
      ['member_number', 'first_name', 'last_name', 'email', 'household', 'enrolled', 'tickets_issued', 'checked_in_time', 'checked_in_by_email'],
      ['Member #', 'First name', 'Last name', 'Email', 'Family of', 'Enrolled', 'Tickets', 'Checked in', 'Checked in by']);
  } catch (err) {
    next(err);
  }
});

router.get('/check-in', async (req, res, next) => {
  try {
    const today = eventsService.localDate();
    const nearby = await eventsRepo.listAround(today);
    let event = null;
    const requested = parseInt(req.query.event, 10);
    if (requested) event = await eventsRepo.get(requested);
    if (!event) event = await eventsRepo.findNearest(today);
    // The chosen event may sit outside the ±7-day picker window; slot it in by date.
    const events = event && !nearby.some(e => e.id === event.id)
      ? [...nearby, event].sort((a, b) => a.event_date.localeCompare(b.event_date))
      : nearby;

    const search = String(req.query.search || '').trim();
    let results = [];
    if (search && event) {
      const { members } = await memberRepo.search({ search, sort: 'name', dir: 'asc', limit: 25, offset: 0 });
      // Family members are listed under their own name; show whose family they're on so
      // staff can tell two people with the same name apart.
      const primaryIds = [...new Set(members.map(m => m.primary_member_id).filter(Boolean))];
      const primaries = new Map();
      for (const id of primaryIds) primaries.set(id, await memberRepo.findById(id));
      const checkedIn = await checkInsRepo.findForMembers(event.id, members.map(m => m.id));
      results = members.map(m => ({
        member: m,
        primary: m.primary_member_id ? primaries.get(m.primary_member_id) || null : null,
        checkIn: checkedIn.get(Number(m.id)) || null,
      }));
    }

    res.render('admin/check-in/index', { event, events, today, search, results });
  } catch (err) {
    next(err);
  }
});

router.get('/check-in/:eventId/member/:memberId', async (req, res, next) => {
  try {
    const ctx = await checkInService.householdForCheckIn(req.params.eventId, req.params.memberId);
    if (!ctx) { req.session.flash_error = 'Event or member not found.'; return res.redirect('/admin/check-in'); }
    res.render('admin/check-in/household', {
      ...ctx,
      search: String(req.query.search || ''),
      defaultTickets: checkInService.DEFAULT_TICKETS,
      maxTickets: checkInService.MAX_TICKETS,
      localTime: eventsService.localTime,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/check-in/:eventId/member/:memberId', async (req, res, next) => {
  try {
    const result = await checkInService.recordHousehold(req.params.eventId, req.params.memberId, req.body);
    if (!result) { req.session.flash_error = 'Event or member not found.'; return res.redirect('/admin/check-in'); }
    const names = result.checkedIn.map(m => m.first_name).join(', ');
    const parts = [];
    if (result.checkedIn.length) {
      parts.push(`Checked in ${names} — ${result.tickets} raffle ticket${result.tickets === 1 ? '' : 's'}.`);
    }
    if (result.removed.length) parts.push(`Removed ${result.removed.map(m => m.first_name).join(', ')}.`);
    if (parts.length) req.session.flash_success = parts.join(' ');
    else req.session.flash_error = 'Nobody was ticked, so nobody was checked in.';
    res.redirect(`/admin/check-in?event=${encodeURIComponent(req.params.eventId)}`);
  } catch (err) {
    next(err);
  }
});

// --- Contact form submissions ---
router.get('/contact-submissions', async (req, res, next) => {
  try {
    const perPage = 50;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [submissions, total] = await Promise.all([
      contactSubmissionsRepo.list({limit: perPage, offset: (page - 1) * perPage}),
      contactSubmissionsRepo.count(),
    ]);
    res.render('admin/contact-submissions', {
      submissions,
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    });
  } catch (err) {
    next(err);
  }
});

// --- Membership Periods (super_admin only) ---
router.get('/periods', requireSuperAdmin, async (req, res, next) => {
  try {
    const periods = await periodsRepo.list();
    const today = new Date().toISOString().slice(0, 10);
    const currentPeriod = await periodsRepo.getCurrent();
    res.render('admin/periods/list', {periods, currentPeriod, today});
  } catch (err) {
    next(err);
  }
});

router.get('/periods/new', requireSuperAdmin, async (req, res) => {
  res.render('admin/periods/form', {period: null, centsToDollars: membershipPeriodsService.centsToDollars});
});

router.post('/periods', requireSuperAdmin, async (req, res) => {
  try {
    const data = membershipPeriodsService.validatePeriod(req.body);
    // Store the template first: nothing enforces uniqueness on label or dates, so a
    // create that survived a failed upload would leave the admin resubmitting a form
    // they were told had not saved, quietly duplicating the period.
    const card_template_path = req.file ? await uploadCardTemplate(req.file) : null;
    const period = await periodsRepo.create(data);
    if (card_template_path) {
      await periodsRepo.setCardTemplate(period.id, card_template_path);
    }
    req.session.flash_success = 'Membership period created.';
    res.redirect('/admin/periods');
  } catch (err) {
    req.session.flash_error = err.message;
    res.redirect('/admin/periods/new');
  }
});

router.get('/periods/:id/edit', requireSuperAdmin, async (req, res) => {
  const period = await periodsRepo.get(req.params.id);
  if (!period) {
    req.session.flash_error = 'Period not found.';
    return res.redirect('/admin/periods');
  }
  res.render('admin/periods/form', {period, centsToDollars: membershipPeriodsService.centsToDollars});
});

router.post('/periods/:id/edit', requireSuperAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const existing = await periodsRepo.get(id);
    const data = membershipPeriodsService.validatePeriod(req.body);
    let card_template_path = existing?.card_template_path || null;
    if (req.file) {
      card_template_path = await uploadCardTemplate(req.file);
    }
    await periodsRepo.update(id, {...data, card_template_path});
    // Only after the row points at the replacement — a delete before the update would
    // strand the old row on a template that no longer exists if the update threw.
    if (req.file) {
      storage.deleteFile(existing?.card_template_path).catch(() => {});
    }
    req.session.flash_success = 'Membership period updated.';
    res.redirect('/admin/periods');
  } catch (err) {
    req.session.flash_error = err.message;
    res.redirect(`/admin/periods/${id}/edit`);
  }
});

// --- Settings (super_admin only) ---
router.get('/settings', requireSuperAdmin, (req, res) => {
  res.render('admin/settings');
});

router.post('/settings', requireSuperAdmin, async (req, res) => {
  const keys = [
    'hero_title', 'hero_subtitle', 'hero_button_text', 'hero_button_url',
    'hero_media_type',
    'about_quote', 'about_text',
    'about_pillar1_title', 'about_pillar1_text',
    'about_pillar2_title', 'about_pillar2_text',
    'about_pillar3_title', 'about_pillar3_text',
    'gallery_album_url',
    'contact_email', 'stripe_publishable_key',
    'renewal_reminder_days_before',
    'attention_reminder_count', 'attention_pending_payment_hours', 'attention_lookback_days',
    'social_facebook_url', 'social_instagram_url',
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
    const daysBefore = await settingsRepo.get('renewal_reminder_days_before') || '30';
    const currentPeriod = await periodsRepo.getCurrent();
    const expiryDate = currentPeriod ? currentPeriod.end_date : '';
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
