const db = require('../database');

function findLatestByMemberId(memberId) {
  return db.prepare(
    'SELECT * FROM membership_cards WHERE member_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(memberId);
}

function findByMemberId(memberId) {
  return db.prepare(
    'SELECT * FROM membership_cards WHERE member_id = ? ORDER BY created_at DESC'
  ).all(memberId);
}

function upsertPng(memberId, year, pngPath) {
  const existing = db.prepare(
    'SELECT id FROM membership_cards WHERE member_id = ? AND year = ?'
  ).get(memberId, year);

  if (existing) {
    return db.prepare('UPDATE membership_cards SET png_path = ? WHERE id = ?').run(pngPath, existing.id);
  }
  return db.prepare(
    'INSERT INTO membership_cards (member_id, png_path, year) VALUES (?, ?, ?)'
  ).run(memberId, pngPath, year);
}

function upsertPdf(memberId, year, pdfPath) {
  const existing = db.prepare(
    'SELECT id FROM membership_cards WHERE member_id = ? AND year = ?'
  ).get(memberId, year);

  if (existing) {
    return db.prepare('UPDATE membership_cards SET pdf_path = ? WHERE id = ?').run(pdfPath, existing.id);
  }
  return db.prepare(
    'INSERT INTO membership_cards (member_id, pdf_path, year) VALUES (?, ?, ?)'
  ).run(memberId, pdfPath, year);
}

module.exports = {
  findLatestByMemberId,
  findByMemberId,
  upsertPng,
  upsertPdf,
};
