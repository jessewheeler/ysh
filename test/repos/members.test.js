jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const memberRepo = require('../../db/repos/members');
const { insertMember, insertAdmin } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('findById', () => {
  test('returns member when found', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com', first_name: 'Alice' });
    const found = memberRepo.findById(m.id);
    expect(found.first_name).toBe('Alice');
  });

  test('returns undefined when not found', () => {
    expect(memberRepo.findById(9999)).toBeUndefined();
  });
});

describe('findByEmail', () => {
  test('returns member when found', () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'x@x.com', last_name: 'Smith' });
    expect(memberRepo.findByEmail('x@x.com').last_name).toBe('Smith');
  });

  test('returns undefined when not found', () => {
    expect(memberRepo.findByEmail('no@no.com')).toBeUndefined();
  });
});

describe('findAdminByEmail', () => {
  test('returns admin member', () => {
    const testDb = db.__getCurrentDb();
    insertAdmin(testDb, { email: 'admin@test.com' });
    const admin = memberRepo.findAdminByEmail('admin@test.com');
    expect(admin).toBeDefined();
    expect(admin.role).toBe('super_admin');
  });

  test('ignores non-admin members', () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'user@test.com' });
    expect(memberRepo.findAdminByEmail('user@test.com')).toBeUndefined();
  });
});

describe('create', () => {
  test('inserts and returns result with lastInsertRowid', () => {
    const result = memberRepo.create({
      member_number: 'YSH-2025-0001',
      first_name: 'Bob',
      last_name: 'Test',
      email: 'bob@test.com',
      membership_year: 2025,
      status: 'pending',
    });
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
    const found = memberRepo.findById(result.lastInsertRowid);
    expect(found.first_name).toBe('Bob');
  });
});

describe('update', () => {
  test('updates member fields', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'u@u.com' });
    memberRepo.update(m.id, { first_name: 'Updated', last_name: 'Name', email: 'u@u.com', membership_year: 2025, status: 'active' });
    expect(memberRepo.findById(m.id).first_name).toBe('Updated');
  });
});

describe('deleteById', () => {
  test('removes the member', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'd@d.com' });
    memberRepo.deleteById(m.id);
    expect(memberRepo.findById(m.id)).toBeUndefined();
  });
});

describe('activate', () => {
  test('sets status to active', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'act@a.com', status: 'pending' });
    memberRepo.activate(m.id);
    expect(memberRepo.findById(m.id).status).toBe('active');
  });
});

describe('countAll / countActive / countByYear', () => {
  test('counts correctly', () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'a@a.com', status: 'active', membership_year: 2025 });
    insertMember(testDb, { email: 'b@b.com', status: 'pending', membership_year: 2025 });
    insertMember(testDb, { email: 'c@c.com', status: 'active', membership_year: 2024 });

    expect(memberRepo.countAll()).toBe(3);
    expect(memberRepo.countActive()).toBe(2);
    expect(memberRepo.countByYear(2025)).toBe(2);
    expect(memberRepo.countByYear(2024)).toBe(1);
  });
});

describe('search', () => {
  test('finds members matching search term', () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'alice@test.com', first_name: 'Alice' });
    insertMember(testDb, { email: 'bob@test.com', first_name: 'Bob' });

    const result = memberRepo.search({ search: 'Alice', limit: 25, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.members).toHaveLength(1);
    expect(result.members[0].first_name).toBe('Alice');
  });

  test('returns all when search is empty', () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'a@a.com' });
    insertMember(testDb, { email: 'b@b.com' });

    const result = memberRepo.search({ search: '', limit: 25, offset: 0 });
    expect(result.total).toBe(2);
  });
});

describe('listRecent / listAll / listActiveMembers', () => {
  test('lists members correctly', () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'a@a.com', status: 'active' });
    insertMember(testDb, { email: 'b@b.com', status: 'pending' });

    expect(memberRepo.listRecent(1)).toHaveLength(1);
    expect(memberRepo.listAll()).toHaveLength(2);
    expect(memberRepo.listActiveMembers()).toHaveLength(1);
  });
});

describe('listAdmins', () => {
  test('returns only members with roles', () => {
    const testDb = db.__getCurrentDb();
    insertAdmin(testDb, { email: 'admin@test.com' });
    insertMember(testDb, { email: 'user@test.com' });
    expect(memberRepo.listAdmins()).toHaveLength(1);
  });
});

describe('OTP functions', () => {
  test('setOtp / incrementOtpAttempts / clearOtp', () => {
    const testDb = db.__getCurrentDb();
    const m = insertAdmin(testDb, { email: 'otp@test.com' });

    memberRepo.setOtp(m.id, { otpHash: 'hash123', expiresAt: '2099-01-01T00:00:00Z' });
    let admin = memberRepo.findById(m.id);
    expect(admin.otp_hash).toBe('hash123');
    expect(admin.otp_attempts).toBe(0);

    memberRepo.incrementOtpAttempts(m.id);
    admin = memberRepo.findById(m.id);
    expect(admin.otp_attempts).toBe(1);

    memberRepo.clearOtp(m.id);
    admin = memberRepo.findById(m.id);
    expect(admin.otp_hash).toBeNull();
    expect(admin.otp_attempts).toBe(0);
  });
});

describe('setRole / clearRole / createAdmin', () => {
  test('sets and clears role', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'role@test.com' });

    memberRepo.setRole(m.id, 'editor');
    expect(memberRepo.findById(m.id).role).toBe('editor');

    memberRepo.clearRole(m.id);
    expect(memberRepo.findById(m.id).role).toBeNull();
  });

  test('createAdmin inserts a new admin member', () => {
    const result = memberRepo.createAdmin({ first_name: 'New', last_name: 'Admin', email: 'new@admin.com', role: 'editor' });
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
    const found = memberRepo.findById(result.lastInsertRowid);
    expect(found.role).toBe('editor');
  });
});
