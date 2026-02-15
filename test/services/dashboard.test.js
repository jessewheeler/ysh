jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const dashboardService = require('../../services/dashboard');
const { insertMember, insertPayment } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('getStats', () => {
  test('returns correct counts', () => {
    const testDb = db.__getCurrentDb();
    const m1 = insertMember(testDb, { email: 'a@a.com', status: 'active' });
    insertMember(testDb, { email: 'b@b.com', status: 'pending' });
    insertPayment(testDb, { member_id: m1.id, amount_cents: 2500, status: 'completed' });

    // Insert an email log entry
    testDb.prepare(
      "INSERT INTO emails_log (to_email, subject, email_type, status) VALUES ('a@a.com', 'Test', 'welcome', 'sent')"
    ).run();

    const stats = dashboardService.getStats();
    expect(stats.totalMembers).toBe(2);
    expect(stats.activeMembers).toBe(1);
    expect(stats.totalRevenue).toBe(2500);
    expect(stats.emailsSent).toBe(1);
  });

  test('returns zeros when empty', () => {
    const stats = dashboardService.getStats();
    expect(stats.totalMembers).toBe(0);
    expect(stats.activeMembers).toBe(0);
    expect(stats.totalRevenue).toBe(0);
    expect(stats.emailsSent).toBe(0);
  });
});

describe('getRecentActivity', () => {
  test('returns recent members and payments', () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertPayment(testDb, { member_id: m.id });

    const activity = dashboardService.getRecentActivity();
    expect(activity.recentMembers).toHaveLength(1);
    expect(activity.recentPayments).toHaveLength(1);
  });

  test('returns empty arrays when empty', () => {
    const activity = dashboardService.getRecentActivity();
    expect(activity.recentMembers).toHaveLength(0);
    expect(activity.recentPayments).toHaveLength(0);
  });
});
