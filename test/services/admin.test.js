jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const adminService = require('../../services/admin');
const memberRepo = require('../../db/repos/members');
const { insertMember, insertAdmin } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('listAdmins', () => {
  test('returns members with roles', () => {
    const testDb = db.__getCurrentDb();
    insertAdmin(testDb, { email: 'admin@test.com' });
    insertMember(testDb, { email: 'user@test.com' });
    const admins = adminService.listAdmins();
    expect(admins).toHaveLength(1);
    expect(admins[0].email).toBe('admin@test.com');
  });
});

describe('addAdmin', () => {
  test('promotes existing member to admin', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'user@test.com' });
    adminService.addAdmin({ email: 'user@test.com', first_name: 'U', last_name: 'S', role: 'editor' });
    expect(memberRepo.findById(m.id).role).toBe('editor');
  });

  test('creates new member with admin role', () => {
    adminService.addAdmin({ email: 'new@admin.com', first_name: 'New', last_name: 'Admin', role: 'super_admin' });
    const admin = memberRepo.findByEmail('new@admin.com');
    expect(admin).toBeDefined();
    expect(admin.role).toBe('super_admin');
  });

  test('defaults to editor for non-super_admin roles', () => {
    adminService.addAdmin({ email: 'ed@test.com', first_name: 'Ed', last_name: 'T', role: 'unknown' });
    expect(memberRepo.findByEmail('ed@test.com').role).toBe('editor');
  });

  test('normalizes email to lowercase', () => {
    adminService.addAdmin({ email: '  Admin@Test.COM  ', first_name: 'A', last_name: 'B', role: 'editor' });
    expect(memberRepo.findByEmail('admin@test.com')).toBeDefined();
  });
});

describe('demoteAdmin', () => {
  test('clears role from admin', () => {
    const testDb = db.__getCurrentDb();
    const admin = insertAdmin(testDb, { email: 'admin@test.com' });
    adminService.demoteAdmin(admin.id);
    expect(memberRepo.findById(admin.id).role).toBeNull();
  });
});
