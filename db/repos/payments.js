const db = require('../database');

async function create({ member_id, stripe_session_id, amount_cents, currency, status, description, payment_method }) {
  return await db.run(
    `INSERT INTO payments (member_id, stripe_session_id, amount_cents, currency, status, description, payment_method)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    member_id, stripe_session_id || null, amount_cents, currency || 'usd', status || 'pending', description || null, payment_method || 'stripe'
  );
}

async function completeBySessionId(sessionId, paymentIntent) {
  return await db.run(
    `UPDATE payments SET status = 'completed', stripe_payment_intent = ?, updated_at = datetime('now')
     WHERE stripe_session_id = ?`,
    paymentIntent, sessionId
  );
}

async function findByMemberId(memberId) {
  return await db.all('SELECT * FROM payments WHERE member_id = ? ORDER BY created_at DESC', memberId);
}

async function listWithMembers({ limit, offset }) {
  const totalRow = await db.get('SELECT COUNT(*) as c FROM payments');
  const total = totalRow ? totalRow.c : 0;
  const payments = await db.all(
    `SELECT p.*, m.first_name, m.last_name, m.member_number
     FROM payments p LEFT JOIN members m ON p.member_id = m.id
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    limit, offset
  );
  return { payments, total };
}

async function listAllWithMembers() {
  return await db.all(
    `SELECT p.*, m.first_name, m.last_name, m.member_number
     FROM payments p LEFT JOIN members m ON p.member_id = m.id
     ORDER BY p.created_at DESC`
  );
}

async function listRecent(limit) {
  return await db.all(
    `SELECT p.*, m.first_name, m.last_name, m.member_number
     FROM payments p LEFT JOIN members m ON p.member_id = m.id
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
