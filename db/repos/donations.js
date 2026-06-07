const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

async function create({donor_name, donor_email, stripe_session_id, amount_cents, currency, status}) {
    const actor = getActor();
    const result = await db.run(
        `INSERT INTO donations (donor_name, donor_email, stripe_session_id, amount_cents, currency, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
        donor_name, donor_email, stripe_session_id || null, amount_cents, currency || 'usd', status || 'pending'
    );
    const row = await db.get('SELECT * FROM donations WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'donations',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row,
    });
    return result;
}

async function findBySessionId(sessionId) {
    return db.get('SELECT * FROM donations WHERE stripe_session_id = ?', sessionId);
}

// System-only op (links a freshly created Stripe session to a pending row); no audit entry.
async function attachSession(id, sessionId) {
    await db.run(
        "UPDATE donations SET stripe_session_id = ?, updated_at = datetime('now') WHERE id = ?",
        sessionId, id
    );
}

async function complete(sessionId, {paymentIntent, memberId, donationId} = {}) {
    // Resolve the row by session id, falling back to the donation id carried in Stripe
    // metadata (covers the rare case where attachSession failed after the session was created).
    let old = sessionId
        ? await db.get('SELECT * FROM donations WHERE stripe_session_id = ?', sessionId)
        : null;
    if (!old && donationId) {
        old = await db.get('SELECT * FROM donations WHERE id = ?', donationId);
    }
    if (!old) return false;

    // Atomic guard: only the row still not 'completed' is updated. Concurrent or
    // duplicate Stripe webhook deliveries that race here see changes === 0 and bail,
    // so the confirmation email is sent exactly once.
    const result = await db.run(
        `UPDATE donations SET status = 'completed', stripe_session_id = ?, stripe_payment_intent = ?, member_id = ?, updated_at = datetime('now')
     WHERE id = ? AND status != 'completed'`,
        sessionId || old.stripe_session_id || null, paymentIntent || null, memberId || null, old.id
    );
    if (!result.changes) return false;

    const actor = getActor();
    const row = await db.get('SELECT * FROM donations WHERE id = ?', old.id);
    await auditLog.insert({
        tableName: 'donations',
        recordId: old.id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row,
    });
    return true;
}

async function findByMemberId(memberId) {
    return db.all('SELECT * FROM donations WHERE member_id = ? ORDER BY created_at DESC', memberId);
}

async function listWithDonors({limit, offset}) {
    const totalRow = await db.get('SELECT COUNT(*) as c FROM donations');
    const total = totalRow ? totalRow.c : 0;
    const donations = await db.all(
        'SELECT * FROM donations ORDER BY created_at DESC LIMIT ? OFFSET ?',
        limit, offset
    );
    return {donations, total};
}

async function countAll() {
    const row = await db.get('SELECT COUNT(*) as c FROM donations');
    return row ? row.c : 0;
}

async function sumCompletedCents() {
    const row = await db.get("SELECT COALESCE(SUM(amount_cents), 0) as c FROM donations WHERE status = 'completed'");
    return row ? row.c : 0;
}

module.exports = {
    create,
    findBySessionId,
    attachSession,
    complete,
    findByMemberId,
    listWithDonors,
    countAll,
    sumCompletedCents,
};
