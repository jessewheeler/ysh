const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

// Bidder sign-up and OTP writes are system writes made by the bidder themselves, so they are
// not audited (same as members.setOtp). Admin blocking is.

async function get(id) {
    return db.get('SELECT * FROM auction_bidders WHERE id = ?', id);
}

async function findByEmail(email) {
    return db.get('SELECT * FROM auction_bidders WHERE email = ?', String(email || '').trim().toLowerCase());
}

/** Creates a bidder who has not proven their email yet. Name and phone are filled in on verify. */
async function createUnverified({email, name, phone}) {
    const result = await db.run(
        'INSERT INTO auction_bidders (email, name, phone) VALUES (?, ?, ?)',
        String(email).trim().toLowerCase(), name, phone || null
    );
    return get(result.lastInsertRowid);
}

/**
 * Stamps verified_at and, now that the email is proven, saves the name and phone the person
 * typed at sign-in. memberId links them to a member with the same email.
 */
async function markVerified(id, {name, phone, memberId, nowIso}) {
    await db.run(
        `UPDATE auction_bidders
         SET name = COALESCE(?, name), phone = COALESCE(?, phone), member_id = ?,
             verified_at = COALESCE(verified_at, ?), updated_at = datetime('now')
         WHERE id = ?`,
        name || null, phone || null, memberId || null, nowIso, id
    );
    return get(id);
}

async function setOtp(id, {otpHash, expiresAt}) {
    return db.run(
        "UPDATE auction_bidders SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0, updated_at = datetime('now') WHERE id = ?",
        otpHash, expiresAt, id
    );
}

async function incrementOtpAttempts(id) {
    return db.run(
        "UPDATE auction_bidders SET otp_attempts = otp_attempts + 1, updated_at = datetime('now') WHERE id = ?",
        id
    );
}

async function clearOtp(id) {
    return db.run(
        "UPDATE auction_bidders SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0, updated_at = datetime('now') WHERE id = ?",
        id
    );
}

/** Blocks (or unblocks) a bidder from placing further bids. Existing bids are untouched. */
async function setBlocked(id, blocked, nowIso = new Date().toISOString()) {
    const actor = getActor();
    const old = await get(id);
    if (!old) return null;
    await db.run(
        "UPDATE auction_bidders SET blocked_at = ?, updated_at = datetime('now') WHERE id = ?",
        blocked ? nowIso : null, id
    );
    const row = await get(id);
    await auditLog.insert({
        tableName: 'auction_bidders', recordId: id, action: 'UPDATE', actor, oldValues: old, newValues: row,
    });
    return row;
}

/** Everyone holding a paddle in an auction, with how many live bids they've placed there. */
async function listByAuction(auctionId) {
    const rows = await db.all(
        `SELECT b.id, b.email, b.name, b.phone, b.member_id, b.blocked_at, p.paddle_number, p.shipping_ack_at,
                m.member_number,
                (SELECT COUNT(*) FROM auction_bids x JOIN auction_items i ON i.id = x.item_id
                  WHERE x.bidder_id = b.id AND i.auction_id = p.auction_id AND x.removed_at IS NULL) AS bid_count
         FROM auction_paddles p
         JOIN auction_bidders b ON b.id = p.bidder_id
         LEFT JOIN members m ON m.id = b.member_id
         WHERE p.auction_id = ?
         ORDER BY p.paddle_number ASC`,
        auctionId
    );
    return rows.map(r => ({...r, bid_count: Number(r.bid_count)}));
}

module.exports = {
    get, findByEmail, createUnverified, markVerified, setOtp, incrementOtpAttempts, clearOtp, setBlocked,
    listByAuction,
};
