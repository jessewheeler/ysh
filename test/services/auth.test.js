jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const authService = require('../../services/auth');
const { insertAdmin, insertBidder } = require('../helpers/fixtures');
const bcrypt = require('bcrypt');

beforeEach(() => {
  db.__resetTestDb();
});

describe('findAdminByEmail', () => {
  test('returns admin member by email', async () => {
    const testDb = db.__getCurrentDb();
    insertAdmin(testDb, { email: 'admin@test.com' });
    const admin = await authService.findAdminByEmail('admin@test.com');
    expect(admin).toBeDefined();
    expect(admin.role).toBe('super_admin');
  });

  test('returns undefined for non-admin', async () => {
    expect(await authService.findAdminByEmail('nobody@test.com')).toBeUndefined();
  });
});

describe('generateAndStoreOtp', () => {
  test('generates OTP and stores hash in DB', async () => {
    const testDb = db.__getCurrentDb();
    const admin = insertAdmin(testDb, { email: 'otp@test.com' });

    const otp = await authService.generateAndStoreOtp(admin.id);
    expect(otp).toBe('000000'); // dev/test mode

    const updated = testDb.prepare('SELECT * FROM members WHERE id = ?').get(admin.id);
    expect(updated.otp_hash).toBeTruthy();
    expect(updated.otp_expires_at).toBeTruthy();
    expect(updated.otp_attempts).toBe(0);
  });
});

describe('verifyOtp', () => {
  test('returns success when code matches', async () => {
    const testDb = db.__getCurrentDb();
    const admin = insertAdmin(testDb, { email: 'v@test.com' });
    const otp = await authService.generateAndStoreOtp(admin.id);

    const updatedAdmin = testDb.prepare('SELECT * FROM members WHERE id = ?').get(admin.id);
    const result = await authService.verifyOtp(updatedAdmin, otp);
    expect(result.success).toBe(true);
  });

  test('returns error when code does not match', async () => {
    const testDb = db.__getCurrentDb();
    const admin = insertAdmin(testDb, { email: 'v@test.com' });
    await authService.generateAndStoreOtp(admin.id);

    const updatedAdmin = testDb.prepare('SELECT * FROM members WHERE id = ?').get(admin.id);
    const result = await authService.verifyOtp(updatedAdmin, 'wrong');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid code.');
  });

  test('returns error when admin has no OTP', async () => {
    const result = await authService.verifyOtp({ id: 1 }, '123456');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid or expired');
  });

  test('returns error when too many attempts', async () => {
    const testDb = db.__getCurrentDb();
    const admin = insertAdmin(testDb, { email: 'v@test.com' });
    const hash = await bcrypt.hash('123456', 10);
    testDb.prepare('UPDATE members SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 5 WHERE id = ?')
      .run(hash, '2099-01-01T00:00:00Z', admin.id);

    const updatedAdmin = testDb.prepare('SELECT * FROM members WHERE id = ?').get(admin.id);
    const result = await authService.verifyOtp(updatedAdmin, '123456');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Too many attempts');
  });

  test('returns error when OTP expired', async () => {
    const testDb = db.__getCurrentDb();
    const admin = insertAdmin(testDb, { email: 'v@test.com' });
    const hash = await bcrypt.hash('123456', 10);
    testDb.prepare('UPDATE members SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0 WHERE id = ?')
      .run(hash, '2000-01-01T00:00:00Z', admin.id);

    const updatedAdmin = testDb.prepare('SELECT * FROM members WHERE id = ?').get(admin.id);
    const result = await authService.verifyOtp(updatedAdmin, '123456');
    expect(result.success).toBe(false);
    expect(result.error).toContain('expired');
  });

  test('clears OTP after successful verification', async () => {
    const testDb = db.__getCurrentDb();
    const admin = insertAdmin(testDb, { email: 'v@test.com' });
    await authService.generateAndStoreOtp(admin.id);

    const updatedAdmin = testDb.prepare('SELECT * FROM members WHERE id = ?').get(admin.id);
    await authService.verifyOtp(updatedAdmin, '000000');

    const cleared = testDb.prepare('SELECT * FROM members WHERE id = ?').get(admin.id);
    expect(cleared.otp_hash).toBeNull();
  });
});

describe('bidder OTP (silent auction)', () => {
  test('stores the code on auction_bidders, not members', async () => {
    const testDb = db.__getCurrentDb();
    const bidder = insertBidder(testDb, { email: 'bid@test.com', verified_at: null });

    const otp = await authService.generateAndStoreBidderOtp(bidder.id);
    expect(otp).toBe('000000');

    const row = testDb.prepare('SELECT * FROM auction_bidders WHERE id = ?').get(bidder.id);
    expect(row.otp_hash).toBeTruthy();
    expect(row.otp_attempts).toBe(0);
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM members WHERE otp_hash IS NOT NULL').get().n).toBe(0);
  });

  test('accepts the right code once and clears it', async () => {
    const testDb = db.__getCurrentDb();
    const bidder = insertBidder(testDb, { email: 'bid@test.com' });
    await authService.generateAndStoreBidderOtp(bidder.id);
    const fresh = testDb.prepare('SELECT * FROM auction_bidders WHERE id = ?').get(bidder.id);

    expect(await authService.verifyBidderOtp(fresh, '000000')).toEqual({ success: true });
    const cleared = testDb.prepare('SELECT * FROM auction_bidders WHERE id = ?').get(bidder.id);
    expect(cleared.otp_hash).toBeNull();
  });

  test('counts wrong codes and locks out after five', async () => {
    const testDb = db.__getCurrentDb();
    const bidder = insertBidder(testDb, { email: 'bid@test.com' });
    await authService.generateAndStoreBidderOtp(bidder.id);
    const read = () => testDb.prepare('SELECT * FROM auction_bidders WHERE id = ?').get(bidder.id);

    for (let i = 0; i < 5; i++) {
      expect((await authService.verifyBidderOtp(read(), '123456')).success).toBe(false);
    }
    expect(read().otp_attempts).toBe(5);
    const locked = await authService.verifyBidderOtp(read(), '000000');
    expect(locked).toEqual({ success: false, error: 'Too many attempts. Please request a new code.' });
  });

  test('refuses an expired code', async () => {
    const testDb = db.__getCurrentDb();
    const bidder = insertBidder(testDb, { email: 'bid@test.com' });
    const hash = await bcrypt.hash('000000', 4);
    testDb.prepare('UPDATE auction_bidders SET otp_hash = ?, otp_expires_at = ? WHERE id = ?')
      .run(hash, new Date(Date.now() - 1000).toISOString(), bidder.id);
    const row = testDb.prepare('SELECT * FROM auction_bidders WHERE id = ?').get(bidder.id);
    expect((await authService.verifyBidderOtp(row, '000000')).error).toMatch(/expired/);
  });
});
