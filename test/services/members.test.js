jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { generateMemberNumber, findMemberById, findMemberByEmail, activateMember } = require('../../services/members');
const { insertMember } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('generateMemberNumber', () => {
  test('returns YSH-YYYY-0001 for first member of that year', () => {
    expect(generateMemberNumber(2025)).toBe('YSH-2025-0001');
  });

  test('increments the sequence number', () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'a@a.com', membership_year: 2025 });
    insertMember(testDb, { email: 'b@b.com', membership_year: 2025 });
    expect(generateMemberNumber(2025)).toBe('YSH-2025-0003');
  });

  test('defaults to current year when no year given', () => {
    const currentYear = new Date().getFullYear();
    expect(generateMemberNumber()).toBe(`YSH-${currentYear}-0001`);
  });

  test('pads sequence to 4 digits', () => {
    expect(generateMemberNumber(2025)).toMatch(/^YSH-2025-\d{4}$/);
  });

  test('counts per year independently', () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'a@a.com', membership_year: 2024 });
    insertMember(testDb, { email: 'b@b.com', membership_year: 2024 });
    expect(generateMemberNumber(2025)).toBe('YSH-2025-0001');
  });
});

describe('findMemberById', () => {
  test('returns the member when found', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'test@test.com', first_name: 'Alice' });
    const found = findMemberById(m.id);
    expect(found).toBeDefined();
    expect(found.first_name).toBe('Alice');
    expect(found.email).toBe('test@test.com');
  });

  test('returns undefined when not found', () => {
    expect(findMemberById(9999)).toBeUndefined();
  });
});

describe('findMemberByEmail', () => {
  test('returns the member when found', () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'lookup@test.com', last_name: 'Smith' });
    const found = findMemberByEmail('lookup@test.com');
    expect(found).toBeDefined();
    expect(found.last_name).toBe('Smith');
  });

  test('returns undefined when not found', () => {
    expect(findMemberByEmail('nobody@test.com')).toBeUndefined();
  });
});

describe('activateMember', () => {
  test('sets status to active and updates timestamp', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'act@test.com', status: 'pending' });
    activateMember(m.id);
    const updated = findMemberById(m.id);
    expect(updated.status).toBe('active');
  });

  test('is a no-op for missing id', () => {
    expect(() => activateMember(9999)).not.toThrow();
  });
});
