const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

const FIELDS = ['title', 'description', 'status', 'starts_at', 'ends_at', 'min_increment_cents', 'shipping_notice'];

async function get(id) {
    return db.get('SELECT * FROM auctions WHERE id = ?', id);
}

/** All auctions, newest window first, each with item and live-bid counts. */
async function list() {
    const rows = await db.all(
        `SELECT a.*,
                (SELECT COUNT(*) FROM auction_items i WHERE i.auction_id = a.id) AS item_count,
                (SELECT COUNT(*) FROM auction_bids b JOIN auction_items i ON i.id = b.item_id
                  WHERE i.auction_id = a.id AND b.removed_at IS NULL) AS bid_count
         FROM auctions a
         ORDER BY a.starts_at DESC, a.id DESC`
    );
    return rows.map(r => ({...r, item_count: Number(r.item_count), bid_count: Number(r.bid_count)}));
}

async function create(fields) {
    const actor = getActor();
    const values = FIELDS.map(f => fields[f] ?? null);
    const result = await db.run(
        `INSERT INTO auctions (${FIELDS.join(', ')}, created_by, updated_by)
         VALUES (${FIELDS.map(() => '?').join(', ')}, ?, ?)`,
        ...values, actor.id || null, actor.id || null
    );
    const row = await get(result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'auctions', recordId: row.id, action: 'INSERT', actor, oldValues: null, newValues: row,
    });
    return row;
}

/** Updates only the fields present in `changes`. */
async function update(id, changes) {
    const actor = getActor();
    const old = await get(id);
    if (!old) return null;
    const keys = FIELDS.filter(f => Object.prototype.hasOwnProperty.call(changes, f));
    if (!keys.length) return old;
    await db.run(
        `UPDATE auctions SET ${keys.map(k => `${k}=?`).join(', ')}, updated_at=datetime('now'), updated_by=? WHERE id=?`,
        ...keys.map(k => changes[k] ?? null), actor.id || null, id
    );
    const row = await get(id);
    await auditLog.insert({
        tableName: 'auctions', recordId: id, action: 'UPDATE', actor, oldValues: old, newValues: row,
    });
    return row;
}

/**
 * Deletes a draft auction that has never taken a bid (items and photos cascade). Returns the
 * deleted row, or null when refused. Photo files are the caller's to remove from storage.
 */
async function remove(id) {
    const actor = getActor();
    const doomed = await get(id);
    if (!doomed || doomed.status !== 'draft') return null;
    const bids = await db.get(
        `SELECT COUNT(*) AS n FROM auction_bids b JOIN auction_items i ON i.id = b.item_id WHERE i.auction_id = ?`,
        id
    );
    if (Number(bids.n) > 0) return null;
    await db.run('DELETE FROM auctions WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'auctions', recordId: id, action: 'DELETE', actor, oldValues: doomed, newValues: null,
    });
    return doomed;
}

/** The auction the public nav should point at: published and not yet ended, soonest first. */
async function findNavCandidate(nowIso) {
    return db.get(
        `SELECT * FROM auctions WHERE status = 'published' AND ends_at > ?
         ORDER BY starts_at ASC, id ASC LIMIT 1`,
        nowIso
    );
}

/** Published auctions whose window has ended but whose winners haven't been notified. */
async function findClosedUnnotified(nowIso) {
    return db.all(
        `SELECT * FROM auctions WHERE status = 'published' AND ends_at <= ? AND winners_notified_at IS NULL
         ORDER BY ends_at ASC`,
        nowIso
    );
}

/** Claims the one-time winner notification. True for exactly one caller. */
async function claimWinnersNotified(id, nowIso) {
    const result = await db.run(
        'UPDATE auctions SET winners_notified_at = ? WHERE id = ? AND winners_notified_at IS NULL',
        nowIso, id
    );
    return result.changes === 1;
}

module.exports = {FIELDS, get, list, create, update, remove, findNavCandidate, findClosedUnnotified, claimWinnersNotified};
