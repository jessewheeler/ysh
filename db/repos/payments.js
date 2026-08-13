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
};
