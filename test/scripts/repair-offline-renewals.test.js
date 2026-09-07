/**
 * The repair script for members whose offline dues payment never moved them onto the
 * period they paid for. Exercised through its exported `run` so no process is spawned.
 */
jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/card', () => ({
  generatePDF: jest.fn().mockResolvedValue('/cards/test.pdf'),
  generatePNG: jest.fn().mockResolvedValue('/cards/test.png'),
}));
jest.mock('../../services/email', () => ({
  sendWelcomeEmail: jest.fn().mockResolvedValue({}),
  sendPaymentConfirmation: jest.fn().mockResolvedValue({}),
  sendCardEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../services/sender', () => ({
  syncMembersSafe: jest.fn().mockResolvedValue(undefined),
  syncMemberSafe: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../../db/database');
const { run, parseArgs } = require('../../scripts/repair-offline-renewals');
const memberRepo = require('../../db/repos/members');
const membershipYearsRepo = require('../../db/repos/membershipYears');
const paymentsRepo = require('../../db/repos/payments');
const cardService = require('../../services/card');
const emailService = require('../../services/email');
const {
  insertMember, insertFamilyMembership, insertPeriod, insertPayment, enrollMember,
} = require('../helpers/fixtures');

// getCurrent() only resolves a period spanning today, so anchor the fixtures on now.
const THIS_YEAR = new Date().getFullYear();
const CURRENT = { label: 'current', start_date: `${THIS_YEAR}-01-01`, end_date: `${THIS_YEAR + 1}-12-31` };
const today = new Date().toISOString().slice(0, 10);

/** The exact shape the bug left behind: active member, paid, nothing else updated. */
function brokenFamily(period, overrides = {}) {
  const { primary, familyMembers } = insertFamilyMembership(db, {
    primaryMember: {
      email: 'household@ysh.test',
      status: 'active',
      membership_year: THIS_YEAR - 2,
      expiry_date: `${THIS_YEAR - 1}-07-31`,
      ...overrides,
    },
  });
  const payment = insertPayment(db, {
    member_id: primary.id,
    payment_method: 'check',
    status: 'completed',
    amount_cents: 2600,
    created_at: `${today} 12:00:00`,
  });
  return { primary, familyMembers, payment, period };
}

// The script logs a line per member; keep the suite output readable.
beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterAll(() => jest.restoreAllMocks());

beforeEach(() => {
  db.__resetTestDb();
  jest.clearAllMocks();
});

const RUN = { migrate: false };

describe('repair-offline-renewals', () => {
  test('dry run reports the repair but writes nothing', async () => {
    const period = insertPeriod(db, CURRENT);
    const { primary, familyMembers } = brokenFamily(period);

    const stats = await run(RUN);

    expect(stats.repaired).toBe(1);
    expect(stats.membersTouched).toBe(1 + familyMembers.length);
    expect((await memberRepo.findById(primary.id)).membership_year).toBe(THIS_YEAR - 2);
    expect(await membershipYearsRepo.findByMember(primary.id)).toHaveLength(0);
  });

  test('--apply stamps the primary and every family member', async () => {
    const period = insertPeriod(db, CURRENT);
    const { primary, familyMembers, payment } = brokenFamily(period);

    const stats = await run({ ...RUN, apply: true });

    expect(stats.repaired).toBe(1);
    for (const id of [primary.id, ...familyMembers.map(fm => fm.id)]) {
      const row = await memberRepo.findById(id);
      expect(row.status).toBe('active');
      expect(row.membership_year).toBe(THIS_YEAR);
      expect(row.expiry_date).toBe(CURRENT.end_date);
      expect(await membershipYearsRepo.isEnrolled(id, period.id)).toBe(true);
    }
    const enrollments = await membershipYearsRepo.findByMember(primary.id);
    expect(enrollments[0].payment_id).toBe(payment.id);
  });

    test('matches a payment whose created_at is a Date, as PostgreSQL returns it', async () => {
        const period = insertPeriod(db, CURRENT);
        const {primary, familyMembers, payment} = brokenFamily(period);

        // SQLite stores created_at as TEXT, but toPgSchema rewrites the column to a real
        // TIMESTAMP, so node-pg hands back a Date. The in-memory SQLite the rest of this suite
        // runs on can never produce that shape, which is why the NOPAY-on-Postgres bug shipped
        // with eighteen passing tests. Stub the repo to return what the pg driver would.
        const rows = await paymentsRepo.findByMemberId(primary.id);
        const spy = jest.spyOn(paymentsRepo, 'findByMemberId').mockResolvedValue(
            rows.map(row => ({...row, created_at: new Date(row.created_at.replace(' ', 'T'))}))
        );

        try {
            const stats = await run({...RUN, apply: true});

            expect(stats.noPayment).toBe(0);
            expect(stats.repaired).toBe(1);
            for (const id of [primary.id, ...familyMembers.map(fm => fm.id)]) {
                expect(await membershipYearsRepo.isEnrolled(id, period.id)).toBe(true);
            }
            const enrollments = await membershipYearsRepo.findByMember(primary.id);
            expect(enrollments[0].payment_id).toBe(payment.id);
        } finally {
            spy.mockRestore();
        }
    });

  test('a second run reports everything already correct', async () => {
    insertPeriod(db, CURRENT);
    brokenFamily(insertPeriod(db, CURRENT));

    await run({ ...RUN, apply: true });
    const stats = await run({ ...RUN, apply: true });

    expect(stats.repaired).toBe(0);
    expect(stats.alreadyCorrect).toBe(1);
  });

  test('sends nothing and generates nothing by default', async () => {
    insertPeriod(db, CURRENT);
    brokenFamily(insertPeriod(db, CURRENT));

    await run({ ...RUN, apply: true });

    expect(cardService.generatePDF).not.toHaveBeenCalled();
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  test('--cards regenerates cards without sending email', async () => {
    insertPeriod(db, CURRENT);
    brokenFamily(insertPeriod(db, CURRENT));

    await run({ ...RUN, apply: true, cards: true });

    expect(cardService.generatePDF).toHaveBeenCalledTimes(3);
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  test('--emails sends without regenerating cards', async () => {
    insertPeriod(db, CURRENT);
    brokenFamily(insertPeriod(db, CURRENT));

    await run({ ...RUN, apply: true, emails: true });

    expect(cardService.generatePDF).not.toHaveBeenCalled();
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendPaymentConfirmation).toHaveBeenCalledTimes(1);
  });

  test('ignores members whose payment was made through Stripe', async () => {
    insertPeriod(db, CURRENT);
    const m = insertMember(db, { email: 'card@ysh.test', status: 'active' });
    insertPayment(db, {
      member_id: m.id, payment_method: 'stripe', status: 'completed', created_at: `${today} 12:00:00`,
    });

    const stats = await run({ ...RUN, apply: true });

    expect(stats.repaired).toBe(0);
    expect(await membershipYearsRepo.findByMember(m.id)).toHaveLength(0);
  });

  test('ignores an offline payment made outside the period window', async () => {
    insertPeriod(db, CURRENT);
    const m = insertMember(db, { email: 'old@ysh.test', status: 'active' });
    insertPayment(db, {
      member_id: m.id, payment_method: 'cash', status: 'completed',
      created_at: `${THIS_YEAR - 3}-05-01 12:00:00`,
    });

    const stats = await run({ ...RUN, apply: true });

    expect(stats.repaired).toBe(0);
  });

  test('reports a member who needs repair but has no payment in the window', async () => {
    const period = insertPeriod(db, CURRENT);
    const m = insertMember(db, {
      email: 'early@ysh.test', status: 'active', membership_year: THIS_YEAR - 2,
    });
    // Paid a fortnight before the period opened — the renewal reminders encourage this.
    insertPayment(db, {
      member_id: m.id, payment_method: 'check', status: 'completed',
      created_at: `${THIS_YEAR - 1}-12-18 12:00:00`,
    });

    const stats = await run({ ...RUN, apply: true });

    expect(stats.noPayment).toBe(1);
    expect(stats.repaired).toBe(0);
    expect(await membershipYearsRepo.isEnrolled(m.id, period.id)).toBe(false);
  });

  test('--early-days sweeps in a renewal paid before the period opened', async () => {
    const period = insertPeriod(db, CURRENT);
    const m = insertMember(db, {
      email: 'early@ysh.test', status: 'active', membership_year: THIS_YEAR - 2,
    });
    insertPayment(db, {
      member_id: m.id, payment_method: 'check', status: 'completed',
      created_at: `${THIS_YEAR - 1}-12-18 12:00:00`,
    });

    const stats = await run({ ...RUN, apply: true, earlyDays: 60 });

    expect(stats.repaired).toBe(1);
    expect(stats.noPayment).toBe(0);
    expect(await membershipYearsRepo.isEnrolled(m.id, period.id)).toBe(true);
  });

  test('never rolls a member back onto an older period they have moved past', async () => {
    const older = insertPeriod(db, {
      label: 'older', start_date: `${THIS_YEAR - 3}-04-01`, end_date: `${THIS_YEAR - 2}-07-31`,
    });
    const newer = insertPeriod(db, CURRENT);
    const m = insertMember(db, {
      email: 'moved@ysh.test', status: 'active',
      membership_year: THIS_YEAR, expiry_date: CURRENT.end_date,
    });
    insertPayment(db, {
      member_id: m.id, payment_method: 'check', status: 'completed',
      created_at: `${THIS_YEAR - 3}-05-01 12:00:00`,
    });
    enrollMember(db, m.id, newer.id);

    const stats = await run({ ...RUN, apply: true, periodId: older.id });

    expect(stats.skipped).toBe(1);
    expect(stats.repaired).toBe(0);
    expect((await memberRepo.findById(m.id)).expiry_date).toBe(CURRENT.end_date);
  });

  test('--member-id repairs one household and leaves the rest alone', async () => {
    const period = insertPeriod(db, CURRENT);
    const target = insertMember(db, { email: 'target@ysh.test', status: 'active' });
    const other = insertMember(db, { email: 'other@ysh.test', status: 'active' });
    for (const m of [target, other]) {
      insertPayment(db, {
        member_id: m.id, payment_method: 'check', status: 'completed', created_at: `${today} 12:00:00`,
      });
    }

    await run({ ...RUN, apply: true, memberId: target.id });

    expect(await membershipYearsRepo.isEnrolled(target.id, period.id)).toBe(true);
    expect(await membershipYearsRepo.isEnrolled(other.id, period.id)).toBe(false);
  });

  test('--member-id given a sub-member repairs the whole household', async () => {
    const period = insertPeriod(db, CURRENT);
    const { primary, familyMembers } = brokenFamily(period);

    await run({ ...RUN, apply: true, memberId: familyMembers[0].id });

    for (const id of [primary.id, ...familyMembers.map(fm => fm.id)]) {
      expect(await membershipYearsRepo.isEnrolled(id, period.id)).toBe(true);
    }
  });

  test('reports nothing to do when no period is open and none was named', async () => {
    insertPeriod(db, {
      label: 'closed', start_date: `${THIS_YEAR - 4}-04-01`, end_date: `${THIS_YEAR - 3}-07-31`,
    });

    const stats = await run({ ...RUN, apply: true });

    expect(stats.repaired).toBe(0);
  });
});

describe('parseArgs', () => {
  test('dry run is the default', () => {
    expect(parseArgs([]).apply).toBe(false);
  });

  test('--deliver turns on both cards and emails', () => {
    expect(parseArgs(['--deliver'])).toMatchObject({ cards: true, emails: true });
  });

  test('--early-days parses, and defaults to no widening', () => {
    expect(parseArgs(['--early-days=90']).earlyDays).toBe(90);
    expect(parseArgs([]).earlyDays).toBe(0);
  });

  test('reads the valued flags', () => {
    expect(parseArgs(['--apply', '--period-id=3', '--member-id=42', '--all-periods'])).toMatchObject({
      apply: true, periodId: '3', memberId: '42', allPeriods: true,
    });
  });
});
