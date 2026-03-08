const express = require('express');
const router = express.Router();
const authService = require('../services/auth');
const memberRepo = require('../db/repos/members');
const votesRepo = require('../db/repos/votes');
const eventsRepo = require('../db/repos/events');
const {requireMember} = require('../middleware/auth');
const logger = require('../services/logger');

const isDevOrTest = ['development', 'test', 'dev'].includes(process.env.NODE_ENV);

// --- Auth ---

router.get('/login', (req, res) => {
    if (req.session.memberId) return res.redirect('/members');
    res.render('members/login');
});

router.post('/login', async (req, res) => {
    const {email} = req.body;
    if (!email) {
        req.session.flash_error = 'Email is required.';
        return res.redirect('/members/login');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const member = await memberRepo.findActivePrimaryByEmail(normalizedEmail);

    // Generic message to prevent email enumeration
    req.session.flash_success = 'If that email is registered, a login code has been sent.';

    if (member) {
        const otp = await authService.generateAndStoreOtp(member.id);
        if (isDevOrTest || process.env.LOG_OTP === 'true') {
            logger.info('MEMBER LOGIN OTP', {email: member.email, otp});
        } else {
            try {
                const emailService = require('../services/email');
                await emailService.sendOtpEmail({
                    to: member.email,
                    toName: `${member.first_name} ${member.last_name}`,
                    otp,
                });
            } catch (e) {
                logger.error('Member OTP email failed', {error: e.message, email: member.email});
            }
        }
    }

    req.session.memberOtpEmail = normalizedEmail;
    res.redirect('/members/login/verify');
});

router.get('/login/verify', (req, res) => {
    if (!req.session.memberOtpEmail) return res.redirect('/members/login');
    const email = req.session.memberOtpEmail;
    const masked = email.replace(/^(.)(.*)(@.*)$/, (_m, first, middle, domain) => {
        return first + '*'.repeat(middle.length) + domain;
    });
    res.render('members/login-verify', {maskedEmail: masked});
});

router.post('/login/verify', async (req, res) => {
    const {code} = req.body;
    const email = req.session.memberOtpEmail;
    if (!email) return res.redirect('/members/login');

    const member = await memberRepo.findActivePrimaryByEmail(email);
    if (!member) {
        req.session.flash_error = 'Invalid or expired code.';
        return res.redirect('/members/login/verify');
    }

    const result = await authService.verifyOtp(member, code);
    if (!result.success) {
        req.session.flash_error = result.error;
        return res.redirect('/members/login/verify');
    }

    req.session.memberId = member.id;
    req.session.memberEmail = member.email;
    delete req.session.memberOtpEmail;

    const returnTo = req.session.returnTo;
    delete req.session.returnTo;
    const safeReturnTo = (returnTo && returnTo.startsWith('/members') && !returnTo.startsWith('//'))
        ? returnTo
        : '/members';
    res.redirect(safeReturnTo);
});

router.post('/logout', (req, res) => {
    delete req.session.memberId;
    delete req.session.memberEmail;
    res.redirect('/members/login');
});

// --- Portal dashboard ---

router.get('/', requireMember, async (req, res, next) => {
    try {
        const member = await memberRepo.findById(req.session.memberId);
        const openVotes = await votesRepo.listOpen();
        const events = await eventsRepo.listPublished();

        for (const vote of openVotes) {
            vote.myResponse = await votesRepo.getResponse(vote.id, member.id);
        }

        res.render('members/portal', {member, openVotes, events});
    } catch (err) {
        next(err);
    }
});

// --- Profile ---

router.get('/profile', requireMember, async (req, res, next) => {
    try {
        const member = await memberRepo.findById(req.session.memberId);
        res.render('members/profile', {member});
    } catch (err) {
        next(err);
    }
});

router.post('/profile', requireMember, async (req, res, next) => {
    try {
        const member = await memberRepo.findById(req.session.memberId);
        const {first_name, last_name, phone, address_street, address_city, address_state, address_zip} = req.body;

        if (!first_name || !last_name) {
            req.session.flash_error = 'First name and last name are required.';
            return res.redirect('/members/profile');
        }

        await memberRepo.update(member.id, {
            first_name: first_name.trim(),
            last_name: last_name.trim(),
            email: member.email,
            phone: phone?.trim() || null,
            address_street: address_street?.trim() || null,
            address_city: address_city?.trim() || null,
            address_state: address_state?.trim() || null,
            address_zip: address_zip?.trim() || null,
            membership_year: member.membership_year,
            join_date: member.join_date,
            status: member.status,
            notes: member.notes,
        });

        req.session.flash_success = 'Profile updated.';
        res.redirect('/members/profile');
    } catch (err) {
        next(err);
    }
});

// --- Votes ---

router.get('/votes/:id', requireMember, async (req, res, next) => {
    try {
        const vote = await votesRepo.findById(req.params.id);
        if (!vote) return res.status(404).render('error', {status: 404, message: 'Vote not found'});

        const options = await votesRepo.getOptions(vote.id);
        const myResponse = await votesRepo.getResponse(vote.id, req.session.memberId);
        const showResults = !!(myResponse || vote.status === 'closed');
        const results = showResults ? await votesRepo.getResults(vote.id) : null;
        const totalVotes = showResults ? await votesRepo.getTotalVotes(vote.id) : 0;

        res.render('members/vote', {vote, options, myResponse, results, totalVotes});
    } catch (err) {
        next(err);
    }
});

router.post('/votes/:id', requireMember, async (req, res, next) => {
    try {
        const vote = await votesRepo.findById(req.params.id);
        if (!vote || vote.status !== 'open') {
            req.session.flash_error = 'This vote is not open.';
            return res.redirect('/members');
        }

        const existing = await votesRepo.getResponse(vote.id, req.session.memberId);
        if (existing) {
            req.session.flash_error = 'You have already voted.';
            return res.redirect(`/members/votes/${vote.id}`);
        }

        const option_id = parseInt(req.body.option_id);
        if (!option_id) {
            req.session.flash_error = 'Please select an option.';
            return res.redirect(`/members/votes/${vote.id}`);
        }

        // Validate the option belongs to this vote
        const options = await votesRepo.getOptions(vote.id);
        const validOption = options.find(o => o.id === option_id);
        if (!validOption) {
            req.session.flash_error = 'Invalid option.';
            return res.redirect(`/members/votes/${vote.id}`);
        }

        await votesRepo.castVote(vote.id, req.session.memberId, option_id);
        req.session.flash_success = 'Your vote has been recorded.';
        res.redirect(`/members/votes/${vote.id}`);
    } catch (err) {
        next(err);
    }
});

// --- Events ---

router.get('/events', requireMember, async (req, res, next) => {
    try {
        const events = await eventsRepo.listPublished();
        res.render('members/events', {events});
    } catch (err) {
        next(err);
    }
});

router.get('/events/:id', requireMember, async (req, res, next) => {
    try {
        const event = await eventsRepo.findById(req.params.id);
        if (!event || event.status !== 'published') {
            return res.status(404).render('error', {status: 404, message: 'Event not found'});
        }

        const roles = event.event_type === 'watch_party' ? await eventsRepo.getRoles(event.id) : [];
        const mySignup = event.event_type === 'watch_party'
            ? await eventsRepo.getSignup(event.id, req.session.memberId)
            : null;

        for (const role of roles) {
            role.signupCount = await eventsRepo.getSignupCountByRole(role.id);
            role.isFull = role.max_volunteers !== null && role.signupCount >= role.max_volunteers;
        }

        res.render('members/event', {event, roles, mySignup});
    } catch (err) {
        next(err);
    }
});

router.post('/events/:id/volunteer', requireMember, async (req, res, next) => {
    try {
        const event = await eventsRepo.findById(req.params.id);
        if (!event || event.status !== 'published' || event.event_type !== 'watch_party') {
            req.session.flash_error = 'Event not found.';
            return res.redirect('/members/events');
        }

        const existing = await eventsRepo.getSignup(event.id, req.session.memberId);
        if (existing) {
            req.session.flash_error = 'You are already signed up to volunteer.';
            return res.redirect(`/members/events/${event.id}`);
        }

        const role_id = parseInt(req.body.role_id);
        if (!role_id) {
            req.session.flash_error = 'Please select a role.';
            return res.redirect(`/members/events/${event.id}`);
        }

        const roles = await eventsRepo.getRoles(event.id);
        const role = roles.find(r => r.id === role_id);
        if (!role) {
            req.session.flash_error = 'Invalid role.';
            return res.redirect(`/members/events/${event.id}`);
        }

        const count = await eventsRepo.getSignupCountByRole(role.id);
        if (role.max_volunteers !== null && count >= role.max_volunteers) {
            req.session.flash_error = 'That role is full. Please select another.';
            return res.redirect(`/members/events/${event.id}`);
        }

        await eventsRepo.createSignup(event.id, role.id, req.session.memberId);
        req.session.flash_success = "You're signed up to volunteer!";
        res.redirect(`/members/events/${event.id}`);
    } catch (err) {
        next(err);
    }
});

router.post('/events/:id/volunteer/remove', requireMember, async (req, res, next) => {
    try {
        await eventsRepo.deleteSignup(req.params.id, req.session.memberId);
        req.session.flash_success = 'Volunteer signup removed.';
        res.redirect(`/members/events/${req.params.id}`);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
