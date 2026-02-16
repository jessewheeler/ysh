jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const adminService = require('../../services/admin');
const memberRepo = require('../../db/repos/members');
const { insertMember, insertAdmin } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('listAdmins', () => {
  test('returns members with roles', async () => {
    const testDb = db.__getCurrentDb();
    insertAdmin(testDb, { email: 'admin@test.com' });
    insertMember(testDb, { email: 'user@test.com' });
    const admins = await adminService.listAdmins();
    expect(admins).toHaveLength(1);
    expect(admins[0].email).toBe('admin@test.com');
  });
});

describe('addAdmin', () => {
  test('promotes existing member to admin', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'user@test.com' });
    await adminService.addAdmin({ email: 'user@test.com', first_name: 'U', last_name: 'S', role: 'editor' });
    expect((await memberRepo.findById(m.id)).role).toBe('editor');
  });

  test('creates new member with admin role', async () => {
    await adminService.addAdmin({ email: 'new@admin.com', first_name: 'New', last_name: 'Admin', role: 'super_admin' });
    const admin = await memberRepo.findByEmail('new@admin.com');
    expect(admin).toBeDefined();
    expect(admin.role).toBe('super_admin');
  });

  test('defaults to editor for non-super_admin roles', async () => {
    await adminService.addAdmin({ email: 'ed@test.com', first_name: 'Ed', last_name: 'T', role: 'unknown' });
    expect((await memberRepo.findByEmail('ed@test.com')).role).toBe('editor');
  });

  test('normalizes email to lowercase', async () => {
    await adminService.addAdmin({ email: '  Admin@Test.COM  ', first_name: 'A', last_name: 'B', role: 'editor' });
    expect(await memberRepo.findByEmail('admin@test.com')).toBeDefined();
  });
});

describe('demoteAdmin', () => {
  test('clears role from admin', async () => {
    const testDb = db.__getCurrentDb();
    const admin = insertAdmin(testDb, { email: 'admin@test.com' });
    await adminService.demoteAdmin(admin.id);
    expect((await memberRepo.findById(admin.id)).role).toBeNull();
  });
});
