const db = require('../database');

function insert({ to_email, to_name, subject, body_html, email_type, status, error, member_id }) {
  return db.prepare(
    `INSERT INTO emails_log (to_email, to_name, subject, body_html, email_type, status, error, member_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(to_email, to_name || null, subject, body_html || null, email_type, status || 'sent', error || null, member_id || null);
}

function list({ limit, offset }) {
  const total = db.prepare('SELECT COUNT(*) as c FROM emails_log').get().c;
  const emails = db.prepare('SELECT * FROM emails_log ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  return { emails, total };
}

function listByMemberId(memberId, limit) {
  return db.prepare('SELECT * FROM emails_log WHERE member_id = ? ORDER BY created_at DESC LIMIT ?').all(memberId, limit);
}

function countAll() {
  return db.prepare('SELECT COUNT(*) as c FROM emails_log').get().c;
}

module.exports = {
  insert,
  list,
  listByMemberId,
  countAll,
};
