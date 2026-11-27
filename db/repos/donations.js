const db = require('../database');
const { getActor } = require('../audit-context');
const auditLog = require('./auditLog');

// Donations (issue #126). amount_cents is what Stripe charged: gift_cents plus the
// fee_cover_cents the donor opted to add. An anonymous row carries no donor name, email or
// member link — the table's CHECK enforces that, and create() nulls them regardless of input.

const WITH_FUND = `
  SELECT d.*, f.name AS fund_name
  FROM donations d
  LEFT JOIN donation_funds f ON f.id = d.fund_id
`;

async function findById(id) {
  return await db.get(`${WITH_FUND} WHERE d.id = ?`, id);
}

async function findBySessionId(sessionId) {
  return await db.get(`${WITH_FUND} WHERE d.stripe_session_id = ?`, sessionId);
}

async function create({ donor_name, donor_email, is_anonymous, fund_id, gift_cents, fee_cover_cents, member_id }) {
  const actor = getActor();
  const anonymous = is_anonymous ? 1 : 0;
  const gift = gift_cents;
  const feeCover = fee_cover_cents || 0;
  const result = await db.run(
    `INSERT INTO donations
       (donor_name, donor_email, is_anonymous, fund_id, gift_cents, fee_cover_cents, amount_cents, member_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    anonymous ? null : donor_name,
    anonymous ? null : donor_email,
    anonymous,
    fund_id || null,
    gift,
    feeCover,
    gift + feeCover,
    anonymous ? null : (member_id || null)
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
  return row;
}

// System-only op (links a freshly created Stripe session to a pending row); no audit entry.
async function attachSession(id, sessionId) {
  await db.run(
    "UPDATE donations SET stripe_session_id = ?, updated_at = datetime('now') WHERE id = ?",
    sessionId, id
  );
}

// Marks a donation completed. Returns true only for the call that made the change, so the
// caller can send the confirmation email exactly once across Stripe's webhook retries.
// The row is found by session id, falling back to the donation id carried in Stripe metadata
// (covers attachSession failing after the session was created).
async function complete(sessionId, { paymentIntent, memberId, donationId } = {}) {
  let old = sessionId
    ? await db.get('SELECT * FROM donations WHERE stripe_session_id = ?', sessionId)
    : null;
  if (!old && donationId) {
    old = await db.get('SELECT * FROM donations WHERE id = ?', donationId);
  }
  if (!old) return false;

  // An anonymous gift is never linked, whatever the caller passes. A named gift keeps a link
  // made at checkout time when the completion-time lookup finds nobody.
  const linkedMemberId = old.is_anonymous ? null : (memberId || old.member_id || null);

  // Atomic guard: a concurrent or duplicate delivery sees changes === 0 and bails.
  const result = await db.run(
    `UPDATE donations
        SET status = 'completed', stripe_session_id = ?, stripe_payment_intent = ?, member_id = ?,
            updated_at = datetime('now')
      WHERE id = ? AND status != 'completed'`,
    sessionId || old.stripe_session_id || null, paymentIntent || null, linkedMemberId, old.id
  );
  if (!result.changes) return false;

  const row = await db.get('SELECT * FROM donations WHERE id = ?', old.id);
  await auditLog.insert({
    tableName: 'donations',
    recordId: old.id,
    action: 'UPDATE',
    actor: getActor(),
    oldValues: old,
    newValues: row,
  });
  return true;
}

// An abandoned checkout (checkout.session.expired). Only a pending row moves; a completed
// donation is never downgraded by a late or out-of-order event.
async function failBySessionId(sessionId) {
  const old = await db.get('SELECT * FROM donations WHERE stripe_session_id = ?', sessionId);
  if (!old) return false;
  const result = await db.run(
    "UPDATE donations SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND status = 'pending'",
    old.id
  );
  if (!result.changes) return false;
  const row = await db.get('SELECT * FROM donations WHERE id = ?', old.id);
  await auditLog.insert({
    tableName: 'donations',
    recordId: old.id,
    action: 'UPDATE',
    actor: getActor(),
    oldValues: old,
    newValues: row,
  });
  return true;
}

async function findByMemberId(memberId) {
  return await db.all(`${WITH_FUND} WHERE d.member_id = ? ORDER BY d.created_at DESC, d.id DESC`, memberId);
}

async function list({ limit, offset }) {
  const totalRow = await db.get('SELECT COUNT(*) AS c FROM donations');
  const donations = await db.all(
    `SELECT d.*, f.name AS fund_name, m.first_name AS member_first_name, m.last_name AS member_last_name
       FROM donations d
       LEFT JOIN donation_funds f ON f.id = d.fund_id
       LEFT JOIN members m ON m.id = d.member_id
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ? OFFSET ?`,
    limit, offset
  );
  return { donations, total: totalRow ? Number(totalRow.c) : 0 };
}

// Completed donations only. Sums come back as strings from PostgreSQL, hence Number().
async function summary() {
  const row = await db.get(
    `SELECT COUNT(*) AS c,
            COALESCE(SUM(gift_cents), 0) AS gift_cents,
            COALESCE(SUM(fee_cover_cents), 0) AS fee_cover_cents,
            COALESCE(SUM(amount_cents), 0) AS amount_cents
       FROM donations WHERE status = 'completed'`
  );
  return {
    count: Number(row?.c || 0),
    giftCents: Number(row?.gift_cents || 0),
    feeCoverCents: Number(row?.fee_cover_cents || 0),
    amountCents: Number(row?.amount_cents || 0),
  };
}

// One row per fund, including funds with no completed gifts yet, plus a trailing row for
// donations whose fund is gone (fund_id NULL) when there are any.
async function totalsByFund() {
  const rows = await db.all(
    `SELECT f.id AS fund_id, f.name AS fund_name, f.is_active AS is_active,
            COUNT(d.id) AS c, COALESCE(SUM(d.gift_cents), 0) AS gift_cents
       FROM donation_funds f
       LEFT JOIN donations d ON d.fund_id = f.id AND d.status = 'completed'
      GROUP BY f.id, f.name, f.is_active, f.sort_order
      ORDER BY f.sort_order ASC, f.id ASC`
  );
  const orphan = await db.get(
    "SELECT COUNT(*) AS c, COALESCE(SUM(gift_cents), 0) AS gift_cents FROM donations WHERE fund_id IS NULL AND status = 'completed'"
  );
  const totals = rows.map(r => ({
    fundId: r.fund_id,
    fundName: r.fund_name,
    isActive: Number(r.is_active) === 1,
    count: Number(r.c),
    giftCents: Number(r.gift_cents),
  }));
  if (orphan && Number(orphan.c) > 0) {
    totals.push({ fundId: null, fundName: 'No fund', isActive: false, count: Number(orphan.c), giftCents: Number(orphan.gift_cents) });
  }
  return totals;
}

// Every completed charge, for estimating fees per charge (the flat part of Stripe's fee
// makes a sum over the grand total wrong).
async function completedAmounts() {
  const rows = await db.all("SELECT amount_cents FROM donations WHERE status = 'completed'");
  return rows.map(r => Number(r.amount_cents));
}

async function sumCompletedCents() {
  const row = await db.get("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM donations WHERE status = 'completed'");
  return row ? Number(row.c) : 0;
}

module.exports = {
  findById,
  findBySessionId,
  create,
  attachSession,
  complete,
  failBySessionId,
  findByMemberId,
  list,
  summary,
  totalsByFund,
  completedAmounts,
  sumCompletedCents,
};
