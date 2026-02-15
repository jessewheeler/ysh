const memberRepo = require('../db/repos/members');

async function listAdmins() {
  return await memberRepo.listAdmins();
}

async function addAdmin({ email, first_name, last_name, role }) {
  const adminRole = (role === 'super_admin') ? 'super_admin' : 'editor';
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await memberRepo.findByEmail(normalizedEmail);
  if (existing) {
    await memberRepo.setRole(existing.id, adminRole);
  } else {
    await memberRepo.createAdmin({
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      email: normalizedEmail,
      role: adminRole,
    });
  }
}

async function demoteAdmin(id) {
  await memberRepo.clearRole(id);
}

module.exports = {
  listAdmins,
  addAdmin,
  demoteAdmin,
};
