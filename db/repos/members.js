const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

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
    const actor = getActor();
    const result = await db.run(
        `INSERT INTO members (member_number, first_name, last_name, email, phone, address_street, address_city,
                              address_state, address_zip, membership_year, join_date, status, notes, created_by,
                              updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?)`,
        member_number, first_name, last_name, email, phone || null, address_street || null, address_city || null, address_state || null, address_zip || null, membership_year, join_date || null, status || 'pending', notes || null, actor.id || null, actor.id || null
  );
    const row = await db.get('SELECT * FROM members WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'members',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return result;
}

async function update(id, { first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, membership_year, join_date, status, notes }) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM members WHERE id = ?', id);
    const result = await db.run(
        `UPDATE members SET first_name=?, last_name=?, email=?, phone=?, address_street=?, address_city=?, address_state=?, address_zip=?, membership_year=?, join_date=?, status=?, notes=?, updated_at=datetime('now'), updated_by=?
     WHERE id=?`,
        first_name, last_name, email, phone || null, address_street || null, address_city || null, address_state || null, address_zip || null, membership_year, join_date || null, status, notes || null, actor.id || null, id
  );
    const row = await db.get('SELECT * FROM members WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'members',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return result;
}

async function deleteById(id) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM members WHERE id = ?', id);
    const result = await db.run('DELETE FROM members WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'members',
        recordId: id,
        action: 'DELETE',
        actor,
        oldValues: old,
        newValues: null
    });
    return result;
}

async function activate(id) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM members WHERE id = ?', id);
    const result = await db.run(
        "UPDATE members SET status = 'active', updated_at = datetime('now'), updated_by = ? WHERE id = ?",
        actor.id || null, id
  );
    const row = await db.get('SELECT * FROM members WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'members',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return result;
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
    const actor = getActor();
    const old = await db.get('SELECT * FROM members WHERE id = ?', id);
    const result = await db.run(
        "UPDATE members SET role = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
        role, actor.id || null, id
  );
    const row = await db.get('SELECT * FROM members WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'members',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return result;
}

async function clearRole(id) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM members WHERE id = ?', id);
    const result = await db.run(
        "UPDATE members SET role = NULL, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
        actor.id || null, id
  );
    const row = await db.get('SELECT * FROM members WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'members',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return result;
}

async function createAdmin({ first_name, last_name, email, role }) {
    const actor = getActor();
    const result = await db.run(
        'INSERT INTO members (first_name, last_name, email, role, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
        first_name, last_name, email, role, actor.id || null, actor.id || null
  );
    const row = await db.get('SELECT * FROM members WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'members',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return result;
}

async function findFamilyMembers(primaryMemberId) {
  return await db.all(
    'SELECT * FROM members WHERE primary_member_id = ? ORDER BY created_at ASC',
    primaryMemberId
  );
}

async function findNeedingRenewal(currentYear, daysUntilExpiry) {
    return await db.all(
        `SELECT *
         FROM members
         WHERE primary_member_id IS NULL
           AND status IN ('active', 'expired')
           AND expiry_date IS NOT NULL
           AND (membership_year IS NULL OR membership_year < ?)
           AND expiry_date <= date ('now'
             , '+' || ? || ' days')
         ORDER BY expiry_date ASC`,
        currentYear, daysUntilExpiry
    );
}

async function setExpiryDate(id, expiryDate) {
    return await db.run(
        "UPDATE members SET expiry_date = ?, updated_at = datetime('now') WHERE id = ?",
        expiryDate, id
    );
}

async function setRenewalToken(id, token, expiresAt) {
    return await db.run(
        "UPDATE members SET renewal_token = ?, renewal_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?",
        token, expiresAt, id
    );
}

async function findByRenewalToken(token) {
    return await db.get(
        "SELECT * FROM members WHERE renewal_token = ? AND renewal_token_expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
        token
    );
}

async function clearRenewalToken(id) {
    return await db.run(
        "UPDATE members SET renewal_token = NULL, renewal_token_expires_at = NULL, updated_at = datetime('now') WHERE id = ?",
        id
    );
}

async function setMembershipYear(id, year) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM members WHERE id = ?', id);
    const result = await db.run(
        "UPDATE members SET membership_year = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
        year, actor.id || null, id
    );
    const row = await db.get('SELECT * FROM members WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'members',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return result;
}

async function listFamilyPrimaries() {
    return await db.all(
        "SELECT * FROM members WHERE membership_type = 'family' AND primary_member_id IS NULL ORDER BY last_name ASC, first_name ASC"
    );
}

async function attachToFamily(id, primaryId) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM members WHERE id = ?', id);
    const result = await db.run(
        "UPDATE members SET membership_type = 'family', primary_member_id = ?, status = 'active', updated_at = datetime('now'), updated_by = ? WHERE id = ?",
        primaryId, actor.id || null, id
    );
    const row = await db.get('SELECT * FROM members WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'members',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return result;
}

async function emailConflictsWithPrimary(email, excludeId) {
    const row = await db.get(
        'SELECT id FROM members WHERE email = ? AND primary_member_id IS NULL AND id != ?',
        email, excludeId
    );
    return !!row;
}

async function upgradeMembershipType(id, type) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM members WHERE id = ?', id);
    const result = await db.run(
        "UPDATE members SET membership_type = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
        type, actor.id || null, id
    );
    const row = await db.get('SELECT * FROM members WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'members',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return result;
}

async function detachFamilyMember(id) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM members WHERE id = ?', id);
    const result = await db.run(
        "UPDATE members SET membership_type = 'individual', primary_member_id = NULL, status = 'cancelled', updated_at = datetime('now'), updated_by = ? WHERE id = ?",
        actor.id || null, id
    );
    const row = await db.get('SELECT * FROM members WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'members',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return result;
}

async function addFamilyMember(primaryId, {first_name, last_name, email, membership_year}) {
    const actor = getActor();
    const {generateMemberNumber} = require('../../services/members');
    const year = membership_year || new Date().getFullYear();
    const memberNumber = await generateMemberNumber(year);
    const result = await db.run(
        `INSERT INTO members (member_number, first_name, last_name, email, membership_year, status, membership_type,
                          primary_member_id, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, 'active', 'family', ?, ?, ?)`,
        memberNumber, first_name, last_name, email || null, year, primaryId, actor.id || null, actor.id || null
    );
    const row = await db.get('SELECT * FROM members WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'members',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return result;
}

async function createWithFamily({ primaryMember, familyMembers = [], membershipType }) {
  const { generateMemberNumber } = require('../../services/members');
    const actor = getActor();

  return await db.transaction(async () => {
    const year = new Date().getFullYear();

    // Create primary member
    const primaryMemberNumber = await generateMemberNumber(year);
    const primaryResult = await db.run(
      `INSERT INTO members (member_number, first_name, last_name, email, phone,
        address_street, address_city, address_state, address_zip,
                            membership_year, join_date, status, membership_type, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?)`,
      [primaryMemberNumber, primaryMember.first_name, primaryMember.last_name,
       primaryMember.email, primaryMember.phone || null, primaryMember.address_street || null,
       primaryMember.address_city || null, primaryMember.address_state || null, primaryMember.address_zip || null,
          year, primaryMember.join_date || null, 'pending', membershipType, actor.id || null, actor.id || null]
    );

    const primaryId = primaryResult.lastInsertRowid;
      const primaryRow = await db.get('SELECT * FROM members WHERE id = ?', primaryId);
      await auditLog.insert({
          tableName: 'members',
          recordId: primaryId,
          action: 'INSERT',
          actor,
          oldValues: null,
          newValues: primaryRow
      });

    const familyMemberIds = [];

    // Create family members
    for (const fm of familyMembers) {
      const fmNumber = await generateMemberNumber(year);
      const fmEmail = fm.email || primaryMember.email; // Reuse primary email if not provided

      const fmResult = await db.run(
        `INSERT INTO members (member_number, first_name, last_name, email,
                              membership_year, status, membership_type, primary_member_id, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [fmNumber, fm.first_name, fm.last_name, fmEmail,
            year, 'pending', 'family', primaryId, actor.id || null, actor.id || null]
      );
      familyMemberIds.push(fmResult.lastInsertRowid);
        const fmRow = await db.get('SELECT * FROM members WHERE id = ?', fmResult.lastInsertRowid);
        await auditLog.insert({
            tableName: 'members',
            recordId: fmResult.lastInsertRowid,
            action: 'INSERT',
            actor,
            oldValues: null,
            newValues: fmRow
        });
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
    findNeedingRenewal,
    setExpiryDate,
    setRenewalToken,
    findByRenewalToken,
    clearRenewalToken,
    setMembershipYear,
    addFamilyMember,
    upgradeMembershipType,
    detachFamilyMember,
    emailConflictsWithPrimary,
    listFamilyPrimaries,
    attachToFamily,
};
