const db = require('../database');

// Bids are not audit-logged when placed: the bid row is itself the record, and the actor is a
// bidder rather than an admin. Admin removals are audited by services/auctionBids.js.

async function get(id) {
    return db.get('SELECT * FROM auction_bids WHERE id = ?', id);
}

async function insert({itemId, bidderId, amountCents, placedAt}) {
    const result = await db.run(
        'INSERT INTO auction_bids (item_id, bidder_id, amount_cents, placed_at) VALUES (?, ?, ?, ?)',
        itemId, bidderId, amountCents, placedAt
    );
    return get(result.lastInsertRowid);
}

/** Live bids on an item, highest first, labelled only by paddle number. */
async function listPublic(itemId) {
    const rows = await db.all(
        `SELECT b.id, b.amount_cents, b.placed_at, p.paddle_number
         FROM auction_bids b
         JOIN auction_items i ON i.id = b.item_id
         LEFT JOIN auction_paddles p ON p.auction_id = i.auction_id AND p.bidder_id = b.bidder_id
         WHERE b.item_id = ? AND b.removed_at IS NULL
         ORDER BY b.amount_cents DESC, b.placed_at ASC`,
        itemId
    );
    return rows.map(r => ({...r, amount_cents: Number(r.amount_cents), paddle_number: Number(r.paddle_number)}));
}

/** Every bid on an item including removed ones, with bidder names — admin only. */
async function listAdmin(itemId) {
    return db.all(
        `SELECT b.*, bd.name AS bidder_name, bd.email AS bidder_email, p.paddle_number,
                rm.email AS removed_by_email
         FROM auction_bids b
         JOIN auction_items i ON i.id = b.item_id
         JOIN auction_bidders bd ON bd.id = b.bidder_id
         LEFT JOIN auction_paddles p ON p.auction_id = i.auction_id AND p.bidder_id = b.bidder_id
         LEFT JOIN members rm ON rm.id = b.removed_by
         WHERE b.item_id = ?
         ORDER BY b.amount_cents DESC, b.placed_at ASC`,
        itemId
    );
}

/** Latest live bids across an auction, for the admin dashboard feed. */
async function listRecentForAuction(auctionId, limit = 25) {
    return db.all(
        `SELECT b.id, b.item_id, b.amount_cents, b.placed_at, i.title AS item_title,
                bd.name AS bidder_name, p.paddle_number
         FROM auction_bids b
         JOIN auction_items i ON i.id = b.item_id
         JOIN auction_bidders bd ON bd.id = b.bidder_id
         LEFT JOIN auction_paddles p ON p.auction_id = i.auction_id AND p.bidder_id = b.bidder_id
         WHERE i.auction_id = ? AND b.removed_at IS NULL
         ORDER BY b.placed_at DESC, b.id DESC
         LIMIT ?`,
        auctionId, limit
    );
}

/** Stamps a bid removed. Returns true only for the call that removed it. */
async function softRemove(bidId, {reason, removedBy, nowIso}) {
    const result = await db.run(
        'UPDATE auction_bids SET removed_at = ?, removed_reason = ?, removed_by = ? WHERE id = ? AND removed_at IS NULL',
        nowIso, reason, removedBy || null, bidId
    );
    return result.changes === 1;
}

// --- Paddles ---

async function getPaddle(auctionId, bidderId) {
    return db.get('SELECT * FROM auction_paddles WHERE auction_id = ? AND bidder_id = ?', auctionId, bidderId);
}

/**
 * Gives a bidder the next paddle number in an auction, recording their shipping
 * acknowledgement. Idempotent: an existing paddle is returned as-is. Two first bids racing for
 * the same number hit the unique index, so a collision is retried.
 */
async function assignPaddle(auctionId, bidderId, nowIso) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const existing = await getPaddle(auctionId, bidderId);
        if (existing) return existing;
        try {
            const max = await db.get('SELECT MAX(paddle_number) AS m FROM auction_paddles WHERE auction_id = ?', auctionId);
            await db.run(
                'INSERT INTO auction_paddles (auction_id, bidder_id, paddle_number, shipping_ack_at) VALUES (?, ?, ?, ?)',
                auctionId, bidderId, (Number(max?.m) || 0) + 1, nowIso
            );
        } catch (err) {
            if (!/unique|duplicate/i.test(err.message)) throw err;
        }
    }
    const paddle = await getPaddle(auctionId, bidderId);
    if (!paddle) throw new Error('Could not assign a bidder number');
    return paddle;
}

// --- Outbid email throttle ---

/**
 * Claims the right to email `bidderId` about `itemId`: true when they haven't been emailed
 * about it since `cutoffIso`. The claim is written before the send, so two bids racing to
 * notify the same person send one email.
 */
async function claimOutbidNotice(itemId, bidderId, nowIso, cutoffIso) {
    const updated = await db.run(
        `UPDATE auction_outbid_notices SET last_sent_at = ?, sent_count = sent_count + 1
         WHERE item_id = ? AND bidder_id = ? AND last_sent_at < ?`,
        nowIso, itemId, bidderId, cutoffIso
    );
    if (updated.changes === 1) return true;
    // ON CONFLICT keeps this a no-op when a row exists (sent recently); it also stops the
    // PostgreSQL adapter appending RETURNING id, which this table has no column for.
    const inserted = await db.run(
        `INSERT INTO auction_outbid_notices (item_id, bidder_id, last_sent_at, sent_count)
         VALUES (?, ?, ?, 1) ON CONFLICT DO NOTHING`,
        itemId, bidderId, nowIso
    );
    return inserted.changes === 1;
}

module.exports = {
    get, insert, listPublic, listAdmin, listRecentForAuction, softRemove, getPaddle, assignPaddle, claimOutbidNotice,
};
