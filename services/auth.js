const crypto = require('crypto');
const bcrypt = require('bcrypt');
const memberRepo = require('../db/repos/members');

const isDevOrTest = ['development', 'test', 'dev'].includes(process.env.NODE_ENV);

async function findAdminByEmail(email) {
  return await memberRepo.findAdminByEmail(email);
}

// The OTP scheme is shared by admin login (members table) and auction bidder login
// (auction_bidders). `store` is the repo holding the code: it must expose
// setOtp(id, {otpHash, expiresAt}), incrementOtpAttempts(id) and clearOtp(id).
async function issueOtp(store, id) {
  const otp = isDevOrTest ? '000000' : String(crypto.randomInt(100000, 999999));
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await store.setOtp(id, { otpHash, expiresAt });
  return otp;
}

async function checkOtp(store, record, code) {
  if (!record || !record.otp_hash) {
    return { success: false, error: 'Invalid or expired code.' };
  }

  if (record.otp_attempts >= 5) {
    return { success: false, error: 'Too many attempts. Please request a new code.' };
  }

  if (new Date(record.otp_expires_at) < new Date()) {
    return { success: false, error: 'Code has expired. Please request a new code.' };
  }

  const match = await bcrypt.compare(code || '', record.otp_hash);

  if (!match) {
    await store.incrementOtpAttempts(record.id);
    return { success: false, error: 'Invalid code.' };
  }

  await store.clearOtp(record.id);
  return { success: true };
}

async function generateAndStoreOtp(adminId) {
  return issueOtp(memberRepo, adminId);
}

async function verifyOtp(admin, code) {
  return checkOtp(memberRepo, admin, code);
}

// Required lazily so tests that mock only the members repo don't load the auction tables.
function biddersRepo() {
  return require('../db/repos/auctionBidders');
}

async function generateAndStoreBidderOtp(bidderId) {
  return issueOtp(biddersRepo(), bidderId);
}

async function verifyBidderOtp(bidder, code) {
  return checkOtp(biddersRepo(), bidder, code);
}

module.exports = {
  findAdminByEmail,
  generateAndStoreOtp,
  verifyOtp,
  generateAndStoreBidderOtp,
  verifyBidderOtp,
};
