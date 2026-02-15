const db = require('../database');

async function insert({ to_email, to_name, subject, body_html, email_type, status, error, member_id }) {
  return await db.run(
    `INSERT INTO emails_log (to_email, to_name, subject, body_html, email_type, status, error, member_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    to_email, to_name || null, subject, body_html || null, email_type, status || 'sent', error || null, member_id || null
  );
}

async function list({ limit, offset }) {
  const totalRow = await db.get('SELECT COUNT(*) as c FROM emails_log');
  const total = totalRow ? totalRow.c : 0;
  const emails = await db.all('SELECT * FROM emails_log ORDER BY created_at DESC LIMIT ? OFFSET ?', limit, offset);
  return { emails, total };
}

async function listByMemberId(memberId, limit) {
  return await db.all('SELECT * FROM emails_log WHERE member_id = ? ORDER BY created_at DESC LIMIT ?', memberId, limit);
}

async function countAll() {
  const row = await db.get('SELECT COUNT(*) as c FROM emails_log');
  return row ? row.c : 0;
}

module.exports = {
  insert,
  list,
  listByMemberId,
  countAll,
};
