jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const activation = require('../../services/activation');
const memberRepo = require('../../db/repos/members');
const membershipYearsRepo = require('../../db/repos/membershipYears');
const {
  insertMember,
  insertFamilyMembership,
  insertPeriod,
  insertPayment,
} = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('activateForPeriod', () => {
  test('stamps status, expiry, year and enrollment on an individual member', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb, { start_date: '2025-04-01', end_date: '2026-07-31' });
    const m = insertMember(testDb, { email: 'solo@example.com', status: 'pending', membership_year: 2019 });
    const payment = insertPayment(testDb, { member_id: m.id, payment_method: 'check' });

    const result = await activation.activateForPeriod({
      memberId: m.id,
      period,
      paymentId: payment.id,
    });

    const row = await memberRepo.findById(m.id);
    expect(row.status).toBe('active');
    expect(row.expiry_date).toBe('2026-07-31');
    expect(row.membership_year).toBe(2025);

    const enrollments = await membershipYearsRepo.findByMember(m.id);
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].membership_period_id).toBe(period.id);
    expect(enrollments[0].payment_id).toBe(payment.id);

    expect(result.period.id).toBe(period.id);
    expect(result.members).toHaveLength(1);
    expect(result.primary.id).toBe(m.id);
  });

  test('cascades to every family member', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb, { start_date: '2025-04-01', end_date: '2026-07-31' });
    const { primary, familyMembers } = insertFamilyMembership(testDb, {
      primaryMember: { status: 'pending', membership_year: 2019 },
    });

    const result = await activation.activateForPeriod({ memberId: primary.id, period });

    expect(result.members).toHaveLength(familyMembers.length + 1);
    for (const id of [primary.id, ...familyMembers.map(fm => fm.id)]) {
      const row = await memberRepo.findById(id);
      expect(row.status).toBe('active');
      expect(row.expiry_date).toBe('2026-07-31');
      expect(row.membership_year).toBe(2025);
      expect(await membershipYearsRepo.isEnrolled(id, period.id)).toBe(true);
    }
  });

  test('re-stamps a member who is already active (the offline-renewal bug)', async () => {
    const testDb = db.__getCurrentDb();
    const oldPeriod = insertPeriod(testDb, {
      label: '2024-25', start_date: '2024-04-01', end_date: '2025-07-31',
    });
    const newPeriod = insertPeriod(testDb, {
      label: '2025-26', start_date: '2025-04-01', end_date: '2026-07-31',
    });
    const { primary, familyMembers } = insertFamilyMembership(testDb, {
      primaryMember: { status: 'active', membership_year: 2024, expiry_date: '2025-07-31' },
    });

    await activation.activateForPeriod({ memberId: primary.id, period: newPeriod });

    for (const id of [primary.id, ...familyMembers.map(fm => fm.id)]) {
      const row = await memberRepo.findById(id);
      expect(row.membership_year).toBe(2025);
      expect(row.expiry_date).toBe('2026-07-31');
      expect(await membershipYearsRepo.isEnrolled(id, newPeriod.id)).toBe(true);
    }
    expect(await membershipYearsRepo.isEnrolled(primary.id, oldPeriod.id)).toBe(false);
  });

  test('resolves up to the primary when given a family sub-member id', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb, { start_date: '2025-04-01', end_date: '2026-07-31' });
    const { primary, familyMembers } = insertFamilyMembership(testDb, {
      primaryMember: { status: 'pending' },
    });

    const result = await activation.activateForPeriod({ memberId: familyMembers[0].id, period });

    expect(result.primary.id).toBe(primary.id);
    for (const id of [primary.id, ...familyMembers.map(fm => fm.id)]) {
      const row = await memberRepo.findById(id);
      expect(row.status).toBe('active');
      expect(await membershipYearsRepo.isEnrolled(id, period.id)).toBe(true);
    }
  });

  test('is idempotent — a second run adds no duplicate enrollment', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb, { start_date: '2025-04-01', end_date: '2026-07-31' });
    const m = insertMember(testDb, { email: 'solo@example.com' });

    await activation.activateForPeriod({ memberId: m.id, period });
    await activation.activateForPeriod({ memberId: m.id, period });

    expect(await membershipYearsRepo.findByMember(m.id)).toHaveLength(1);
  });

  test('with no period, activates status only and reports period null', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, {
      email: 'solo@example.com', status: 'pending', membership_year: 2019, expiry_date: '2020-07-31',
    });

    const result = await activation.activateForPeriod({ memberId: m.id, period: null });

    expect(result.period).toBeNull();
    const row = await memberRepo.findById(m.id);
    expect(row.status).toBe('active');
    expect(row.membership_year).toBe(2019);
    expect(row.expiry_date).toBe('2020-07-31');
    expect(await membershipYearsRepo.findByMember(m.id)).toHaveLength(0);
  });

  test('clears the renewal token on the primary', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb, { start_date: '2025-04-01', end_date: '2026-07-31' });
    const m = insertMember(testDb, {
      email: 'solo@example.com',
      renewal_token: 'tok123',
      renewal_token_expires_at: '2099-01-01T00:00:00.000Z',
    });

    await activation.activateForPeriod({ memberId: m.id, period });

    const row = await memberRepo.findById(m.id);
    expect(row.renewal_token).toBeNull();
    expect(row.renewal_token_expires_at).toBeNull();
  });

  test('leaves the renewal token alone when clearRenewalToken is false', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb, { start_date: '2025-04-01', end_date: '2026-07-31' });
    const m = insertMember(testDb, {
      email: 'solo@example.com',
      renewal_token: 'tok123',
      renewal_token_expires_at: '2099-01-01T00:00:00.000Z',
    });

    await activation.activateForPeriod({ memberId: m.id, period, clearRenewalToken: false });

    expect((await memberRepo.findById(m.id)).renewal_token).toBe('tok123');
  });

  test('returns null primary for an unknown member id and writes nothing', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb, { start_date: '2025-04-01', end_date: '2026-07-31' });

    const result = await activation.activateForPeriod({ memberId: 99999, period });

    expect(result.primary).toBeNull();
    expect(result.members).toEqual([]);
  });
});

describe('deliverActivation', () => {
  const cardService = require('../../services/card');
  const emailService = require('../../services/email');
  const senderService = require('../../services/sender');

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(cardService, 'generatePDF').mockResolvedValue('/cards/a.pdf');
    jest.spyOn(cardService, 'generatePNG').mockResolvedValue('/cards/a.png');
    jest.spyOn(emailService, 'sendWelcomeEmail').mockResolvedValue(undefined);
    jest.spyOn(emailService, 'sendPaymentConfirmation').mockResolvedValue(undefined);
    jest.spyOn(emailService, 'sendCardEmail').mockResolvedValue(undefined);
    jest.spyOn(senderService, 'syncMembersSafe').mockResolvedValue(undefined);
  });

  afterAll(() => jest.restoreAllMocks());

  function group(testDb) {
    const { primary, familyMembers } = insertFamilyMembership(testDb, {
      primaryMember: { status: 'active' },
      familyMembers: [
        { first_name: 'Kid', last_name: 'Doe', email: 'primary@family.test' },
        { first_name: 'Teen', last_name: 'Doe', email: 'teen@own.test' },
      ],
    });
    return { primary, members: [primary, ...familyMembers] };
  }

  test('generates cards and sends welcome, receipt and own-address card emails', async () => {
    const { primary, members } = group(db.__getCurrentDb());

    await activation.deliverActivation({ primary, members, receipt: { amount_total: 2600 } });

    expect(cardService.generatePDF).toHaveBeenCalledTimes(3);
    expect(cardService.generatePNG).toHaveBeenCalledTimes(3);
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledTimes(1);
    // Only the two members sharing the primary's address ride along on the welcome.
    expect(emailService.sendWelcomeEmail.mock.calls[0][1]).toHaveLength(2);
    expect(emailService.sendPaymentConfirmation).toHaveBeenCalledTimes(1);
    expect(emailService.sendCardEmail).toHaveBeenCalledTimes(1);
    expect(senderService.syncMembersSafe).toHaveBeenCalledWith(members);
  });

  test('never mails a card that failed to generate', async () => {
    const { primary, members } = group(db.__getCurrentDb());
    cardService.generatePDF.mockRejectedValue(new Error('canvas exploded'));

    await activation.deliverActivation({ primary, members, receipt: { amount_total: 2600 } });

    expect(emailService.sendWelcomeEmail.mock.calls[0][1]).toEqual([]);
    expect(emailService.sendCardEmail).not.toHaveBeenCalled();
  });

  test('generateCards false skips generation but still attaches existing cards', async () => {
    const { primary, members } = group(db.__getCurrentDb());

    await activation.deliverActivation({
      primary, members, receipt: { amount_total: 2600 }, generateCards: false,
    });

    expect(cardService.generatePDF).not.toHaveBeenCalled();
    expect(emailService.sendWelcomeEmail.mock.calls[0][1]).toHaveLength(2);
    expect(emailService.sendCardEmail).toHaveBeenCalledTimes(1);
  });

  test('sendEmails false generates cards and syncs but sends nothing', async () => {
    const { primary, members } = group(db.__getCurrentDb());

    await activation.deliverActivation({
      primary, members, receipt: { amount_total: 2600 }, sendEmails: false,
    });

    expect(cardService.generatePDF).toHaveBeenCalledTimes(3);
    expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(emailService.sendPaymentConfirmation).not.toHaveBeenCalled();
    expect(emailService.sendCardEmail).not.toHaveBeenCalled();
    expect(senderService.syncMembersSafe).toHaveBeenCalled();
  });

  test('one failing send does not drop the rest', async () => {
    const { primary, members } = group(db.__getCurrentDb());
    emailService.sendWelcomeEmail.mockRejectedValue(new Error('bad address'));

    await activation.deliverActivation({ primary, members, receipt: { amount_total: 2600 } });

    expect(emailService.sendPaymentConfirmation).toHaveBeenCalledTimes(1);
    expect(emailService.sendCardEmail).toHaveBeenCalledTimes(1);
  });

  test('skips the receipt when there is no receipt to send', async () => {
    const { primary, members } = group(db.__getCurrentDb());

    await activation.deliverActivation({ primary, members });

    expect(emailService.sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendPaymentConfirmation).not.toHaveBeenCalled();
  });
});
