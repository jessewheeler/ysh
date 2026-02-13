const db = require('../db/database');

function generateMemberNumber(year) {
  year = year || new Date().getFullYear();
  const count = db.prepare(
    'SELECT COUNT(*) as c FROM members WHERE membership_year = ?'
  ).get(year).c;
  return `YSH-${year}-${String(count + 1).padStart(4, '0')}`;
}

function findMemberById(id) {
  return db.prepare('SELECT * FROM members WHERE id = ?').get(id);
}

function findMemberByEmail(email) {
  return db.prepare('SELECT * FROM members WHERE email = ?').get(email);
}

function activateMember(id) {
  db.prepare(
    "UPDATE members SET status = 'active', updated_at = datetime('now') WHERE id = ?"
  ).run(id);
}

module.exports = {
  generateMemberNumber,
  findMemberById,
  findMemberByEmail,
  activateMember,
};
