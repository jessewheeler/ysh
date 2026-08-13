/**
 * HTTP integration test for the Needs attention members filter: the real Express app,
 * real session + CSRF middleware, a real admin login, real Pug rendering and a real CSV
 * body. Only the database is swapped for the in-memory SQLite proxy.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/email', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const { SIGNAL_LABELS } = require('../../db/repos/memberAttention');
const {
  insertMember, insertAdmin, insertPayment, insertEmailLog, insertPeriod, enrollMember,
} = require('../helpers/fixtures');

function labelFor(key) {
  return SIGNAL_LABELS.find(s => s.key === key).label;
}

const TEST_OTP = '000000';

function tokenFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error('No CSRF token in response');
  return match[1];
}

async function loginAsAdmin(email) {
  const agent = request.agent(app);
  const loginPage = await agent.get('/admin/login').expect(200);
  await agent.post('/admin/login')
    .type('form')
    .send({ _csrf: tokenFrom(loginPage.text), email })
    .expect(302);
  const verifyPage = await agent.get('/admin/login/verify').expect(200);
  await agent.post('/admin/login/verify')
    .type('form')
    .send({ _csrf: tokenFrom(verifyPage.text), code: TEST_OTP })
    .expect(302);
  return agent;
}

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

let agent;
let period;

beforeEach(async () => {
  db.__resetTestDb();
  // Must actually span today, or periodsRepo.getCurrent() returns null and the
  // period-dependent signals go dark — which is correct behavior, but not what these
  // tests are exercising.
  period = insertPeriod(db, {
    label: 'Current Season',
    start_date: isoDate(-30),
    end_date: isoDate(300),
  });
  insertAdmin(db, { email: 'admin@ysh.test' });
  agent = await loginAsAdmin('admin@ysh.test');
});

/** A member with a declined card payment. */
function seedDeclined(email = 'declined@t.com') {
  const m = insertMember(db, { email, first_name: 'Dana', last_name: 'Declined', status: 'pending' });
  insertPayment(db, { member_id: m.id, status: 'failed' });
  return m;
}

/**
 * A lapsed member whose card email could not be sent. Lapsed rather than paid up,
 * because the eligibility gate excludes anyone in good standing.
 */
function seedBounced(email = 'bounced@t.com') {
  const m = insertMember(db, {
    email, first_name: 'Boris', last_name: 'Bounced', status: 'active', expiry_date: isoDate(-5),
  });
  insertEmailLog(db, { member_id: m.id, email_type: 'card_delivery', status: 'failed' });
  return m;
}

describe('GET /admin/members needs-attention view', () => {
  test('the pill renders with a live count', async () => {
    seedDeclined();
    const res = await agent.get('/admin/members').expect(200);
    expect(res.text).toContain('Needs attention');
    expect(res.text).toContain('view=needs-attention');
  });

  test('lists only flagged members and badges the reason', async () => {
    seedDeclined();
    const clean = insertMember(db, { email: 'clean@t.com', first_name: 'Casey', status: 'active', expiry_date: isoDate(200) });
    insertPayment(db, { member_id: clean.id, status: 'completed' });
    enrollMember(db, clean.id, period.id);

    const res = await agent.get('/admin/members?view=needs-attention').expect(200);
    expect(res.text).toContain('declined@t.com');
    expect(res.text).not.toContain('clean@t.com');
    expect(res.text).toContain('badge-attention');
    expect(res.text).toContain('Payment failed');
  });

  test('shows no Signals column outside the needs-attention view', async () => {
    seedDeclined();
    const res = await agent.get('/admin/members').expect(200);
    expect(res.text).not.toContain('badge-attention');
  });

  test('the signal select is only offered under the needs-attention view', async () => {
    seedDeclined();
    const off = await agent.get('/admin/members').expect(200);
    expect(off.text).not.toContain('name="signal"');

    const on = await agent.get('/admin/members?view=needs-attention').expect(200);
    expect(on.text).toContain('name="signal"');
    // Must carry data-auto-submit, since helmet's script-src-attr 'none' rules out an
    // inline onchange handler.
    expect(on.text).toMatch(/select\(?[^>]*name="signal"[^>]*data-auto-submit/);
  });

  test('the signal parameter narrows to one signal', async () => {
    seedDeclined();
    seedBounced();

    const res = await agent.get('/admin/members?view=needs-attention&signal=payment_failed').expect(200);
    expect(res.text).toContain('declined@t.com');
    expect(res.text).not.toContain('bounced@t.com');
  });

  test('an unknown signal value is ignored rather than erroring', async () => {
    seedDeclined();
    const res = await agent.get('/admin/members?view=needs-attention&signal=nonsense').expect(200);
    // Falls back to the full OR group instead of 500ing or matching nobody.
    expect(res.text).toContain('declined@t.com');
  });

  test('the signal survives a sort link', async () => {
    seedDeclined();
    const res = await agent.get('/admin/members?view=needs-attention&signal=payment_failed').expect(200);
    // Every sort link has to carry the signal, or clicking a column header silently
    // widens the list back out.
    expect(res.text).toMatch(/signal=payment_failed[^"]*sort=|sort=[^"]*signal=payment_failed/);
  });

  test('composes with the search box', async () => {
    seedDeclined();
    seedBounced();
    const res = await agent.get('/admin/members?view=needs-attention&search=declined').expect(200);
    expect(res.text).toContain('declined@t.com');
    expect(res.text).not.toContain('bounced@t.com');
  });

  test('offers a clear-filters link when only a signal is set', async () => {
    seedDeclined();
    const res = await agent.get('/admin/members?view=needs-attention&signal=payment_failed').expect(200);
    expect(res.text).toContain('Clear filters');
  });

  test('shows a reassuring empty state when nothing is wrong', async () => {
    insertMember(db, { email: 'clean@t.com', status: 'active', expiry_date: isoDate(200) });
    const res = await agent.get('/admin/members?view=needs-attention').expect(200);
    expect(res.text).toContain('No members need attention right now');
  });

  test('does not flag a family enrolled in the current season whose card emails failed', async () => {
    // Regression for the MailerSend quota case: a whole family badged from two failed
    // card emails, despite every member having paid for the current season. The null
    // member_id on the failed row makes it match all of them via the shared address.
    const primary = insertMember(db, {
      email: 'family@t.com', first_name: 'Pat', last_name: 'Primary',
      status: 'active', membership_type: 'family', expiry_date: isoDate(350),
    });
    enrollMember(db, primary.id, period.id);
    insertEmailLog(db, { member_id: null, to_email: 'family@t.com', email_type: 'card_delivery', status: 'failed' });
    for (const name of ['Kid', 'Spouse']) {
      const sub = insertMember(db, {
        email: 'family@t.com', first_name: name, last_name: 'Primary', status: 'active',
        membership_type: 'family', primary_member_id: primary.id, expiry_date: isoDate(350),
      });
      enrollMember(db, sub.id, period.id);
    }

    const res = await agent.get('/admin/members?view=needs-attention').expect(200);
    expect(res.text).toContain('No members need attention right now');
  });

  test('still flags a lapsed member with a stale future expiry date', async () => {
    // The over-correction to watch for: excluding anyone whose expiry_date is in the
    // future dropped most of the membership, because expiry_date tracks the period they
    // last paid for, not the one now open.
    insertMember(db, {
      email: 'stale@t.com', first_name: 'Sam', last_name: 'Stale',
      status: 'active', expiry_date: isoDate(350),
    });
    insertEmailLog(db, { member_id: null, to_email: 'stale@t.com', email_type: 'card_delivery', status: 'failed' });

    const res = await agent.get('/admin/members?view=needs-attention').expect(200);
    expect(res.text).toContain('stale@t.com');
  });

  test('reflects the reminder-count setting', async () => {
    const m = insertMember(db, {
      email: 'once@t.com', first_name: 'Olive', status: 'active', expiry_date: isoDate(-5),
    });
    insertEmailLog(db, { member_id: m.id, email_type: 'renewal_reminder' });

    const beforeRes = await agent.get('/admin/members?view=needs-attention&signal=repeated_reminders').expect(200);
    expect(beforeRes.text).not.toContain('once@t.com');

    db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('attention_reminder_count', '1')").run();

    const afterRes = await agent.get('/admin/members?view=needs-attention&signal=repeated_reminders').expect(200);
    expect(afterRes.text).toContain('once@t.com');
  });
});

describe('GET /admin/members/export needs-attention view', () => {
  test('appends a Signals column with the labels', async () => {
    seedDeclined();
    const res = await agent.get('/admin/members/export?view=needs-attention')
      .expect(200)
      .expect('Content-Type', /text\/csv/);

    const [header, ...rows] = res.text.trim().split('\n');
    expect(header).toContain('Signals');
    expect(rows.join('\n')).toContain(labelFor('payment_failed'));
  });

  test('names the file after the view', async () => {
    seedDeclined();
    const res = await agent.get('/admin/members/export?view=needs-attention').expect(200);
    expect(res.headers['content-disposition']).toContain('needs-attention');
  });

  test('joins multiple signals into one cell', async () => {
    const m = insertMember(db, {
      email: 'doubly@t.com', first_name: 'Dee', status: 'pending', created_at: hoursAgo(48),
    });
    insertPayment(db, { member_id: m.id, status: 'failed' });
    insertEmailLog(db, { member_id: m.id, email_type: 'welcome', status: 'failed' });

    const res = await agent.get('/admin/members/export?view=needs-attention').expect(200);
    expect(res.text).toContain(';');
    // Taken from the source so a reworded label cannot quietly break this.
    expect(res.text).toContain(labelFor('payment_failed'));
    expect(res.text).toContain(labelFor('email_send_failed'));
  });

  test('omits the Signals column for other views', async () => {
    seedDeclined();
    const res = await agent.get('/admin/members/export').expect(200);
    expect(res.text.split('\n')[0]).not.toContain('Signals');
  });

  test('honors the signal filter', async () => {
    seedDeclined();
    seedBounced();
    const res = await agent.get('/admin/members/export?view=needs-attention&signal=payment_failed').expect(200);
    expect(res.text).toContain('declined@t.com');
    expect(res.text).not.toContain('bounced@t.com');
  });
});
