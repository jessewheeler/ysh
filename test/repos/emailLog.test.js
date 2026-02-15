jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const emailLogRepo = require('../../db/repos/emailLog');
const { insertMember } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('insert', () => {
  test('creates an email log entry', async () => {
    await emailLogRepo.insert({ to_email: 'a@a.com', subject: 'Test', email_type: 'welcome', status: 'sent' });
    expect(await emailLogRepo.countAll()).toBe(1);
  });
});

describe('list', () => {
  test('returns paginated results', async () => {
    await emailLogRepo.insert({ to_email: 'a@a.com', subject: 'A', email_type: 'welcome', status: 'sent' });
    await emailLogRepo.insert({ to_email: 'b@b.com', subject: 'B', email_type: 'blast', status: 'sent' });

    const result = await emailLogRepo.list({ limit: 1, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.emails).toHaveLength(1);
  });
});

describe('listByMemberId', () => {
  test('returns emails for a specific member', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    await emailLogRepo.insert({ to_email: 'a@a.com', subject: 'A', email_type: 'welcome', status: 'sent', member_id: m.id });
    await emailLogRepo.insert({ to_email: 'b@b.com', subject: 'B', email_type: 'welcome', status: 'sent' });

    const emails = await emailLogRepo.listByMemberId(m.id, 10);
    expect(emails).toHaveLength(1);
    expect(emails[0].to_email).toBe('a@a.com');
  });
});

describe('countAll', () => {
  test('returns total count', async () => {
    expect(await emailLogRepo.countAll()).toBe(0);
    await emailLogRepo.insert({ to_email: 'a@a.com', subject: 'A', email_type: 'welcome', status: 'sent' });
    expect(await emailLogRepo.countAll()).toBe(1);
  });
});
