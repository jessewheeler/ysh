jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/sender', () => ({
  syncMembersSafe: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../../db/database');
const { insertMember, insertPeriod, enrollMember } = require('../helpers/fixtures');
const senderService = require('../../services/sender');
const membersRepo = require('../../db/repos/members');
const membershipExpiry = require('../../services/membershipExpiry');

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function getTestDb() {
  return db.__getCurrentDb();
}

// A period that is open today, so the no-open-period guard does not trip.
function openPeriod(testDb) {
  return insertPeriod(testDb, { start_date: isoDate(-30), end_date: isoDate(30) });
}

beforeEach(() => {
  db.__resetTestDb();
  jest.clearAllMocks();
});

describe('expireLapsedMemberships', () => {
  test('expires a lapsed member and syncs them to Sender', async () => {
    const testDb = getTestDb();
    openPeriod(testDb);
    const m = insertMember(testDb, { email: 'lapsed@a.com', status: 'active' });

    const stats = await membershipExpiry.expireLapsedMemberships();

    expect(stats).toEqual({ expired: 1, failed: 0, total: 1, skipped: null });
    const row = await db.get('SELECT status FROM members WHERE id = ?', m.id);
    expect(row.status).toBe('expired');
    expect(senderService.syncMembersSafe).toHaveBeenCalledTimes(1);
    expect(senderService.syncMembersSafe.mock.calls[0][0].map(x => x.id)).toEqual([m.id]);
  });

  test('leaves an enrolled member alone', async () => {
    const testDb = getTestDb();
    const period = openPeriod(testDb);
    const m = insertMember(testDb, { email: 'ok@a.com', status: 'active' });
    enrollMember(testDb, m.id, period.id);

    const stats = await membershipExpiry.expireLapsedMemberships();

    expect(stats.total).toBe(0);
    expect(senderService.syncMembersSafe).not.toHaveBeenCalled();
  });

  test('aborts and changes nothing when no period is open', async () => {
    // The lapsed rule matches everyone when no season exists. That is a config lapse,
    // not a mass lapse, and must never be acted on.
    const testDb = getTestDb();
    insertPeriod(testDb, { start_date: '2023-04-01', end_date: isoDate(-1) });
    const m = insertMember(testDb, { email: 'a@a.com', status: 'active' });

    const stats = await membershipExpiry.expireLapsedMemberships();

    expect(stats.skipped).toBe('no-open-period');
    expect(stats.expired).toBe(0);
    const row = await db.get('SELECT status FROM members WHERE id = ?', m.id);
    expect(row.status).toBe('active');
    expect(senderService.syncMembersSafe).not.toHaveBeenCalled();
  });

  test('aborts without writing when the candidate count exceeds the ceiling', async () => {
    const testDb = getTestDb();
    openPeriod(testDb);
    const a = insertMember(testDb, { email: 'a@a.com', status: 'active' });
    insertMember(testDb, { email: 'b@a.com', status: 'active' });

    const stats = await membershipExpiry.expireLapsedMemberships({ maxExpirations: 1 });

    expect(stats).toEqual({ expired: 0, failed: 0, total: 2, skipped: 'over-ceiling' });
    const row = await db.get('SELECT status FROM members WHERE id = ?', a.id);
    expect(row.status).toBe('active');
    expect(senderService.syncMembersSafe).not.toHaveBeenCalled();
  });

  test('dry run reports the count without writing or syncing', async () => {
    const testDb = getTestDb();
    openPeriod(testDb);
    const m = insertMember(testDb, { email: 'a@a.com', status: 'active' });

    const stats = await membershipExpiry.expireLapsedMemberships({ dryRun: true });

    expect(stats).toEqual({ expired: 0, failed: 0, total: 1, skipped: 'dry-run' });
    const row = await db.get('SELECT status FROM members WHERE id = ?', m.id);
    expect(row.status).toBe('active');
    expect(senderService.syncMembersSafe).not.toHaveBeenCalled();
  });

  test('is idempotent — a second run finds nothing', async () => {
    const testDb = getTestDb();
    openPeriod(testDb);
    const m = insertMember(testDb, { email: 'a@a.com', status: 'active' });

    await membershipExpiry.expireLapsedMemberships();
    const second = await membershipExpiry.expireLapsedMemberships();

    expect(second).toEqual({ expired: 0, failed: 0, total: 0, skipped: null });
    const audit = testDb.prepare(
      "SELECT * FROM audit_log WHERE table_name = 'members' AND record_id = ? AND action = 'UPDATE'"
    ).all(String(m.id));
    expect(audit).toHaveLength(1);
  });

  test('one failing member does not abort the run', async () => {
    const testDb = getTestDb();
    openPeriod(testDb);
    const a = insertMember(testDb, { email: 'a@a.com', status: 'active' });
    const b = insertMember(testDb, { email: 'b@a.com', status: 'active' });

    const spy = jest.spyOn(membersRepo, 'markExpired')
      .mockRejectedValueOnce(new Error('boom'));

    const stats = await membershipExpiry.expireLapsedMemberships();

    expect(stats.failed).toBe(1);
    expect(stats.expired).toBe(1);
    expect(stats.total).toBe(2);
    expect(senderService.syncMembersSafe.mock.calls[0][0].map(x => x.id)).toEqual([b.id]);
    spy.mockRestore();
    expect(a.id).toBeTruthy();
  });
});
