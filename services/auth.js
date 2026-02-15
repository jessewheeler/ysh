const crypto = require('crypto');
const bcrypt = require('bcrypt');
const memberRepo = require('../db/repos/members');

const isDevOrTest = ['development', 'test', 'dev'].includes(process.env.NODE_ENV);

function findAdminByEmail(email) {
  return memberRepo.findAdminByEmail(email);
}

async function generateAndStoreOtp(adminId) {
  const otp = isDevOrTest ? '000000' : String(crypto.randomInt(100000, 999999));
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  memberRepo.setOtp(adminId, { otpHash, expiresAt });
  return otp;
}

async function verifyOtp(admin, code) {
  if (!admin || !admin.otp_hash) {
    return { success: false, error: 'Invalid or expired code.' };
  }

  if (admin.otp_attempts >= 5) {
    return { success: false, error: 'Too many attempts. Please request a new code.' };
  }

  if (new Date(admin.otp_expires_at) < new Date()) {
    return { success: false, error: 'Code has expired. Please request a new code.' };
  }

  const match = await bcrypt.compare(code || '', admin.otp_hash);

  if (!match) {
    memberRepo.incrementOtpAttempts(admin.id);
    return { success: false, error: 'Invalid code.' };
  }

  memberRepo.clearOtp(admin.id);
  return { success: true };
}

module.exports = {
  findAdminByEmail,
  generateAndStoreOtp,
  verifyOtp,
};
