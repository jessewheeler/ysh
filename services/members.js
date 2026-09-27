const memberRepo = require('../db/repos/members');

// The count alone isn't enough: once a member is deleted (archiving a family sub-member does
// this routinely), count + 1 lands on a number someone still holds and the insert fails the
// UNIQUE constraint. Taking the highest issued suffix as a floor keeps the sequence moving.
async function generateMemberNumber(year) {
  year = year || new Date().getFullYear();
  const count = await memberRepo.countByYear(year);
  const maxSuffix = await memberRepo.maxNumberSuffixForYear(year);
  const next = Math.max(count, maxSuffix) + 1;
  return `YSH-${year}-${String(next).padStart(4, '0')}`;
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
