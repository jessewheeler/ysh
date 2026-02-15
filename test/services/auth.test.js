jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const authService = require('../../services/auth');
const { insertAdmin } = require('../helpers/fixtures');
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
