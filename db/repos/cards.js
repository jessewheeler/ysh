const db = require('../database');

async function findLatestByMemberId(memberId) {
  return await db.get(
    'SELECT * FROM membership_cards WHERE member_id = ? ORDER BY created_at DESC LIMIT 1',
    memberId
  );
}

async function findByMemberId(memberId) {
  return await db.all(
    'SELECT * FROM membership_cards WHERE member_id = ? ORDER BY created_at DESC',
    memberId
  );
}

async function upsertPng(memberId, year, pngPath) {
  const existing = await db.get(
    'SELECT id FROM membership_cards WHERE member_id = ? AND year = ?',
    memberId, year
  );

  if (existing) {
    return await db.run('UPDATE membership_cards SET png_path = ? WHERE id = ?', pngPath, existing.id);
  }
  return await db.run(
    'INSERT INTO membership_cards (member_id, png_path, year) VALUES (?, ?, ?)',
    memberId, pngPath, year
  );
}

async function upsertPdf(memberId, year, pdfPath) {
  const existing = await db.get(
    'SELECT id FROM membership_cards WHERE member_id = ? AND year = ?',
    memberId, year
  );

  if (existing) {
    return await db.run('UPDATE membership_cards SET pdf_path = ? WHERE id = ?', pdfPath, existing.id);
  }
  return await db.run(
    'INSERT INTO membership_cards (member_id, pdf_path, year) VALUES (?, ?, ?)',
    memberId, pdfPath, year
  );
}

module.exports = {
  findLatestByMemberId,
  findByMemberId,
  upsertPng,
  upsertPdf,
};
