/**
 * Public silent auction pages (issue #119): the auction landing page, item pages, bidder
 * sign-in by emailed code, and bidding. Bids work as a plain form post; public/js/auction.js
 * upgrades the form to fetch() when JavaScript is available.
 */
const express = require('express');
const router = express.Router();
const { requireBidder } = require('../middleware/auth');
const { requireCaptcha } = require('../middleware/captcha');
const authService = require('../services/auth');
const auctions = require('../services/auctions');
const auctionBids = require('../services/auctionBids');
const { formatDenver } = require('../services/timezone');
const auctionsRepo = require('../db/repos/auctions');
const itemsRepo = require('../db/repos/auctionItems');
const bidsRepo = require('../db/repos/auctionBids');
const biddersRepo = require('../db/repos/auctionBidders');
const memberRepo = require('../db/repos/members');
const logger = require('../services/logger');

const isDevOrTest = ['development', 'test', 'dev'].includes(process.env.NODE_ENV);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function wantsJson(req) {
  return (req.get('Accept') || '').includes('application/json');
}

function safeReturnTo(raw) {
  return typeof raw === 'string' && raw.startsWith('/auctions/') && !raw.startsWith('//') ? raw : null;
}

function maskEmail(email) {
  return email.replace(/^(.)(.*)(@.*)$/, (_m, first, middle, domain) => first + '*'.repeat(middle.length) + domain);
}

/** Loads a published auction (a draft only for a signed-in admin previewing it), or null. */
async function loadAuction(req) {
  const id = parseInt(req.params.id, 10);
  if (!id) return null;
  const auction = await auctionsRepo.get(id);
  if (!auction) return null;
  if (auction.status !== 'published' && !req.session.adminId) return null;
  return auction;
}

function notFound(res) {
  return res.status(404).render('error', { status: 404, message: 'Auction not found' });
}

async function sendBidderCode(bidder) {
  const otp = await authService.generateAndStoreBidderOtp(bidder.id);
  if (isDevOrTest || process.env.LOG_OTP === 'true') {
    logger.info('AUCTION LOGIN OTP', { email: bidder.email, otp });
    return;
  }
  try {
    await require('../services/email').sendBidderOtpEmail({ to: bidder.email, toName: bidder.name, otp });
  } catch (e) {
    logger.error('Auction OTP email failed', { error: e.message, email: bidder.email });
  }
}

// --- Landing ---

router.get('/', async (req, res, next) => {
  try {
    const auction = res.locals.navAuction;
    if (auction) return res.redirect(`/auctions/${auction.id}`);
    res.render('auctions/none');
  } catch (err) {
    next(err);
  }
});

// A fresh CSRF token for the fetch() bid form. The token rotates after every successful POST,
// so a page that has already bid (or a second tab) would otherwise send a stale one. GETs
// never rotate it.
router.get('/csrf', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ token: req.session.csrfToken });
});

// --- Bidder sign-in ---

router.get('/login', (req, res) => {
  const returnTo = safeReturnTo(req.query.returnTo);
  if (returnTo) req.session.bidderReturnTo = returnTo;
  if (req.session.bidderId) return res.redirect(safeReturnTo(req.session.bidderReturnTo) || '/auctions');
  res.render('auctions/login', { values: req.session.bidderPending || {} });
});

router.post('/login', requireCaptcha('/auctions/login'), async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const values = { email, name, phone };

    const errors = [];
    if (!EMAIL_RE.test(email)) errors.push('A valid email is required.');
    if (!name) errors.push('Your name is required.');
    if (phone.replace(/\D/g, '').length < 7) errors.push('A phone number is required so we can reach you if you win.');
    if (errors.length) {
      res.locals.flash_error = errors.join(' ');
      return res.status(400).render('auctions/login', { values });
    }

    let bidder = await biddersRepo.findByEmail(email);
    if (!bidder) bidder = await biddersRepo.createUnverified({ email, name, phone });
    // Name and phone are only saved once the code proves the email belongs to this person.
    req.session.bidderPending = values;
    await sendBidderCode({ ...bidder, name: bidder.verified_at ? bidder.name : name });

    req.session.flash_success = `We sent a sign-in code to ${maskEmail(email)}.`;
    res.redirect('/auctions/login/verify');
  } catch (err) {
    next(err);
  }
});

router.get('/login/verify', (req, res) => {
  const pending = req.session.bidderPending;
  if (!pending) return res.redirect('/auctions/login');
  res.render('auctions/login-verify', { maskedEmail: maskEmail(pending.email) });
});

router.post('/login/verify', async (req, res, next) => {
  try {
    const pending = req.session.bidderPending;
    if (!pending) return res.redirect('/auctions/login');
    const bidder = await biddersRepo.findByEmail(pending.email);
    const result = await authService.verifyBidderOtp(bidder, String(req.body.code || '').trim());
    if (!result.success) {
      req.session.flash_error = result.error;
      return res.redirect('/auctions/login/verify');
    }

    const member = await memberRepo.findByEmail(pending.email);
    const verified = await biddersRepo.markVerified(bidder.id, {
      name: pending.name,
      phone: pending.phone,
      memberId: member ? member.id : null,
      nowIso: new Date().toISOString(),
    });
    req.session.bidderId = verified.id;
    req.session.bidderName = verified.name;
    delete req.session.bidderPending;

    const returnTo = safeReturnTo(req.session.bidderReturnTo);
    delete req.session.bidderReturnTo;
    req.session.flash_success = `You're signed in as ${verified.name}. Happy bidding!`;
    res.redirect(returnTo || '/auctions');
  } catch (err) {
    next(err);
  }
});

router.post('/login/resend', async (req, res, next) => {
  try {
    const pending = req.session.bidderPending;
    if (!pending) return res.redirect('/auctions/login');
    const bidder = await biddersRepo.findByEmail(pending.email);
    if (bidder) await sendBidderCode({ ...bidder, name: bidder.verified_at ? bidder.name : pending.name });
    req.session.flash_success = 'A new code has been sent.';
    res.redirect('/auctions/login/verify');
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  delete req.session.bidderId;
  delete req.session.bidderName;
  req.session.flash_success = 'You have signed out of the auction.';
  res.redirect('/auctions');
});

// --- Auction and item pages ---

router.get('/:id', async (req, res, next) => {
  try {
    const auction = await loadAuction(req);
    if (!auction) return notFound(res);
    const items = await itemsRepo.listByAuction(auction.id);
    const myPaddle = req.session.bidderId ? await bidsRepo.getPaddle(auction.id, req.session.bidderId) : null;
    res.render('auctions/show', {
      auction,
      phase: auctions.phase(auction),
      items: items.map(i => ({ ...i, state: auctions.publicItemState(i, auction.min_increment_cents) })),
      myPaddle: myPaddle ? myPaddle.paddle_number : null,
      formatDenver,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/items/:itemId', async (req, res, next) => {
  try {
    const auction = await loadAuction(req);
    if (!auction) return notFound(res);
    const item = (await itemsRepo.listByAuction(auction.id)).find(i => i.id === parseInt(req.params.itemId, 10));
    if (!item) return notFound(res);
    const [photos, bids, paddle] = await Promise.all([
      itemsRepo.listPhotos(item.id),
      bidsRepo.listPublic(item.id),
      req.session.bidderId ? bidsRepo.getPaddle(auction.id, req.session.bidderId) : null,
    ]);
    const confirmation = req.session.bidConfirmation && req.session.bidConfirmation.itemId === item.id
      ? req.session.bidConfirmation : null;
    delete req.session.bidConfirmation;
    res.render('auctions/item', {
      auction,
      phase: auctions.phase(auction),
      item,
      state: auctions.publicItemState(item, auction.min_increment_cents),
      photos,
      bids,
      myPaddle: paddle ? paddle.paddle_number : null,
      confirmation,
      formatDenver,
    });
  } catch (err) {
    next(err);
  }
});

// Live updates (Server-Sent Events). The snapshot is sent on every (re)connect, so a phone that
// dropped the connection in the background catches up as soon as it reconnects.
router.get('/:id/stream', async (req, res, next) => {
  try {
    const auction = await loadAuction(req);
    if (!auction) return notFound(res);
    const bidderId = req.session.bidderId || null;
    const [items, paddle] = await Promise.all([
      itemsRepo.listByAuction(auction.id),
      bidderId ? bidsRepo.getPaddle(auction.id, bidderId) : null,
    ]);
    require('../services/auctionHub').open(req, res, auction.id, {
      bidderId,
      snapshot: {
        server_now: new Date().toISOString(),
        auction: { id: auction.id, phase: auctions.phase(auction), starts_at: auction.starts_at, ends_at: auction.ends_at },
        items: items.map(i => auctions.publicItemState(i, auction.min_increment_cents)),
        my_paddle: paddle ? paddle.paddle_number : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items/:itemId/bids', requireBidder, async (req, res, next) => {
  try {
    const auctionId = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const itemUrl = `/auctions/${auctionId}/items/${itemId}`;
    const result = await auctionBids.placeBid({
      auctionId,
      itemId,
      bidderId: req.session.bidderId,
      amountRaw: req.body.amount,
      shippingAck: req.body.shipping_ack === '1' || req.body.shipping_ack === 'on',
    });

    if (!result.ok) {
      if (wantsJson(req)) {
        const status = result.code === 'not_found' ? 404 : (result.code === 'blocked' ? 403 : 409);
        return res.status(status).json({ ok: false, code: result.code, message: result.message, min_next_cents: result.minNextCents ?? null });
      }
      req.session.flash_error = result.message;
      return res.redirect(itemUrl);
    }

    require('../services/auctionNotifier').onBidPlaced(result);

    const auction = await auctionsRepo.get(result.auctionId);
    const confirmation = {
      itemId: result.item.id,
      amountCents: result.bid.amount_cents,
      paddle: result.paddle.paddle_number,
    };
    if (wantsJson(req)) {
      return res.json({
        ok: true,
        message: `Your bid of $${(result.bid.amount_cents / 100).toLocaleString('en-US')} is the high bid.`,
        paddle: result.paddle.paddle_number,
        shipping_notice: auction.shipping_notice,
        state: auctions.publicItemState(result.item, auction.min_increment_cents),
      });
    }
    req.session.bidConfirmation = confirmation;
    res.redirect(itemUrl);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
