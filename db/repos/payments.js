const db = require('../database');

function create({ member_id, stripe_session_id, amount_cents, currency, status, description, payment_method }) {
  return db.prepare(
    `INSERT INTO payments (member_id, stripe_session_id, amount_cents, currency, status, description, payment_method)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(member_id, stripe_session_id || null, amount_cents, currency || 'usd', status || 'pending', description || null, payment_method || 'stripe');
}

function completeBySessionId(sessionId, paymentIntent) {
  return db.prepare(
    `UPDATE payments SET status = 'completed', stripe_payment_intent = ?, updated_at = datetime('now')
     WHERE stripe_session_id = ?`
  ).run(paymentIntent, sessionId);
}

function findByMemberId(memberId) {
  return db.prepare('SELECT * FROM payments WHERE member_id = ? ORDER BY created_at DESC').all(memberId);
}

function listWithMembers({ limit, offset }) {
  const total = db.prepare('SELECT COUNT(*) as c FROM payments').get().c;
  const payments = db.prepare(
    `SELECT p.*, m.first_name, m.last_name, m.member_number
     FROM payments p LEFT JOIN members m ON p.member_id = m.id
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);
  return { payments, total };
}

function listAllWithMembers() {
  return db.prepare(
    `SELECT p.*, m.first_name, m.last_name, m.member_number
     FROM payments p LEFT JOIN members m ON p.member_id = m.id
     ORDER BY p.created_at DESC`
  ).all();
}

function listRecent(limit) {
  return db.prepare(
    `SELECT p.*, m.first_name, m.last_name, m.member_number
     FROM payments p LEFT JOIN members m ON p.member_id = m.id
     ORDER BY p.created_at DESC LIMIT ?`
  ).all(limit);
}

function sumCompletedCents() {
  return db.prepare("SELECT COALESCE(SUM(amount_cents), 0) as c FROM payments WHERE status = 'completed'").get().c;
}

function countAll() {
  return db.prepare('SELECT COUNT(*) as c FROM payments').get().c;
}

module.exports = {
  create,
  completeBySessionId,
  findByMemberId,
  listWithMembers,
  listAllWithMembers,
  listRecent,
  sumCompletedCents,
  countAll,
};
