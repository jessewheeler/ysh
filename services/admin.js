const memberRepo = require('../db/repos/members');

function listAdmins() {
  return memberRepo.listAdmins();
}

function addAdmin({ email, first_name, last_name, role }) {
  const adminRole = (role === 'super_admin') ? 'super_admin' : 'editor';
  const normalizedEmail = email.trim().toLowerCase();

  const existing = memberRepo.findByEmail(normalizedEmail);
  if (existing) {
    memberRepo.setRole(existing.id, adminRole);
  } else {
    memberRepo.createAdmin({
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      email: normalizedEmail,
      role: adminRole,
    });
  }
}

function demoteAdmin(id) {
  memberRepo.clearRole(id);
}

module.exports = {
  listAdmins,
  addAdmin,
  demoteAdmin,
};
