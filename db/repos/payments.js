const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

async function create({ member_id, stripe_session_id, amount_cents, currency, status, description, payment_method }) {
    const actor = getActor();
    const result = await db.run(
        `INSERT INTO payments (member_id, stripe_session_id, amount_cents, currency, status, description,
                               payment_method, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        member_id, stripe_session_id || null, amount_cents, currency || 'usd', status || 'pending', description || null, payment_method || 'stripe', actor.id || null, actor.id || null
  );
    const row = await db.get('SELECT * FROM payments WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'payments',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return result;
}

async function completeBySessionId(sessionId, paymentIntent) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM payments WHERE stripe_session_id = ?', sessionId);
    const result = await db.run(
        `UPDATE payments SET status = 'completed', stripe_payment_intent = ?, updated_at = datetime('now'), updated_by = ?
     WHERE stripe_session_id = ?`,
        paymentIntent, actor.id || null, sessionId
  );
    if (old) {
        const row = await db.get('SELECT * FROM payments WHERE id = ?', old.id);
        await auditLog.insert({
            tableName: 'payments',
            recordId: old.id,
            action: 'UPDATE',
            actor,
            oldValues: old,
            newValues: row
        });
    }
    return result;
}

/**
 * Marks a still-pending checkout as failed. The `status = 'pending'` guard makes this
 * idempotent on Stripe webhook redelivery and stops a late-arriving expiry event from
 * clobbering a payment that actually completed.
 */
async function failBySessionId(sessionId, reason) {
    const actor = getActor();
    const old = await db.get("SELECT * FROM payments WHERE stripe_session_id = ? AND status = 'pending'", sessionId);
    if (!old) return null;

    const result = await db.run(
        `UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = datetime('now'), updated_by = ?
     WHERE stripe_session_id = ? AND status = 'pending'`,
        reason || null, actor.id || null, sessionId
    );
    const row = await db.get('SELECT * FROM payments WHERE id = ?', old.id);
    await auditLog.insert({
        tableName: 'payments',
        recordId: old.id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return result;
}

/**
 * Records a declined payment that has no pending row to update — a card failure on a
 * PaymentIntent. Idempotent on redelivery via the payment-intent lookup.
 */
async function recordFailure({ member_id, stripe_payment_intent, amount_cents, reason }) {
    const actor = getActor();
    if (stripe_payment_intent) {
        const existing = await db.get(
            "SELECT id FROM payments WHERE stripe_payment_intent = ? AND status = 'failed'",
            stripe_payment_intent
        );
        if (existing) return null;
    }

    const result = await db.run(
        `INSERT INTO payments (member_id, stripe_payment_intent, amount_cents, currency, status, description,
                               failure_reason, payment_method, created_by, updated_by)
         VALUES (?, ?, ?, 'usd', 'failed', ?, ?, 'stripe', ?, ?)`,
        member_id, stripe_payment_intent || null, amount_cents || 0,
        `${new Date().getFullYear()} Membership Dues`, reason || null,
        actor.id || null, actor.id || null
    );
    const row = await db.get('SELECT * FROM payments WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'payments',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return result;
}

async function findById(id) {
    return db.get('SELECT * FROM payments WHERE id = ?', id);
}

/** UTC 'YYYY-MM-DD HH:MM:SS', the shape datetime('now') writes, for binding as a parameter. */
function sqlTimestamp(date) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Soft-deletes a mistaken offline payment (issue #108). The row stays — as 'voided', with
 * a mandatory reason — so the audit trail and any membership_years citation survive, and
 * sumCompletedCents drops it because it only ever counted 'completed'.
 *
 * Refuses (returns null, writes nothing) unless the payment is completed and not a Stripe
 * charge: voiding the local row of a real charge would silently desynchronize the app
 * from Stripe without refunding anything. The status guard in the WHERE makes a double
 * submit of the void form a no-op rather than a second audit row.
 */
async function voidById(id, { reason, note }) {
    const actor = getActor();
    const doomed = await db.get('SELECT * FROM payments WHERE id = ?', id);
    if (!doomed || doomed.status !== 'completed' || doomed.payment_method === 'stripe') return null;

    const result = await db.run(
        `UPDATE payments SET status = 'voided', void_reason = ?, void_note = ?, voided_at = ?,
                             updated_at = datetime('now'), updated_by = ?
         WHERE id = ? AND status = 'completed'`,
        reason, note || null, sqlTimestamp(new Date()), actor.id || null, id
    );
    if (!result.changes) return null;

    const row = await db.get('SELECT * FROM payments WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'payments',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: doomed,
        newValues: row
    });
    return row;
}

/**
 * The most recent completed payment matching a would-be offline payment exactly, recorded
 * at or after `since` — the server-side half of the duplicate-submit guard. `since` is a
 * JS-computed timestamp bound as a parameter: comparing created_at to date('now') inline
 * behaves differently across the two dialects. Voided rows never match, so a corrected
 * re-record after a void is not mistaken for a duplicate.
 */
async function findRecentCompletedDuplicate({ memberId, amountCents, paymentMethod, since }) {
    return db.get(
        `SELECT * FROM payments
         WHERE member_id = ? AND amount_cents = ? AND payment_method = ?
           AND status = 'completed' AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
        memberId, amountCents, paymentMethod, sqlTimestamp(since)
    );
}

async function findByMemberId(memberId) {
  return await db.all('SELECT * FROM payments WHERE member_id = ? ORDER BY created_at DESC', memberId);
}

async function listWithMembers({ limit, offset }) {
  const totalRow = await db.get('SELECT COUNT(*) as c FROM payments');
  const total = totalRow ? totalRow.c : 0;
  const payments = await db.all(
    `SELECT p.*, m.first_name, m.last_name, m.member_number, mp.label AS period_label
     FROM payments p
     LEFT JOIN members m ON p.member_id = m.id
     LEFT JOIN membership_years my ON my.payment_id = p.id AND my.member_id = p.member_id
     LEFT JOIN membership_periods mp ON mp.id = my.membership_period_id
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    limit, offset
  );
  return { payments, total };
}

async function listAllWithMembers() {
  return await db.all(
    `SELECT p.*, m.first_name, m.last_name, m.member_number, mp.label AS period_label
     FROM payments p
     LEFT JOIN members m ON p.member_id = m.id
     LEFT JOIN membership_years my ON my.payment_id = p.id AND my.member_id = p.member_id
     LEFT JOIN membership_periods mp ON mp.id = my.membership_period_id
     ORDER BY p.created_at DESC`
  );
}

async function listRecent(limit) {
  return await db.all(
    `SELECT p.*, m.first_name, m.last_name, m.member_number, mp.label AS period_label
     FROM payments p
     LEFT JOIN members m ON p.member_id = m.id
     LEFT JOIN membership_years my ON my.payment_id = p.id AND my.member_id = p.member_id
     LEFT JOIN membership_periods mp ON mp.id = my.membership_period_id
     ORDER BY p.created_at DESC LIMIT ?`,
    limit
  );
}

async function sumCompletedCents() {
  const row = await db.get("SELECT COALESCE(SUM(amount_cents), 0) as c FROM payments WHERE status = 'completed'");
  return row ? row.c : 0;
}

async function countAll() {
  const row = await db.get('SELECT COUNT(*) as c FROM payments');
  return row ? row.c : 0;
}

async function findByStripeSession(sessionId) {
    return db.get('SELECT * FROM payments WHERE stripe_session_id = ?', sessionId);
}

module.exports = {
  create,
  completeBySessionId,
  failBySessionId,
  recordFailure,
  findByMemberId,
  listWithMembers,
  listAllWithMembers,
  listRecent,
  sumCompletedCents,
  countAll,
  findByStripeSession,
  findById,
  voidById,
  findRecentCompletedDuplicate,
};
