const memberRepo = require('../db/repos/members');

function generateMemberNumber(year) {
  year = year || new Date().getFullYear();
  const count = memberRepo.countByYear(year);
  return `YSH-${year}-${String(count + 1).padStart(4, '0')}`;
}

function findMemberById(id) {
  return memberRepo.findById(id);
}

function findMemberByEmail(email) {
  return memberRepo.findByEmail(email);
}

function activateMember(id) {
  memberRepo.activate(id);
}

module.exports = {
  generateMemberNumber,
  findMemberById,
  findMemberByEmail,
  activateMember,
};
