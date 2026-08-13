jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const memberRepo = require('../../db/repos/members');
const memberAttention = require('../../db/repos/memberAttention');
const {
  insertMember, insertPayment, insertEmailLog, insertPeriod, enrollMember,
} = require('../helpers/fixtures');

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Old enough to be past the default 24h unfinished-checkout threshold.
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function isoIn(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  db.__resetTestDb();
});

/** Emails of the members the needs-attention view returns, sorted. */
async function attentionEmails(overrides = {}) {
  const { members } = await memberRepo.search({ view: 'needs-attention', ...overrides });
  return members.map(m => m.email).sort();
}

describe('needs-attention signals', () => {
  test('repeated_reminders flags a member reminded twice who never renewed', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb);
    const stuck = insertMember(testDb, { email: 'stuck@t.com', status: 'active', expiry_date: isoDate(-5) });
    insertEmailLog(testDb, { member_id: stuck.id, email_type: 'renewal_reminder' });
    insertEmailLog(testDb, { member_id: stuck.id, email_type: 'renewal_reminder' });

    // Same two reminders, but they did renew.
    const renewed = insertMember(testDb, { email: 'renewed@t.com', status: 'active', expiry_date: isoDate(-5) });
    insertEmailLog(testDb, { member_id: renewed.id, email_type: 'renewal_reminder' });
    insertEmailLog(testDb, { member_id: renewed.id, email_type: 'renewal_reminder' });
    enrollMember(testDb, renewed.id, period.id);

    expect(await attentionEmails({ currentPeriodId: period.id })).toEqual(['stuck@t.com']);
  });

  test('repeated_reminders respects the reminder threshold', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb);
    const m = insertMember(testDb, { email: 'once@t.com', status: 'active', expiry_date: isoDate(-5) });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'renewal_reminder' });

    // One reminder is below the default of 2.
    const ctx = { currentPeriodId: period.id };
    expect(await attentionEmails({ ...ctx, signal: 'repeated_reminders' })).toEqual([]);
    // Threshold of 1 catches them.
    expect(await attentionEmails({ ...ctx, signal: 'repeated_reminders', minReminders: 1 })).toEqual(['once@t.com']);
  });

  test('repeated_reminders ignores reminders older than the lookback window', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb);
    const m = insertMember(testDb, { email: 'ancient@t.com', status: 'active', expiry_date: isoDate(-5) });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'renewal_reminder', created_at: `${isoDate(-400)} 12:00:00` });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'renewal_reminder', created_at: `${isoDate(-400)} 12:05:00` });

    expect(await attentionEmails({
      currentPeriodId: period.id, signal: 'repeated_reminders', lookbackDays: 180,
    })).toEqual([]);
  });

  test('repeated_reminders ignores non-renewal email types', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb);
    const m = insertMember(testDb, { email: 'blasted@t.com', status: 'active', expiry_date: isoDate(-5) });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'blast' });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'blast' });

    expect(await attentionEmails({ currentPeriodId: period.id, signal: 'repeated_reminders' })).toEqual([]);
  });

  test('payment_failed flags a declined payment with no later success', async () => {
    const testDb = db.__getCurrentDb();
    const declined = insertMember(testDb, { email: 'declined@t.com', status: 'pending' });
    insertPayment(testDb, { member_id: declined.id, status: 'failed' });

    // Failed then retried successfully — not a problem any more.
    const retried = insertMember(testDb, { email: 'retried@t.com', status: 'active' });
    insertPayment(testDb, { member_id: retried.id, status: 'failed' });
    insertPayment(testDb, { member_id: retried.id, status: 'completed' });

    expect(await attentionEmails({ signal: 'payment_failed' })).toEqual(['declined@t.com']);
  });

  test('payment_failed works with no current period', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'noperiod@t.com', status: 'pending' });
    insertPayment(testDb, { member_id: m.id, status: 'failed' });

    expect(await attentionEmails({ currentPeriodId: null })).toEqual(['noperiod@t.com']);
  });

  test('stale_pending_payment flags an old pending payment but not a fresh one', async () => {
    const testDb = db.__getCurrentDb();
    const abandoned = insertMember(testDb, { email: 'abandoned@t.com', status: 'pending' });
    insertPayment(testDb, { member_id: abandoned.id, status: 'pending', created_at: hoursAgo(48) });

    // Still at the Stripe form right now.
    const inFlight = insertMember(testDb, { email: 'inflight@t.com', status: 'pending' });
    insertPayment(testDb, { member_id: inFlight.id, status: 'pending' });

    expect(await attentionEmails({ signal: 'stale_pending_payment' })).toEqual(['abandoned@t.com']);
  });

  test('stale_pending_payment honors the staleHours threshold', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'recent@t.com', status: 'pending' });
    insertPayment(testDb, { member_id: m.id, status: 'pending', created_at: hoursAgo(3) });

    expect(await attentionEmails({ signal: 'stale_pending_payment', staleHours: 24 })).toEqual([]);
    expect(await attentionEmails({ signal: 'stale_pending_payment', staleHours: 1 })).toEqual(['recent@t.com']);
  });

  test('pending_no_payment flags an old pending signup with no payment rows', async () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'nostripe@t.com', status: 'pending', created_at: hoursAgo(48) });

    // Just signed up — still mid-flow, not a problem yet.
    insertMember(testDb, { email: 'justnow@t.com', status: 'pending' });

    // Old pending signup that did reach Stripe is a different signal.
    const reached = insertMember(testDb, { email: 'reached@t.com', status: 'pending', created_at: hoursAgo(48) });
    insertPayment(testDb, { member_id: reached.id, status: 'pending' });

    expect(await attentionEmails({ signal: 'pending_no_payment' })).toEqual(['nostripe@t.com']);
  });

  test('duplicate_pending flags pending duplicates, matching case-insensitively', async () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'dupe@t.com', status: 'pending' });
    insertMember(testDb, { email: 'DUPE@t.com', status: 'pending' });
    insertMember(testDb, { email: 'unique@t.com', status: 'pending' });

    expect(await attentionEmails({ signal: 'duplicate_pending' })).toEqual(['DUPE@t.com', 'dupe@t.com']);
  });

  test('email_send_failed flags a member whose email could not be sent', async () => {
    const testDb = db.__getCurrentDb();
    // Lapsed, not paid up — a paid-up member is excluded by the eligibility gate no
    // matter what failed, so this signal is only ever about people we still need.
    const bounced = insertMember(testDb, { email: 'bounced@t.com', status: 'active', expiry_date: isoDate(-5) });
    insertEmailLog(testDb, { member_id: bounced.id, email_type: 'card_delivery', status: 'failed' });

    const fine = insertMember(testDb, { email: 'fine@t.com', status: 'active', expiry_date: isoDate(-5) });
    insertEmailLog(testDb, { member_id: fine.id, email_type: 'card_delivery', status: 'sent' });

    expect(await attentionEmails({ signal: 'email_send_failed' })).toEqual(['bounced@t.com']);
  });

  test('email_send_failed matches rows logged without a member_id via to_email', async () => {
    const testDb = db.__getCurrentDb();
    insertMember(testDb, { email: 'orphan@t.com', status: 'active', expiry_date: isoDate(-5) });
    // otp and contact emails are logged with a null member_id.
    insertEmailLog(testDb, { member_id: null, to_email: 'ORPHAN@t.com', email_type: 'otp', status: 'failed' });

    expect(await attentionEmails({ signal: 'email_send_failed' })).toEqual(['orphan@t.com']);
  });

  test('email_send_failed flags only the primary when a family shares an address', async () => {
    const testDb = db.__getCurrentDb();
    // Regression: an unattributed card_delivery failure badged all four members of a
    // family, because sub-members carry the primary's email address.
    const primary = insertMember(testDb, {
      email: 'shared@t.com', first_name: 'Pat', status: 'active',
      membership_type: 'family', expiry_date: isoDate(-5),
    });
    for (const name of ['Kid', 'Spouse']) {
      insertMember(testDb, {
        email: 'shared@t.com', first_name: name, status: 'active', membership_type: 'family',
        primary_member_id: primary.id, expiry_date: isoDate(-5),
      });
    }
    insertEmailLog(testDb, { member_id: null, to_email: 'shared@t.com', email_type: 'card_delivery', status: 'failed' });

    const { members } = await memberRepo.search({ view: 'needs-attention', signal: 'email_send_failed' });
    expect(members.map(m => m.first_name)).toEqual(['Pat']);
  });

  test('email_send_failed still flags a sub-member whose own send failed', async () => {
    const testDb = db.__getCurrentDb();
    const primary = insertMember(testDb, {
      email: 'shared@t.com', first_name: 'Pat', status: 'active',
      membership_type: 'family', expiry_date: isoDate(-5),
    });
    const sub = insertMember(testDb, {
      email: 'shared@t.com', first_name: 'Kid', status: 'active', membership_type: 'family',
      primary_member_id: primary.id, expiry_date: isoDate(-5),
    });
    // Attributed directly, so precision is not in question — this must still match.
    insertEmailLog(testDb, { member_id: sub.id, to_email: 'shared@t.com', email_type: 'card_delivery', status: 'failed' });

    const { members } = await memberRepo.search({ view: 'needs-attention', signal: 'email_send_failed' });
    expect(members.map(m => m.first_name).sort()).toEqual(['Kid']);
  });

  test('email_send_failed clears once a later send to the address succeeds', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'recovered@t.com', status: 'active', expiry_date: isoDate(-5) });
    // A MailerSend quota outage, then normal service resumed.
    insertEmailLog(testDb, {
      member_id: m.id, to_email: 'recovered@t.com', email_type: 'renewal_reminder',
      status: 'failed', created_at: `${isoDate(-30)} 12:00:00`,
    });
    insertEmailLog(testDb, {
      member_id: m.id, to_email: 'recovered@t.com', email_type: 'renewal_reminder',
      status: 'sent', created_at: `${isoDate(-2)} 12:00:00`,
    });

    expect(await attentionEmails({ signal: 'email_send_failed' })).toEqual([]);
  });

  test('email_send_failed still fires when the failure is the most recent attempt', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'broken@t.com', status: 'active', expiry_date: isoDate(-5) });
    // Success first, then it broke and stayed broken — an earlier success must not excuse it.
    insertEmailLog(testDb, {
      member_id: m.id, to_email: 'broken@t.com', email_type: 'welcome',
      status: 'sent', created_at: `${isoDate(-30)} 12:00:00`,
    });
    insertEmailLog(testDb, {
      member_id: m.id, to_email: 'broken@t.com', email_type: 'renewal_reminder',
      status: 'failed', created_at: `${isoDate(-2)} 12:00:00`,
    });

    expect(await attentionEmails({ signal: 'email_send_failed' })).toEqual(['broken@t.com']);
  });

  test('email_send_failed recovery is judged per address, not per member', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'target@t.com', status: 'active', expiry_date: isoDate(-5) });
    insertEmailLog(testDb, {
      member_id: m.id, to_email: 'target@t.com', email_type: 'renewal_reminder',
      status: 'failed', created_at: `${isoDate(-30)} 12:00:00`,
    });
    // A later success to a DIFFERENT address proves nothing about this one.
    insertEmailLog(testDb, {
      member_id: m.id, to_email: 'someone.else@t.com', email_type: 'blast',
      status: 'sent', created_at: `${isoDate(-2)} 12:00:00`,
    });

    expect(await attentionEmails({ signal: 'email_send_failed' })).toEqual(['target@t.com']);
  });

  test('renewal_never_started flags a lapsed member holding an unused token', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb);
    insertMember(testDb, {
      email: 'lapsed@t.com', status: 'active', expiry_date: isoDate(-10),
      renewal_token: 'tok-lapsed', renewal_token_expires_at: isoIn(20),
    });

    // Same token, but not lapsed yet — that is the Needs renewal pill's job, not this.
    insertMember(testDb, {
      email: 'upcoming@t.com', status: 'active', expiry_date: isoDate(10),
      renewal_token: 'tok-upcoming', renewal_token_expires_at: isoIn(20),
    });

    expect(await attentionEmails({ currentPeriodId: period.id, signal: 'renewal_never_started' }))
      .toEqual(['lapsed@t.com']);
  });

  test('renewal_never_started does not double-flag the repeatedly reminded', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb);
    const m = insertMember(testDb, {
      email: 'reminded@t.com', status: 'active', expiry_date: isoDate(-10),
      renewal_token: 'tok', renewal_token_expires_at: isoIn(20),
    });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'renewal_reminder' });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'renewal_reminder' });

    const ctx = { currentPeriodId: period.id };
    // The two signals partition on reminder count rather than both firing.
    expect(await attentionEmails({ ...ctx, signal: 'repeated_reminders' })).toEqual(['reminded@t.com']);
    expect(await attentionEmails({ ...ctx, signal: 'renewal_never_started' })).toEqual([]);
  });

  test('renewal_never_started ignores an expired token', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb);
    insertMember(testDb, {
      email: 'stale-token@t.com', status: 'active', expiry_date: isoDate(-10),
      renewal_token: 'tok', renewal_token_expires_at: isoIn(-1),
    });

    expect(await attentionEmails({ currentPeriodId: period.id, signal: 'renewal_never_started' })).toEqual([]);
  });

  test('cancelled members are never flagged', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'gone@t.com', status: 'cancelled' });
    insertPayment(testDb, { member_id: m.id, status: 'failed' });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'card_delivery', status: 'failed' });

    expect(await attentionEmails({})).toEqual([]);
  });

  test('members enrolled in the current period are never flagged', async () => {
    const testDb = db.__getCurrentDb();
    // Regression: a family whose card emails failed on a MailerSend quota error was
    // badged even though every member had paid for the current season.
    const period = insertPeriod(testDb);
    const paidUp = insertMember(testDb, { email: 'paidup@t.com', status: 'active', expiry_date: isoDate(350) });
    enrollMember(testDb, paidUp.id, period.id);
    insertEmailLog(testDb, { member_id: paidUp.id, email_type: 'card_delivery', status: 'failed' });
    insertPayment(testDb, { member_id: paidUp.id, status: 'failed' });

    expect(await attentionEmails({ currentPeriodId: period.id })).toEqual([]);
  });

  test('a member with no expiry date but no current enrollment is still eligible', async () => {
    const testDb = db.__getCurrentDb();
    // Most of the membership predates expiry tracking and has a NULL expiry_date.
    // Treating NULL as "in good standing" silently dropped ~106 of 172 active members
    // who had genuinely not renewed.
    const period = insertPeriod(testDb);
    const m = insertMember(testDb, { email: 'noexpiry@t.com', status: 'active', expiry_date: null });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'card_delivery', status: 'failed' });

    expect(await attentionEmails({ currentPeriodId: period.id })).toEqual(['noexpiry@t.com']);
  });

  test('a future expiry date does not excuse a missing current enrollment', async () => {
    const testDb = db.__getCurrentDb();
    // expiry_date is set from the period end date on payment, so it can point past today
    // while the member has not paid for the season now open. Enrollment is the truth.
    const period = insertPeriod(testDb);
    const m = insertMember(testDb, { email: 'staleexpiry@t.com', status: 'active', expiry_date: isoDate(350) });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'card_delivery', status: 'failed' });

    expect(await attentionEmails({ currentPeriodId: period.id })).toEqual(['staleexpiry@t.com']);
  });

  test('with no current period, only cancelled and lifetime members are excluded', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'offseason@t.com', status: 'active' });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'card_delivery', status: 'failed' });

    // Degrades to a wider list rather than an empty one.
    expect(await attentionEmails({ currentPeriodId: null })).toEqual(['offseason@t.com']);
  });

  test('lifetime members are never flagged', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'life@t.com', status: 'active', is_lifetime: 1, expiry_date: isoDate(-400) });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'card_delivery', status: 'failed' });

    // Lifetime members never renew, so a stale expiry date must not drag them in.
    expect(await attentionEmails({})).toEqual([]);
  });

  test('a lapsed member still carrying status=active is eligible', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb);
    // Nothing in the app ever writes status='expired', so this is what every lapsed
    // member actually looks like. Gating on the raw status would make the renewal
    // signals unreachable.
    const lapsed = insertMember(testDb, { email: 'lapsed@t.com', status: 'active', expiry_date: isoDate(-5) });
    insertEmailLog(testDb, { member_id: lapsed.id, email_type: 'renewal_reminder' });
    insertEmailLog(testDb, { member_id: lapsed.id, email_type: 'renewal_reminder' });

    expect(await attentionEmails({ currentPeriodId: period.id })).toEqual(['lapsed@t.com']);
  });

  test('a clean active enrolled member is never flagged', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb);
    const m = insertMember(testDb, { email: 'happy@t.com', status: 'active', expiry_date: isoDate(200) });
    insertPayment(testDb, { member_id: m.id, status: 'completed' });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'welcome', status: 'sent' });
    enrollMember(testDb, m.id, period.id);

    expect(await attentionEmails({ currentPeriodId: period.id })).toEqual([]);
  });

  test('a member tripping two signals appears exactly once', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'doubly@t.com', status: 'pending', created_at: hoursAgo(48) });
    insertPayment(testDb, { member_id: m.id, status: 'failed' });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'welcome', status: 'failed' });

    const { members, total } = await memberRepo.search({ view: 'needs-attention' });
    expect(total).toBe(1);
    expect(members).toHaveLength(1);
  });

  test('a null current period disables the period-dependent signals only', async () => {
    const testDb = db.__getCurrentDb();
    // Would trip repeated_reminders if a period existed.
    const reminded = insertMember(testDb, { email: 'reminded@t.com', status: 'active', expiry_date: isoDate(-5) });
    insertEmailLog(testDb, { member_id: reminded.id, email_type: 'renewal_reminder' });
    insertEmailLog(testDb, { member_id: reminded.id, email_type: 'renewal_reminder' });
    // Period-independent.
    const declined = insertMember(testDb, { email: 'declined@t.com', status: 'pending' });
    insertPayment(testDb, { member_id: declined.id, status: 'failed' });

    expect(await attentionEmails({ currentPeriodId: null })).toEqual(['declined@t.com']);
  });

  test('an unknown signal key matches nobody rather than everybody', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'flagged@t.com', status: 'pending' });
    insertPayment(testDb, { member_id: m.id, status: 'failed' });

    const clause = memberAttention.attentionClause({ signal: 'not_a_real_signal' });
    const rows = await db.all(`SELECT id FROM members WHERE ${clause.sql}`, ...clause.params);
    expect(rows).toEqual([]);
  });

  test('needs-attention composes with the search box', async () => {
    const testDb = db.__getCurrentDb();
    const a = insertMember(testDb, { email: 'aaron@t.com', first_name: 'Aaron', status: 'pending' });
    const b = insertMember(testDb, { email: 'bella@t.com', first_name: 'Bella', status: 'pending' });
    insertPayment(testDb, { member_id: a.id, status: 'failed' });
    insertPayment(testDb, { member_id: b.id, status: 'failed' });

    expect(await attentionEmails({ search: 'bella' })).toEqual(['bella@t.com']);
  });

  test('countByView reports the needs-attention total', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'flagged@t.com', status: 'pending' });
    insertPayment(testDb, { member_id: m.id, status: 'failed' });

    const counts = await memberRepo.countByView(null);
    expect(counts.needsAttention).toBe(1);
  });
});

describe('signalsForIds', () => {
  test('returns exactly the signals that fired, per member', async () => {
    const testDb = db.__getCurrentDb();
    const declined = insertMember(testDb, { email: 'declined@t.com', status: 'pending' });
    insertPayment(testDb, { member_id: declined.id, status: 'failed' });

    const bounced = insertMember(testDb, { email: 'bounced@t.com', status: 'active' });
    insertEmailLog(testDb, { member_id: bounced.id, email_type: 'welcome', status: 'failed' });

    const map = await memberAttention.signalsForIds([declined.id, bounced.id], {});
    expect(map.get(declined.id).map(s => s.key)).toEqual(['payment_failed']);
    expect(map.get(bounced.id).map(s => s.key)).toEqual(['email_send_failed']);
  });

  test('reports every signal a member trips', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'doubly@t.com', status: 'pending', created_at: hoursAgo(48) });
    insertPayment(testDb, { member_id: m.id, status: 'failed' });
    insertEmailLog(testDb, { member_id: m.id, email_type: 'welcome', status: 'failed' });

    const map = await memberAttention.signalsForIds([m.id], {});
    expect(map.get(m.id).map(s => s.key).sort()).toEqual(['email_send_failed', 'payment_failed']);
  });

  test('returns an empty list for a clean member', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'clean@t.com', status: 'active' });

    const map = await memberAttention.signalsForIds([m.id], {});
    expect(map.get(m.id)).toEqual([]);
  });

  test('signals carry a label and a short badge text', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'declined@t.com', status: 'pending' });
    insertPayment(testDb, { member_id: m.id, status: 'failed' });

    const [signal] = (await memberAttention.signalsForIds([m.id], {})).get(m.id);
    expect(signal).toEqual({ key: 'payment_failed', label: expect.any(String), short: expect.any(String) });
    expect(signal.short.length).toBeGreaterThan(0);
  });

  test('an empty id list returns an empty map without querying', async () => {
    const map = await memberAttention.signalsForIds([], {});
    expect(map.size).toBe(0);
  });

  test('chunks past the SQLite bound-parameter ceiling', async () => {
    const testDb = db.__getCurrentDb();
    const ids = [];
    for (let i = 0; i < 450; i++) {
      ids.push(insertMember(testDb, { email: `m${i}@t.com`, status: 'active' }).id);
    }
    // 450 ids exceeds the 400-per-chunk limit, and the predicate params ride along on
    // each chunk — this would blow the 999-param ceiling in a single statement.
    const map = await memberAttention.signalsForIds(ids, {});
    expect(map.size).toBe(450);
  });

  test('attribution agrees with the filter that selected the rows', async () => {
    const testDb = db.__getCurrentDb();
    const period = insertPeriod(testDb);
    insertMember(testDb, { email: 'clean@t.com', status: 'active', expiry_date: isoDate(100) });
    const flagged = insertMember(testDb, { email: 'flagged@t.com', status: 'pending', created_at: hoursAgo(48) });
    insertPayment(testDb, { member_id: flagged.id, status: 'pending', created_at: hoursAgo(48) });

    const ctx = { currentPeriodId: period.id };
    const { members } = await memberRepo.search({ view: 'needs-attention', ...ctx });
    const map = await memberAttention.signalsForIds(members.map(m => m.id), ctx);

    // Every row the filter returned must have at least one badge, or the coordinator
    // sees a member with no stated reason.
    expect(members.length).toBeGreaterThan(0);
    for (const member of members) {
      expect(map.get(member.id).length).toBeGreaterThan(0);
    }
  });
});
