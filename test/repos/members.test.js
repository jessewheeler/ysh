jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const memberRepo = require('../../db/repos/members');
const { insertMember, insertAdmin, insertFamilyMembership } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('findById', () => {
  test('returns member when found', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com', first_name: 'Alice' });
    const found = await memberRepo.findById(m.id);
    expect(found.first_name).toBe('Alice');
  });

  test('returns undefined when not found', async () => {
    const found = await memberRepo.findById(9999);
    expect(found).toBeUndefined();
  });
});

describe('findByEmail', () => {
  test('returns member when found', async () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'x@x.com', last_name: 'Smith' });
    const found = await memberRepo.findByEmail('x@x.com');
    expect(found.last_name).toBe('Smith');
  });

  test('returns undefined when not found', async () => {
    const found = await memberRepo.findByEmail('no@no.com');
    expect(found).toBeUndefined();
  });
});

describe('findAdminByEmail', () => {
  test('returns admin member', async () => {
    const testDb = db.__getCurrentDb();
    insertAdmin(testDb, { email: 'admin@test.com' });
    const admin = await memberRepo.findAdminByEmail('admin@test.com');
    expect(admin).toBeDefined();
    expect(admin.role).toBe('super_admin');
  });

  test('ignores non-admin members', async () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'user@test.com' });
    const found = await memberRepo.findAdminByEmail('user@test.com');
    expect(found).toBeUndefined();
  });
});

describe('create', () => {
  test('inserts and returns result with lastInsertRowid', async () => {
    const result = await memberRepo.create({
      member_number: 'YSH-2025-0001',
      first_name: 'Bob',
      last_name: 'Test',
      email: 'bob@test.com',
      membership_year: 2025,
      status: 'pending',
    });
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
    const found = await memberRepo.findById(result.lastInsertRowid);
    expect(found.first_name).toBe('Bob');
  });
});

describe('update', () => {
  test('updates member fields', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'u@u.com' });
    await memberRepo.update(m.id, { first_name: 'Updated', last_name: 'Name', email: 'u@u.com', membership_year: 2025, status: 'active' });
    const found = await memberRepo.findById(m.id);
    expect(found.first_name).toBe('Updated');
  });
});

describe('deleteById', () => {
  test('removes the member', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'd@d.com' });
    await memberRepo.deleteById(m.id);
    const found = await memberRepo.findById(m.id);
    expect(found).toBeUndefined();
  });
});

describe('activate', () => {
  test('sets status to active', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'act@a.com', status: 'pending' });
    await memberRepo.activate(m.id);
    const found = await memberRepo.findById(m.id);
    expect(found.status).toBe('active');
  });
});

describe('countAll / countActive / countByYear', () => {
  test('counts correctly', async () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'a@a.com', status: 'active', membership_year: 2025 });
    insertMember(testDb, { email: 'b@b.com', status: 'pending', membership_year: 2025 });
    insertMember(testDb, { email: 'c@c.com', status: 'active', membership_year: 2024 });

    expect(await memberRepo.countAll()).toBe(3);
    expect(await memberRepo.countActive()).toBe(2);
    expect(await memberRepo.countByYear(2025)).toBe(2);
    expect(await memberRepo.countByYear(2024)).toBe(1);
  });
});

describe('search', () => {
  test('finds members matching search term', async () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'alice@test.com', first_name: 'Alice' });
    insertMember(testDb, { email: 'bob@test.com', first_name: 'Bob' });

    const result = await memberRepo.search({ search: 'Alice', limit: 25, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.members).toHaveLength(1);
    expect(result.members[0].first_name).toBe('Alice');
  });

  test('returns all when search is empty', async () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'a@a.com' });
    insertMember(testDb, { email: 'b@b.com' });

    const result = await memberRepo.search({ search: '', limit: 25, offset: 0 });
    expect(result.total).toBe(2);
  });
});

describe('listRecent / listAll / listActiveMembers', () => {
  test('lists members correctly', async () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'a@a.com', status: 'active' });
    insertMember(testDb, { email: 'b@b.com', status: 'pending' });

    expect(await memberRepo.listRecent(1)).toHaveLength(1);
    expect(await memberRepo.listAll()).toHaveLength(2);
    expect(await memberRepo.listActiveMembers()).toHaveLength(1);
  });
});

describe('listAdmins', () => {
  test('returns only members with roles', async () => {
    const testDb = db.__getCurrentDb();
    insertAdmin(testDb, { email: 'admin@test.com' });
    insertMember(testDb, { email: 'user@test.com' });
    expect(await memberRepo.listAdmins()).toHaveLength(1);
  });
});

describe('OTP functions', () => {
  test('setOtp / incrementOtpAttempts / clearOtp', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertAdmin(testDb, { email: 'otp@test.com' });

    await memberRepo.setOtp(m.id, { otpHash: 'hash123', expiresAt: '2099-01-01T00:00:00Z' });
    let admin = await memberRepo.findById(m.id);
    expect(admin.otp_hash).toBe('hash123');
    expect(admin.otp_attempts).toBe(0);

    await memberRepo.incrementOtpAttempts(m.id);
    admin = await memberRepo.findById(m.id);
    expect(admin.otp_attempts).toBe(1);

    await memberRepo.clearOtp(m.id);
    admin = await memberRepo.findById(m.id);
    expect(admin.otp_hash).toBeNull();
    expect(admin.otp_attempts).toBe(0);
  });
});

describe('setRole / clearRole / createAdmin', () => {
  test('sets and clears role', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'role@test.com' });

    await memberRepo.setRole(m.id, 'editor');
    let found = await memberRepo.findById(m.id);
    expect(found.role).toBe('editor');

    await memberRepo.clearRole(m.id);
    found = await memberRepo.findById(m.id);
    expect(found.role).toBeNull();
  });

  test('createAdmin inserts a new admin member', async () => {
    const result = await memberRepo.createAdmin({ first_name: 'New', last_name: 'Admin', email: 'new@admin.com', role: 'editor' });
    expect(Number(result.lastInsertRowid)).toBeGreaterThan(0);
    const found = await memberRepo.findById(result.lastInsertRowid);
    expect(found.role).toBe('editor');
  });
});

describe('Family Membership Functions', () => {
  describe('findFamilyMembers', () => {
    test('returns all family members for a primary member', async () => {
      const testDb = db.__getCurrentDb();
      const { primary, familyMembers } = insertFamilyMembership(testDb);

      const result = await memberRepo.findFamilyMembers(primary.id);

      expect(result).toHaveLength(2);
      expect(result[0].first_name).toBe(familyMembers[0].first_name);
      expect(result[0].primary_member_id).toBe(primary.id);
      expect(result[1].first_name).toBe(familyMembers[1].first_name);
      expect(result[1].primary_member_id).toBe(primary.id);
    });

    test('returns empty array if no family members', async () => {
      const testDb = db.__getCurrentDb();
      const primary = insertMember(testDb, { membership_type: 'individual', email: 'solo@test.com' });

      const result = await memberRepo.findFamilyMembers(primary.id);

      expect(result).toHaveLength(0);
    });

    test('orders family members by created_at ASC', async () => {
      const testDb = db.__getCurrentDb();
      const { primary } = insertFamilyMembership(testDb, {
        primaryMember: { email: 'family@test.com' },
        familyMembers: [
          { first_name: 'Alice', last_name: 'Doe', email: 'alice@test.com' },
          { first_name: 'Bob', last_name: 'Doe', email: 'bob@test.com' },
          { first_name: 'Charlie', last_name: 'Doe', email: 'charlie@test.com' }
        ]
      });

      const result = await memberRepo.findFamilyMembers(primary.id);

      expect(result).toHaveLength(3);
      expect(result[0].first_name).toBe('Alice');
      expect(result[1].first_name).toBe('Bob');
      expect(result[2].first_name).toBe('Charlie');
    });
  });

  describe('createWithFamily', () => {
    test('creates primary member with individual type', async () => {
      const result = await memberRepo.createWithFamily({
        primaryMember: {
          first_name: 'John',
          last_name: 'Smith',
          email: 'john@example.com',
          phone: '555-1234',
          address_street: '123 Main St',
          address_city: 'Billings',
          address_state: 'MT',
          address_zip: '59101'
        },
        familyMembers: [],
        membershipType: 'individual'
      });

      expect(result.primaryId).toBeDefined();
      expect(result.familyMemberIds).toHaveLength(0);

      const member = await memberRepo.findById(result.primaryId);
      expect(member.first_name).toBe('John');
      expect(member.email).toBe('john@example.com');
      expect(member.membership_type).toBe('individual');
      expect(member.status).toBe('pending');
      expect(member.member_number).toMatch(/^YSH-\d{4}-\d{4}$/);
    });

    test('creates primary member and family members', async () => {
      const result = await memberRepo.createWithFamily({
        primaryMember: {
          first_name: 'John',
          last_name: 'Smith',
          email: 'john@example.com',
          phone: '555-1234',
          address_street: '123 Main St',
          address_city: 'Billings',
          address_state: 'MT',
          address_zip: '59101'
        },
        familyMembers: [
          { first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com' },
          { first_name: 'Jimmy', last_name: 'Smith', email: '' }
        ],
        membershipType: 'family'
      });

      expect(result.primaryId).toBeDefined();
      expect(result.familyMemberIds).toHaveLength(2);

      const primary = await memberRepo.findById(result.primaryId);
      expect(primary.first_name).toBe('John');
      expect(primary.membership_type).toBe('family');
      expect(primary.primary_member_id).toBeNull();

      const fm1 = await memberRepo.findById(result.familyMemberIds[0]);
      expect(fm1.first_name).toBe('Jane');
      expect(fm1.email).toBe('jane@example.com');
      expect(fm1.membership_type).toBe('family');
      expect(fm1.primary_member_id).toBe(result.primaryId);

      const fm2 = await memberRepo.findById(result.familyMemberIds[1]);
      expect(fm2.first_name).toBe('Jimmy');
      expect(fm2.email).toBe('john@example.com'); // Uses primary email
      expect(fm2.primary_member_id).toBe(result.primaryId);
    });

    test('assigns unique member numbers to all family members', async () => {
      const result = await memberRepo.createWithFamily({
        primaryMember: {
          first_name: 'John',
          last_name: 'Smith',
          email: 'john@example.com'
        },
        familyMembers: [
          { first_name: 'Jane', last_name: 'Smith', email: '' },
          { first_name: 'Jimmy', last_name: 'Smith', email: '' }
        ],
        membershipType: 'family'
      });

      const primary = await memberRepo.findById(result.primaryId);
      const fm1 = await memberRepo.findById(result.familyMemberIds[0]);
      const fm2 = await memberRepo.findById(result.familyMemberIds[1]);

      expect(primary.member_number).toMatch(/^YSH-\d{4}-\d{4}$/);
      expect(fm1.member_number).toMatch(/^YSH-\d{4}-\d{4}$/);
      expect(fm2.member_number).toMatch(/^YSH-\d{4}-\d{4}$/);

      // All should be unique
      expect(primary.member_number).not.toBe(fm1.member_number);
      expect(primary.member_number).not.toBe(fm2.member_number);
      expect(fm1.member_number).not.toBe(fm2.member_number);
    });

    test('creates all members atomically in transaction', async () => {
      const result = await memberRepo.createWithFamily({
        primaryMember: {
          first_name: 'John',
          last_name: 'Smith',
          email: 'john@example.com'
        },
        familyMembers: [
          { first_name: 'Jane', last_name: 'Smith', email: '' },
          { first_name: 'Jimmy', last_name: 'Smith', email: '' }
        ],
        membershipType: 'family'
      });

      const testDb = db.__getCurrentDb();
      const allMembers = testDb.prepare('SELECT * FROM members WHERE id IN (?, ?, ?)')
        .all(result.primaryId, result.familyMemberIds[0], result.familyMemberIds[1]);

      expect(allMembers).toHaveLength(3);
    });
  });
});
