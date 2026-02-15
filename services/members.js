const memberRepo = require('../db/repos/members');

async function generateMemberNumber(year) {
  year = year || new Date().getFullYear();
  const count = await memberRepo.countByYear(year);
  return `YSH-${year}-${String(count + 1).padStart(4, '0')}`;
}

async function findMemberById(id) {
  return await memberRepo.findById(id);
}

async function findMemberByEmail(email) {
  return await memberRepo.findByEmail(email);
}

async function activateMember(id) {
  await memberRepo.activate(id);
}

module.exports = {
  generateMemberNumber,
  findMemberById,
  findMemberByEmail,
  activateMember,
};
