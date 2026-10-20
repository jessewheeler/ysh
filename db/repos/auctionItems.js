const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

const FIELDS = ['title', 'description', 'starting_bid_cents', 'sort_order'];

function normalize(row) {
    if (!row) return row;
    return {
        ...row,
        bid_count: Number(row.bid_count),
        withdrawn: Number(row.withdrawn),
        current_bid_cents: row.current_bid_cents == null ? null : Number(row.current_bid_cents),
        starting_bid_cents: Number(row.starting_bid_cents),
    };
}

async function get(id) {
    return normalize(await db.get('SELECT * FROM auction_items WHERE id = ?', id));
}

/** An item with the auction fields bidding depends on, prefixed `auction_`. */
async function getWithAuction(id) {
    const row = await db.get(
        `SELECT i.*, a.status AS auction_status, a.starts_at AS auction_starts_at, a.ends_at AS auction_ends_at,
                a.min_increment_cents AS auction_min_increment_cents, a.title AS auction_title
         FROM auction_items i JOIN auctions a ON a.id = i.auction_id
         WHERE i.id = ?`,
        id
    );
    if (!row) return row;
    return {...normalize(row), auction_min_increment_cents: Number(row.auction_min_increment_cents)};
}

/**
 * Items in display order, each with its first photo as `cover_url` and its high bidder's paddle
 * as `high_paddle`. Withdrawn items are left out unless asked for.
 */
async function listByAuction(auctionId, {includeWithdrawn = false} = {}) {
    const rows = await db.all(
        `SELECT i.*,
                (SELECT p.url FROM auction_item_photos p WHERE p.item_id = i.id
                  ORDER BY p.sort_order ASC, p.id ASC LIMIT 1) AS cover_url,
                (SELECT pd.paddle_number FROM auction_paddles pd
                  WHERE pd.auction_id = i.auction_id AND pd.bidder_id = i.high_bidder_id) AS high_paddle
         FROM auction_items i
         WHERE i.auction_id = ? ${includeWithdrawn ? '' : 'AND i.withdrawn = 0'}
         ORDER BY i.sort_order ASC, i.id ASC`,
        auctionId
    );
    return rows.map(r => ({...normalize(r), high_paddle: r.high_paddle == null ? null : Number(r.high_paddle)}));
}

/** Admin view: every item with its high bidder's contact details and paddle. */
async function listForAdmin(auctionId) {
    const rows = await db.all(
        `SELECT i.*, b.name AS high_bidder_name, b.email AS high_bidder_email, b.phone AS high_bidder_phone,
                m.member_number AS high_bidder_member_number,
                (SELECT pd.paddle_number FROM auction_paddles pd
                  WHERE pd.auction_id = i.auction_id AND pd.bidder_id = i.high_bidder_id) AS high_paddle,
                (SELECT COUNT(*) FROM auction_item_photos p WHERE p.item_id = i.id) AS photo_count
         FROM auction_items i
         LEFT JOIN auction_bidders b ON b.id = i.high_bidder_id
         LEFT JOIN members m ON m.id = b.member_id
         WHERE i.auction_id = ?
         ORDER BY i.sort_order ASC, i.id ASC`,
        auctionId
    );
    return rows.map(r => ({
        ...normalize(r),
        high_paddle: r.high_paddle == null ? null : Number(r.high_paddle),
        photo_count: Number(r.photo_count),
    }));
}

async function create(auctionId, fields) {
    const actor = getActor();
    const max = await db.get('SELECT MAX(sort_order) AS m FROM auction_items WHERE auction_id = ?', auctionId);
    const sortOrder = fields.sort_order ?? (Number(max?.m) || 0) + 1;
    const result = await db.run(
        `INSERT INTO auction_items (auction_id, title, description, starting_bid_cents, sort_order, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        auctionId, fields.title, fields.description ?? null, fields.starting_bid_cents, sortOrder,
        actor.id || null, actor.id || null
    );
    const row = await get(result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'auction_items', recordId: row.id, action: 'INSERT', actor, oldValues: null, newValues: row,
    });
    return row;
}

/**
 * Updates the fields present in `changes`. The starting bid is locked once anyone has bid —
 * moving it would change what the existing bids were measured against — so a change to it is
 * dropped and `startingBidLocked` is reported.
 */
async function update(id, changes) {
    const actor = getActor();
    const old = await get(id);
    if (!old) return {item: null};
    let keys = FIELDS.filter(f => Object.prototype.hasOwnProperty.call(changes, f));
    let startingBidLocked = false;
    if (old.bid_count > 0 && keys.includes('starting_bid_cents')
        && Number(changes.starting_bid_cents) !== old.starting_bid_cents) {
        keys = keys.filter(k => k !== 'starting_bid_cents');
        startingBidLocked = true;
    }
    if (!keys.length) return {item: old, startingBidLocked};
    await db.run(
        `UPDATE auction_items SET ${keys.map(k => `${k}=?`).join(', ')}, updated_at=datetime('now'), updated_by=? WHERE id=?`,
        ...keys.map(k => changes[k] ?? null), actor.id || null, id
    );
    const row = await get(id);
    await auditLog.insert({
        tableName: 'auction_items', recordId: id, action: 'UPDATE', actor, oldValues: old, newValues: row,
    });
    return {item: row, startingBidLocked};
}

async function setWithdrawn(id, withdrawn) {
    const actor = getActor();
    const old = await get(id);
    if (!old) return null;
    await db.run(
        "UPDATE auction_items SET withdrawn = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
        withdrawn ? 1 : 0, actor.id || null, id
    );
    const row = await get(id);
    await auditLog.insert({
        tableName: 'auction_items', recordId: id, action: 'UPDATE', actor, oldValues: old, newValues: row,
    });
    return row;
}

/**
 * Deletes an item nobody has bid on, returning its photo URLs so the caller can remove the
 * files. Returns null when refused (withdraw the item instead).
 */
async function remove(id) {
    const actor = getActor();
    const doomed = await get(id);
    if (!doomed) return null;
    const bids = await db.get('SELECT COUNT(*) AS n FROM auction_bids WHERE item_id = ?', id);
    if (Number(bids.n) > 0) return null;
    const photos = await listPhotos(id);
    await db.run('DELETE FROM auction_items WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'auction_items', recordId: id, action: 'DELETE', actor, oldValues: doomed, newValues: null,
    });
    return {item: doomed, photoUrls: photos.map(p => p.url)};
}

/**
 * The bid write. Moves the high bid from the snapshot the caller read (expected*) to the new
 * one, but only if nothing changed in between and the auction is open at `nowIso`. Returns true
 * when this caller won the swap. Works the same in SQLite and PostgreSQL.
 */
async function casHighBid({itemId, expectedCents, expectedBidderId, newCents, bidderId, nowIso}) {
    const result = await db.run(
        `UPDATE auction_items
         SET current_bid_cents = ?, high_bidder_id = ?, bid_count = bid_count + 1, updated_at = datetime('now')
         WHERE id = ? AND withdrawn = 0
           AND COALESCE(current_bid_cents, -1) = ? AND COALESCE(high_bidder_id, -1) = ?
           AND EXISTS (SELECT 1 FROM auctions a WHERE a.id = auction_items.auction_id
                       AND a.status = 'published' AND a.starts_at <= ? AND a.ends_at > ?)`,
        newCents, bidderId, itemId,
        expectedCents == null ? -1 : expectedCents,
        expectedBidderId == null ? -1 : expectedBidderId,
        nowIso, nowIso
    );
    return result.changes === 1;
}

/** Resets the denormalized high bid from the live bids (after an admin removes one). */
async function recomputeHigh(itemId) {
    const top = await db.get(
        `SELECT bidder_id, amount_cents FROM auction_bids WHERE item_id = ? AND removed_at IS NULL
         ORDER BY amount_cents DESC, placed_at ASC LIMIT 1`,
        itemId
    );
    const count = await db.get('SELECT COUNT(*) AS n FROM auction_bids WHERE item_id = ? AND removed_at IS NULL', itemId);
    await db.run(
        "UPDATE auction_items SET current_bid_cents = ?, high_bidder_id = ?, bid_count = ?, updated_at = datetime('now') WHERE id = ?",
        top ? top.amount_cents : null, top ? top.bidder_id : null, Number(count.n), itemId
    );
    return get(itemId);
}

/** Items that sold, with the winner's contact details, for the winners page and CSV. */
async function listWinners(auctionId) {
    return listForAdmin(auctionId);
}

async function markWinnerEmailed(itemIds, nowIso) {
    for (const id of itemIds) {
        await db.run('UPDATE auction_items SET winner_emailed_at = ? WHERE id = ? AND winner_emailed_at IS NULL', nowIso, id);
    }
}

// --- Photos ---

async function listPhotos(itemId) {
    return db.all('SELECT * FROM auction_item_photos WHERE item_id = ? ORDER BY sort_order ASC, id ASC', itemId);
}

async function listPhotosForItems(itemIds) {
    if (!itemIds.length) return [];
    return db.all(
        `SELECT * FROM auction_item_photos WHERE item_id IN (${itemIds.map(() => '?').join(', ')})
         ORDER BY sort_order ASC, id ASC`,
        ...itemIds
    );
}

async function getPhoto(photoId) {
    return db.get('SELECT * FROM auction_item_photos WHERE id = ?', photoId);
}

async function addPhoto(itemId, url) {
    const actor = getActor();
    const max = await db.get('SELECT MAX(sort_order) AS m FROM auction_item_photos WHERE item_id = ?', itemId);
    const result = await db.run(
        'INSERT INTO auction_item_photos (item_id, url, sort_order, created_by) VALUES (?, ?, ?, ?)',
        itemId, url, (Number(max?.m) || 0) + 1, actor.id || null
    );
    const row = await getPhoto(result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'auction_item_photos', recordId: row.id, action: 'INSERT', actor, oldValues: null, newValues: row,
    });
    return row;
}

/** Deletes a photo row, returning it (the caller removes the file from storage). */
async function deletePhoto(photoId) {
    const actor = getActor();
    const doomed = await getPhoto(photoId);
    if (!doomed) return null;
    await db.run('DELETE FROM auction_item_photos WHERE id = ?', photoId);
    await auditLog.insert({
        tableName: 'auction_item_photos', recordId: photoId, action: 'DELETE', actor, oldValues: doomed, newValues: null,
    });
    return doomed;
}

/** Swaps a photo with its neighbour. The first photo is the item's cover. */
async function movePhoto(photoId, direction) {
    const photo = await getPhoto(photoId);
    if (!photo) return false;
    const photos = await listPhotos(photo.item_id);
    const idx = photos.findIndex(p => p.id === photo.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= photos.length) return false;
    // Renumber the whole list so ties left by older rows can't make a swap a no-op.
    const ordered = photos.slice();
    [ordered[idx], ordered[swapIdx]] = [ordered[swapIdx], ordered[idx]];
    for (let i = 0; i < ordered.length; i++) {
        await db.run('UPDATE auction_item_photos SET sort_order = ? WHERE id = ?', i + 1, ordered[i].id);
    }
    return true;
}

module.exports = {
    FIELDS, get, getWithAuction, listByAuction, listForAdmin, create, update, setWithdrawn, remove,
    casHighBid, recomputeHigh, listWinners, markWinnerEmailed,
    listPhotos, listPhotosForItems, getPhoto, addPhoto, deletePhoto, movePhoto,
};
