/**
 * Admin pages for the silent auction (issue #119), mounted at /admin/auctions inside
 * routes/admin.js after requireAdmin. Photos arrive through the global /admin multer
 * middleware in server.js as req.files.photos.
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const auctions = require('../services/auctions');
const auctionBids = require('../services/auctionBids');
const auctionDashboard = require('../services/auctionDashboard');
const { saveUpload } = require('../services/uploads');
const storage = require('../services/storage');
const { sendCsv } = require('../services/csv');
const { formatDenver, formatDenverShort, utcToDenverInput } = require('../services/timezone');
const auctionsRepo = require('../db/repos/auctions');
const itemsRepo = require('../db/repos/auctionItems');
const bidsRepo = require('../db/repos/auctionBids');
const biddersRepo = require('../db/repos/auctionBidders');
const logger = require('../services/logger');

const PHOTO_EXT = /\.(jpe?g|png|gif|webp)$/i;
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

const money = cents => `$${(Number(cents) / 100).toLocaleString('en-US')}`;

/** Values for the auction form: stored UTC times shown back as Denver local inputs. */
function auctionFormValues(auction) {
  return {
    ...auction,
    starts_at: utcToDenverInput(auction.starts_at),
    ends_at: utcToDenverInput(auction.ends_at),
    min_increment: auction.min_increment_cents ? auction.min_increment_cents / 100 : '',
  };
}

/** Saves the uploaded `photos` to an item. Returns notes about any files that were skipped. */
async function savePhotos(itemId, files) {
  const skipped = [];
  let saved = 0;
  for (const file of files || []) {
    if (!PHOTO_EXT.test(path.extname(file.originalname))) {
      skipped.push(`${file.originalname} (not a JPG, PNG, GIF or WebP image)`);
      continue;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      skipped.push(`${file.originalname} (over 15 MB)`);
      continue;
    }
    const url = await saveUpload(file, 'auction');
    await itemsRepo.addPhoto(itemId, url);
    saved++;
  }
  return { saved, skipped };
}

function deleteStoredFile(url) {
  storage.deleteFile(url).catch(err => logger.warn('Could not delete auction photo', { url, error: err.message }));
}

async function loadAuction(req, res) {
  const auction = await auctionsRepo.get(req.params.id);
  if (!auction) {
    req.session.flash_error = 'Auction not found.';
    res.redirect('/admin/auctions');
    return null;
  }
  return auction;
}

async function loadItem(req, res, auction) {
  const item = await itemsRepo.get(req.params.itemId);
  if (!item || Number(item.auction_id) !== Number(auction.id)) {
    req.session.flash_error = 'Item not found.';
    res.redirect(`/admin/auctions/${auction.id}/items`);
    return null;
  }
  return item;
}

// --- Auctions ---

router.get('/', async (req, res, next) => {
  try {
    const list = await auctionsRepo.list();
    res.render('admin/auctions/list', {
      auctions: list.map(a => ({ ...a, phase: auctions.phase(a) })),
      formatDenver,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/new', (req, res) => {
  res.render('admin/auctions/form', {
    auction: null,
    values: {
      shipping_notice: auctions.DEFAULT_SHIPPING_NOTICE,
      min_increment: auctions.DEFAULT_INCREMENT_CENTS / 100,
      status: 'draft',
    },
  });
});

router.post('/', async (req, res, next) => {
  try {
    const { errors, fields } = auctions.parseAuctionForm(req.body);
    if (errors.length) {
      res.locals.flash_error = errors.join(' ');
      return res.status(400).render('admin/auctions/form', { auction: null, values: { ...req.body } });
    }
    const auction = await auctionsRepo.create(fields);
    auctions.invalidateNavCache();
    req.session.flash_success = `Auction "${auction.title}" created. Add items next.`;
    res.redirect(`/admin/auctions/${auction.id}/items`);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    res.redirect(`/admin/auctions/${auction.id}/dashboard`);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/dashboard', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const stats = await auctionDashboard.getStats(auction.id);
    const sort = req.query.sort === 'bids' ? 'bids' : 'amount';
    stats.leaderboard.sort((a, b) => sort === 'bids'
      ? b.bid_count - a.bid_count
      : (b.current_bid_cents ?? -1) - (a.current_bid_cents ?? -1));
    res.render('admin/auctions/dashboard', { ...stats, sort, formatDenver, formatDenverShort });
  } catch (err) {
    next(err);
  }
});

// Live dashboard feed: the same hub as the public pages, on the admin channel, whose events
// carry bidder names.
router.get('/:id/stream', async (req, res, next) => {
  try {
    const auction = await auctionsRepo.get(req.params.id);
    if (!auction) return res.status(404).end();
    const stats = await auctionDashboard.getStats(auction.id);
    require('../services/auctionHub').open(req, res, auction.id, {
      admin: true,
      snapshot: { server_now: new Date().toISOString(), phase: stats.phase, ends_at: auction.ends_at, totals: stats.totals },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/send-winner-emails', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    if (auctions.phase(auction) !== 'closed') {
      req.session.flash_error = 'Winner emails can only be sent after bidding closes.';
      return res.redirect(`/admin/auctions/${auction.id}/winners`);
    }
    const notifier = require('../services/auctionNotifier');
    await auctionsRepo.claimWinnersNotified(auction.id, new Date().toISOString());
    const { sent, failed } = await notifier.sendWinnerEmails(auction.id);
    if (failed) req.session.flash_error = `${failed} winner email${failed === 1 ? '' : 's'} failed. Try again in a few minutes.`;
    req.session.flash_success = sent
      ? `Sent ${sent} winner email${sent === 1 ? '' : 's'}.`
      : 'Every winner has already been emailed.';
    res.redirect(`/admin/auctions/${auction.id}/winners`);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/edit', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    res.render('admin/auctions/form', { auction, values: auctionFormValues(auction) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    if (auction.winners_notified_at) {
      req.session.flash_error = 'Winners have already been notified, so this auction can no longer be edited.';
      return res.redirect(`/admin/auctions/${auction.id}/dashboard`);
    }
    const { errors, fields } = auctions.parseAuctionForm(req.body);
    if (errors.length) {
      res.locals.flash_error = errors.join(' ');
      return res.status(400).render('admin/auctions/form', { auction, values: { ...req.body } });
    }
    const updated = await auctionsRepo.update(auction.id, fields);
    auctions.invalidateNavCache();
    require('../services/auctionNotifier').onAuctionChanged(updated);
    req.session.flash_success = `Auction saved. Bidding ${auctions.phase({ ...auction, ...fields }) === 'draft' ? 'is not public (draft)' : `runs ${formatDenver(fields.starts_at)} – ${formatDenver(fields.ends_at)}`}.`;
    res.redirect(`/admin/auctions/${auction.id}/dashboard`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/delete', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const items = await itemsRepo.listForAdmin(auction.id);
    const photos = await itemsRepo.listPhotosForItems(items.map(i => i.id));
    const doomed = await auctionsRepo.remove(auction.id);
    if (!doomed) {
      req.session.flash_error = 'Only a draft auction with no bids can be deleted.';
      return res.redirect(`/admin/auctions/${auction.id}/dashboard`);
    }
    photos.forEach(p => deleteStoredFile(p.url));
    auctions.invalidateNavCache();
    req.session.flash_success = `Auction "${doomed.title}" deleted.`;
    res.redirect('/admin/auctions');
  } catch (err) {
    next(err);
  }
});

// --- Items ---

router.get('/:id/items', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    res.render('admin/auctions/items', {
      auction,
      phase: auctions.phase(auction),
      items: await itemsRepo.listForAdmin(auction.id),
      formatDenver,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/items/new', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    res.render('admin/auctions/item-form', { auction, item: null, values: {}, photos: [] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const { errors, fields } = auctions.parseItemForm(req.body);
    if (errors.length) {
      res.locals.flash_error = errors.join(' ');
      return res.status(400).render('admin/auctions/item-form', { auction, item: null, values: { ...req.body }, photos: [] });
    }
    const item = await itemsRepo.create(auction.id, fields);
    const { saved, skipped } = await savePhotos(item.id, req.files?.photos);
    req.session.flash_success = `Item "${item.title}" added with ${saved} photo${saved === 1 ? '' : 's'}.`;
    if (skipped.length) req.session.flash_error = `Skipped: ${skipped.join('; ')}.`;
    res.redirect(`/admin/auctions/${auction.id}/items/${item.id}`);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/items/:itemId', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const item = await loadItem(req, res, auction);
    if (!item) return;
    res.render('admin/auctions/item-form', {
      auction, item, values: { ...item, starting_bid: item.starting_bid_cents / 100 },
      photos: await itemsRepo.listPhotos(item.id),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items/:itemId', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const item = await loadItem(req, res, auction);
    if (!item) return;
    const { errors, fields } = auctions.parseItemForm(req.body);
    if (errors.length) {
      res.locals.flash_error = errors.join(' ');
      return res.status(400).render('admin/auctions/item-form', {
        auction, item, values: { ...item, ...req.body }, photos: await itemsRepo.listPhotos(item.id),
      });
    }
    const { startingBidLocked } = await itemsRepo.update(item.id, fields);
    const { saved, skipped } = await savePhotos(item.id, req.files?.photos);
    const notes = ['Item saved.'];
    if (saved) notes.push(`${saved} photo${saved === 1 ? '' : 's'} added.`);
    req.session.flash_success = notes.join(' ');
    const problems = [];
    if (startingBidLocked) problems.push('The starting bid was not changed because this item already has bids.');
    if (skipped.length) problems.push(`Skipped: ${skipped.join('; ')}.`);
    if (problems.length) req.session.flash_error = problems.join(' ');
    res.redirect(`/admin/auctions/${auction.id}/items/${item.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items/:itemId/withdraw', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const item = await loadItem(req, res, auction);
    if (!item) return;
    const updated = await itemsRepo.setWithdrawn(item.id, !item.withdrawn);
    require('../services/auctionNotifier').onItemChanged(auction.id, updated);
    req.session.flash_success = updated.withdrawn
      ? `"${item.title}" withdrawn. It's hidden from bidders and can't take bids.`
      : `"${item.title}" is back in the auction.`;
    res.redirect(`/admin/auctions/${auction.id}/items`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items/:itemId/delete', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const item = await loadItem(req, res, auction);
    if (!item) return;
    const result = await itemsRepo.remove(item.id);
    if (!result) {
      req.session.flash_error = 'This item has bids, so it can\'t be deleted. Withdraw it instead.';
      return res.redirect(`/admin/auctions/${auction.id}/items/${item.id}`);
    }
    result.photoUrls.forEach(deleteStoredFile);
    req.session.flash_success = `Item "${item.title}" deleted.`;
    res.redirect(`/admin/auctions/${auction.id}/items`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items/:itemId/photos/:photoId/delete', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const item = await loadItem(req, res, auction);
    if (!item) return;
    const photo = await itemsRepo.getPhoto(req.params.photoId);
    if (photo && Number(photo.item_id) === Number(item.id)) {
      await itemsRepo.deletePhoto(photo.id);
      deleteStoredFile(photo.url);
      req.session.flash_success = 'Photo removed.';
    }
    res.redirect(`/admin/auctions/${auction.id}/items/${item.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/items/:itemId/photos/:photoId/move', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const item = await loadItem(req, res, auction);
    if (!item) return;
    const photo = await itemsRepo.getPhoto(req.params.photoId);
    if (photo && Number(photo.item_id) === Number(item.id)) {
      await itemsRepo.movePhoto(photo.id, req.body.dir === 'up' ? 'up' : 'down');
    }
    res.redirect(`/admin/auctions/${auction.id}/items/${item.id}#photos`);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/items/:itemId/bids', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const item = await loadItem(req, res, auction);
    if (!item) return;
    res.render('admin/auctions/item-bids', {
      auction, item, bids: await bidsRepo.listAdmin(item.id), phase: auctions.phase(auction), formatDenver,
    });
  } catch (err) {
    next(err);
  }
});

// --- Bids and bidders ---

router.post('/:id/bids/:bidId/remove', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const bid = await bidsRepo.get(req.params.bidId);
    const item = bid ? await itemsRepo.get(bid.item_id) : null;
    if (!bid || !item || Number(item.auction_id) !== Number(auction.id)) {
      req.session.flash_error = 'Bid not found.';
      return res.redirect(`/admin/auctions/${auction.id}/dashboard`);
    }
    const result = await auctionBids.removeBid({ bidId: bid.id, reason: req.body.reason });
    if (!result.ok) {
      req.session.flash_error = result.message;
    } else {
      require('../services/auctionNotifier').onBidRemoved(auction.id, result.item);
      req.session.flash_success = `Bid of ${money(bid.amount_cents)} removed. `
        + (result.item.current_bid_cents != null
          ? `The high bid is now ${money(result.item.current_bid_cents)}.`
          : 'The item has no bids now.');
    }
    res.redirect(`/admin/auctions/${auction.id}/items/${item.id}/bids`);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/bidders', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    res.render('admin/auctions/bidders', { auction, bidders: await biddersRepo.listByAuction(auction.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/bidders/:bidderId/block', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const bidder = await biddersRepo.get(req.params.bidderId);
    if (!bidder) {
      req.session.flash_error = 'Bidder not found.';
    } else {
      const updated = await biddersRepo.setBlocked(bidder.id, !bidder.blocked_at);
      req.session.flash_success = updated.blocked_at
        ? `${bidder.name} is blocked from bidding. Their existing bids stand until you remove them.`
        : `${bidder.name} can bid again.`;
    }
    res.redirect(`/admin/auctions/${auction.id}/bidders`);
  } catch (err) {
    next(err);
  }
});

// --- Winners ---

router.get('/:id/winners', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const items = (await itemsRepo.listWinners(auction.id)).filter(i => !i.withdrawn);
    res.render('admin/auctions/winners', {
      auction, phase: auctions.phase(auction), items, formatDenver,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/winners.csv', async (req, res, next) => {
  try {
    const auction = await loadAuction(req, res);
    if (!auction) return;
    const rows = (await itemsRepo.listWinners(auction.id))
      .filter(i => !i.withdrawn)
      .map(i => ({
        ...i,
        winning_bid: i.current_bid_cents != null ? (i.current_bid_cents / 100).toFixed(2) : '',
        starting_bid: (i.starting_bid_cents / 100).toFixed(2),
        winner_emailed: i.winner_emailed_at ? formatDenver(i.winner_emailed_at) : '',
      }));
    sendCsv(res, `ysh-auction-${auction.id}-winners.csv`, rows,
      ['title', 'starting_bid', 'winning_bid', 'bid_count', 'high_paddle', 'high_bidder_name', 'high_bidder_email',
        'high_bidder_phone', 'high_bidder_member_number', 'winner_emailed'],
      ['Item', 'Starting bid', 'Winning bid', 'Bids', 'Bidder #', 'Name', 'Email', 'Phone', 'Member #', 'Winner emailed']);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
