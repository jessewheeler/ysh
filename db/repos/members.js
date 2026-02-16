const db = require('../database');

async function findById(id) {
  return await db.get('SELECT * FROM members WHERE id = ?', id);
}

async function findByEmail(email) {
  return await db.get('SELECT * FROM members WHERE email = ?', email);
}

async function findAdminByEmail(email) {
  return await db.get('SELECT * FROM members WHERE email = ? AND role IS NOT NULL', email);
}

async function create({ member_number, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, join_date, status, notes }) {
  return await db.run(
    `INSERT INTO members (member_number, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, join_date, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?)`,
    member_number, first_name, last_name, email, phone || null, address_street || null, address_city || null, address_state || null, address_zip || null, membership_year, join_date || null, status || 'pending', notes || null
  );
}

async function update(id, { first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, join_date, status, notes }) {
  return await db.run(
    `UPDATE members SET first_name=?, last_name=?, email=?, phone=?, address_street=?, address_city=?, address_state=?, address_zip=?, membership_year=?, join_date=?, status=?, notes=?, updated_at=datetime('now')
     WHERE id=?`,
    first_name, last_name, email, phone || null, address_street || null, address_city || null, address_state || null, address_zip || null, membership_year, join_date || null, status, notes || null, id
  );
}

async function deleteById(id) {
  return await db.run('DELETE FROM members WHERE id = ?', id);
}

async function activate(id) {
  return await db.run(
    "UPDATE members SET status = 'active', updated_at = datetime('now') WHERE id = ?",
    id
  );
}

async function countAll() {
  const row = await db.get('SELECT COUNT(*) as c FROM members');
  return row ? row.c : 0;
}

async function countActive() {
  const row = await db.get("SELECT COUNT(*) as c FROM members WHERE status = 'active'");
  return row ? row.c : 0;
}

async function countByYear(year) {
  const row = await db.get('SELECT COUNT(*) as c FROM members WHERE membership_year = ?', year);
  return row ? row.c : 0;
}

async function search({ search, limit, offset }) {
  let where = '';
  let params = [];
  if (search) {
    where = 'WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR member_number LIKE ?';
    const s = `%${search}%`;
    params = [s, s, s, s];
  }
  const totalRow = await db.get(`SELECT COUNT(*) as c FROM members ${where}`, ...params);
  const total = totalRow ? totalRow.c : 0;
  const members = await db.all(`SELECT * FROM members ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  return { members, total };
}

async function listRecent(limit) {
  return await db.all('SELECT * FROM members ORDER BY created_at DESC LIMIT ?', limit);
}

async function listAll() {
  return await db.all('SELECT * FROM members ORDER BY created_at DESC');
}

async function listActiveMembers() {
  return await db.all("SELECT * FROM members WHERE status = 'active'");
}

async function listAdmins() {
  return await db.all('SELECT id, email, first_name, last_name, role, created_at FROM members WHERE role IS NOT NULL ORDER BY created_at ASC');
}

async function setOtp(id, { otpHash, expiresAt }) {
  return await db.run(
    "UPDATE members SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0, updated_at = datetime('now') WHERE id = ?",
    otpHash, expiresAt, id
  );
}

async function incrementOtpAttempts(id) {
  return await db.run(
    "UPDATE members SET otp_attempts = otp_attempts + 1, updated_at = datetime('now') WHERE id = ?",
    id
  );
}

async function clearOtp(id) {
  return await db.run(
    "UPDATE members SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0, updated_at = datetime('now') WHERE id = ?",
    id
  );
}

async function setRole(id, role) {
  return await db.run(
    "UPDATE members SET role = ?, updated_at = datetime('now') WHERE id = ?",
    role, id
  );
}

async function clearRole(id) {
  return await db.run(
    "UPDATE members SET role = NULL, updated_at = datetime('now') WHERE id = ?",
    id
  );
}

async function createAdmin({ first_name, last_name, email, role }) {
  return await db.run(
    'INSERT INTO members (first_name, last_name, email, role) VALUES (?, ?, ?, ?)',
    first_name, last_name, email, role
  );
}

async function findFamilyMembers(primaryMemberId) {
  return await db.all(
    'SELECT * FROM members WHERE primary_member_id = ? ORDER BY created_at ASC',
    primaryMemberId
  );
}

async function createWithFamily({ primaryMember, familyMembers = [], membershipType }) {
  const { generateMemberNumber } = require('../../services/members');

  return await db.transaction(async () => {
    const year = new Date().getFullYear();

    // Create primary member
    const primaryMemberNumber = await generateMemberNumber(year);
    const primaryResult = await db.run(
      `INSERT INTO members (member_number, first_name, last_name, email, phone,
        address_street, address_city, address_state, address_zip,
        membership_year, join_date, status, membership_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?)`,
      [primaryMemberNumber, primaryMember.first_name, primaryMember.last_name,
       primaryMember.email, primaryMember.phone || null, primaryMember.address_street || null,
       primaryMember.address_city || null, primaryMember.address_state || null, primaryMember.address_zip || null,
       year, primaryMember.join_date || null, 'pending', membershipType]
    );

    const primaryId = primaryResult.lastInsertRowid;
    const familyMemberIds = [];

    // Create family members
    for (const fm of familyMembers) {
      const fmNumber = await generateMemberNumber(year);
      const fmEmail = fm.email || primaryMember.email; // Reuse primary email if not provided

      const fmResult = await db.run(
        `INSERT INTO members (member_number, first_name, last_name, email,
          membership_year, status, membership_type, primary_member_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [fmNumber, fm.first_name, fm.last_name, fmEmail,
         year, 'pending', 'family', primaryId]
      );
      familyMemberIds.push(fmResult.lastInsertRowid);
    }

    return { primaryId, familyMemberIds };
  });
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
  findFamilyMembers,
  createWithFamily,
};
