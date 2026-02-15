const db = require('../database');

function findById(id) {
  return db.prepare('SELECT * FROM members WHERE id = ?').get(id);
}

function findByEmail(email) {
  return db.prepare('SELECT * FROM members WHERE email = ?').get(email);
}

function findAdminByEmail(email) {
  return db.prepare('SELECT * FROM members WHERE email = ? AND role IS NOT NULL').get(email);
}

function create({ member_number, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, status, notes }) {
  return db.prepare(
    `INSERT INTO members (member_number, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(member_number, first_name, last_name, email, phone || null, address_street || null, address_city || null, address_state || null, address_zip || null, membership_year, status || 'pending', notes || null);
}

function update(id, { first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, status, notes }) {
  return db.prepare(
    `UPDATE members SET first_name=?, last_name=?, email=?, phone=?, address_street=?, address_city=?, address_state=?, address_zip=?, membership_year=?, status=?, notes=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(first_name, last_name, email, phone || null, address_street || null, address_city || null, address_state || null, address_zip || null, membership_year, status, notes || null, id);
}

function deleteById(id) {
  return db.prepare('DELETE FROM members WHERE id = ?').run(id);
}

function activate(id) {
  return db.prepare(
    "UPDATE members SET status = 'active', updated_at = datetime('now') WHERE id = ?"
  ).run(id);
}

function countAll() {
  return db.prepare('SELECT COUNT(*) as c FROM members').get().c;
}

function countActive() {
  return db.prepare("SELECT COUNT(*) as c FROM members WHERE status = 'active'").get().c;
}

function countByYear(year) {
  return db.prepare('SELECT COUNT(*) as c FROM members WHERE membership_year = ?').get(year).c;
}

function search({ search, limit, offset }) {
  let where = '';
  let params = [];
  if (search) {
    where = 'WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR member_number LIKE ?';
    const s = `%${search}%`;
    params = [s, s, s, s];
  }
  const total = db.prepare(`SELECT COUNT(*) as c FROM members ${where}`).get(...params).c;
  const members = db.prepare(`SELECT * FROM members ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { members, total };
}

function listRecent(limit) {
  return db.prepare('SELECT * FROM members ORDER BY created_at DESC LIMIT ?').all(limit);
}

function listAll() {
  return db.prepare('SELECT * FROM members ORDER BY created_at DESC').all();
}

function listActiveMembers() {
  return db.prepare("SELECT * FROM members WHERE status = 'active'").all();
}

function listAdmins() {
  return db.prepare('SELECT id, email, first_name, last_name, role, created_at FROM members WHERE role IS NOT NULL ORDER BY created_at ASC').all();
}

function setOtp(id, { otpHash, expiresAt }) {
  return db.prepare(
    "UPDATE members SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0, updated_at = datetime('now') WHERE id = ?"
  ).run(otpHash, expiresAt, id);
}

function incrementOtpAttempts(id) {
  return db.prepare(
    "UPDATE members SET otp_attempts = otp_attempts + 1, updated_at = datetime('now') WHERE id = ?"
  ).run(id);
}

function clearOtp(id) {
  return db.prepare(
    "UPDATE members SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0, updated_at = datetime('now') WHERE id = ?"
  ).run(id);
}

function setRole(id, role) {
  return db.prepare(
    "UPDATE members SET role = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(role, id);
}

function clearRole(id) {
  return db.prepare(
    "UPDATE members SET role = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(id);
}

function createAdmin({ first_name, last_name, email, role }) {
  return db.prepare(
    'INSERT INTO members (first_name, last_name, email, role) VALUES (?, ?, ?, ?)'
  ).run(first_name, last_name, email, role);
}

module.exports = {
  findById,
  findByEmail,
  findAdminByEmail,
  create,
  update,
  deleteById,
  activate,
  countAll,
  countActive,
  countByYear,
  search,
  listRecent,
  listAll,
  listActiveMembers,
  listAdmins,
  setOtp,
  incrementOtpAttempts,
  clearOtp,
  setRole,
  clearRole,
  createAdmin,
};
