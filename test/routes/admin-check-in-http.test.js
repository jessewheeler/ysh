/**
 * HTTP integration test for game-day check-in (issue #114): the real Express app, session,
 * CSRF, admin login and Pug rendering. Only the database is swapped for in-memory SQLite,
 * and ESPN's schedule endpoint is mocked where a test syncs.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));
jest.mock('../../services/email', () => ({
  sendOtpEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const { localDate } = require('../../services/events');
const {
  insertMember, insertAdmin, insertPeriod, enrollMember, insertFamilyMembership, insertEvent,
} = require('../helpers/fixtures');
const espnFixture = require('../fixtures/espn-sea-schedule.json');

const TEST_OTP = '000000';

function tokenFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/)
    || html.match(/name="csrf-token" content="([^"]+)"/);
  if (!match) throw new Error('No CSRF token in response');
  return match[1];
}

async function loginAsAdmin(email) {
  const agent = request.agent(app);
  const loginPage = await agent.get('/admin/login').expect(200);
  await agent.post('/admin/login').type('form').send({ _csrf: tokenFrom(loginPage.text), email }).expect(302);
  const verifyPage = await agent.get('/admin/login/verify').expect(200);
  await agent.post('/admin/login/verify').type('form').send({ _csrf: tokenFrom(verifyPage.text), code: TEST_OTP }).expect(302);
  return agent;
}

function shiftDate(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const today = localDate();
let agent;
let period;
let event;

beforeEach(async () => {
  db.__resetTestDb();
  period = insertPeriod(db, { label: 'This Season', start_date: shiftDate(today, -60), end_date: shiftDate(today, 300) });
  event = insertEvent(db, { name: 'Week 4 vs Los Angeles Chargers', event_date: today, membership_period_id: period.id });
  insertAdmin(db, { email: 'staff@ysh.test', role: 'editor' });
  agent = await loginAsAdmin('staff@ysh.test');
});

const checkIns = () => db.prepare('SELECT member_id, tickets_issued FROM check_ins ORDER BY member_id').all();

describe('GET /admin/check-in', () => {
  test('defaults to today\'s event and finds a family member by their own name', async () => {
    const { primary } = insertFamilyMembership(db, {
      primaryMember: { first_name: 'Pat', last_name: 'Hawk' },
      familyMembers: [{ first_name: 'Robin', last_name: 'Nest', email: 'robin@x.test' }],
    });
    const res = await agent.get('/admin/check-in?search=robin').expect(200);
    expect(res.text).toContain('Week 4 vs Los Angeles Chargers');
    expect(res.text).toContain('Robin Nest');
    expect(res.text).toContain(`${primary.first_name} ${primary.last_name}`);
  });

  test('on a non-game day, opens on the next upcoming event', async () => {
    db.prepare('UPDATE events SET event_date = ? WHERE id = ?').run(shiftDate(today, -3), event.id);
    const next = insertEvent(db, { name: 'Week 5 at Arizona Cardinals', event_date: shiftDate(today, 4), membership_period_id: period.id });
    insertEvent(db, { name: 'Week 6 vs Denver', event_date: shiftDate(today, 11), membership_period_id: period.id });
    const res = await agent.get('/admin/check-in').expect(200);
    expect(res.text).toMatch(new RegExp(`<option value="${next.id}" selected`));
    expect(res.text).toContain(`Week 5 at Arizona Cardinals</strong> (${shiftDate(today, 4)})`);
  });

  test('?event= still wins over the nearest event', async () => {
    const other = insertEvent(db, { name: 'Bye Week Social', event_date: shiftDate(today, 2), membership_period_id: period.id });
    const res = await agent.get(`/admin/check-in?event=${other.id}`).expect(200);
    expect(res.text).toContain('Checking in for <strong>Bye Week Social</strong>');
  });

  test('an event beyond the picker window is slotted in by date', async () => {
    db.prepare('UPDATE events SET event_date = ? WHERE id = ?').run(shiftDate(today, -3), event.id);
    const far = insertEvent(db, { name: 'Far Game', event_date: shiftDate(today, 12), membership_period_id: period.id });
    const res = await agent.get('/admin/check-in').expect(200);
    expect(res.text).toMatch(new RegExp(`<option value="${far.id}" selected`));
    expect(res.text.indexOf('Week 4 vs Los Angeles Chargers')).toBeLessThan(res.text.indexOf('Far Game'));
  });

  test('with only past events, opens on the most recent one', async () => {
    db.prepare('UPDATE events SET event_date = ? WHERE id = ?').run(shiftDate(today, -30), event.id);
    const res = await agent.get('/admin/check-in').expect(200);
    expect(res.text).toContain(`Week 4 vs Los Angeles Chargers</strong> (${shiftDate(today, -30)})`);
  });

  test('with no events at all, asks for some instead of searching', async () => {
    db.prepare('DELETE FROM events').run();
    const res = await agent.get('/admin/check-in').expect(200);
    expect(res.text).toContain('No events yet.');
    expect(res.text).not.toContain('name="search"');
  });
});

describe('GET /admin/events view pills', () => {
  const rowIds = (html) => [...html.matchAll(/data-event-id="(\d+)"/g)].map(m => Number(m[1]));
  let past;
  let next;

  beforeEach(() => {
    db.prepare('UPDATE events SET event_date = ? WHERE id = ?').run(shiftDate(today, 7), event.id);
    past = insertEvent(db, { name: 'Last Week', event_date: shiftDate(today, -7), membership_period_id: period.id });
    next = insertEvent(db, { name: 'Tomorrow', event_date: shiftDate(today, 1), membership_period_id: period.id });
  });

  test('opens on Upcoming with the next event as the first row', async () => {
    const res = await agent.get('/admin/events').expect(200);
    expect(rowIds(res.text)).toEqual([next.id, event.id]);
    expect(res.text).toMatch(/view-pill view-pill-active" href="\/admin\/events[^"]*">Upcoming<span class="pill-count">2</);
    expect(res.text).toMatch(/>Past<span class="pill-count">1</);
    expect(res.text).toMatch(/>All<span class="pill-count">3</);
  });

  test('Past shows only earlier events and All shows everything in date order', async () => {
    const pastRes = await agent.get('/admin/events?view=past').expect(200);
    expect(rowIds(pastRes.text)).toEqual([past.id]);
    expect(pastRes.text).toContain('name="view" value="past"');
    const allRes = await agent.get('/admin/events?view=all').expect(200);
    expect(rowIds(allRes.text)).toEqual([past.id, next.id, event.id]);
  });

  test('an unknown view falls back to Upcoming', async () => {
    const res = await agent.get('/admin/events?view=nope').expect(200);
    expect(rowIds(res.text)).toEqual([next.id, event.id]);
  });
});

describe('household check-in', () => {
  test('ticking two of three records exactly those two, one ticket each', async () => {
    const { primary, familyMembers: [jane, jimmy] } = insertFamilyMembership(db);
    enrollMember(db, primary.id, period.id);

    const page = await agent.get(`/admin/check-in/${event.id}/member/${jimmy.id}`).expect(200);
    expect(page.text).toContain(`name="present_${primary.id}"`);
    expect(page.text).toContain(`name="present_${jane.id}"`);

    const res = await agent.post(`/admin/check-in/${event.id}/member/${jimmy.id}`)
      .type('form')
      .send({
        _csrf: tokenFrom(page.text),
        [`present_${primary.id}`]: '1', [`tickets_${primary.id}`]: '1',
        [`present_${jimmy.id}`]: '1', [`tickets_${jimmy.id}`]: '1',
        [`tickets_${jane.id}`]: '1',
      })
      .expect(302);
    expect(res.headers.location).toBe(`/admin/check-in?event=${event.id}`);
    expect(checkIns()).toEqual([
      { member_id: primary.id, tickets_issued: 1 },
      { member_id: jimmy.id, tickets_issued: 1 },
    ]);

    const again = await agent.get(`/admin/check-in/${event.id}/member/${primary.id}`).expect(200);
    expect(again.text).toContain('Already checked in');

    const detail = await agent.get(`/admin/events/${event.id}`).expect(200);
    expect(detail.text).toContain('2 checked in · 2 raffle tickets');
  });

  test('a lapsed member is checked in with no tickets', async () => {
    const m = insertMember(db, { email: 'lapsed@x.test', status: 'active' });
    const page = await agent.get(`/admin/check-in/${event.id}/member/${m.id}`).expect(200);
    expect(page.text).toContain('Not enrolled');
    await agent.post(`/admin/check-in/${event.id}/member/${m.id}`)
      .type('form')
      .send({ _csrf: tokenFrom(page.text), [`present_${m.id}`]: '1', [`tickets_${m.id}`]: '3' })
      .expect(302);
    expect(checkIns()).toEqual([{ member_id: m.id, tickets_issued: 0 }]);
  });
});

describe('events', () => {
  test('manual create files the event under the season its date falls in', async () => {
    const page = await agent.get('/admin/events/new').expect(200);
    const res = await agent.post('/admin/events')
      .type('form')
      .send({ _csrf: tokenFrom(page.text), name: 'Bye week social', event_date: shiftDate(today, 5), location: 'The Rail' })
      .expect(302);
    const row = db.prepare("SELECT * FROM events WHERE name = 'Bye week social'").get();
    expect(res.headers.location).toBe(`/admin/events/${row.id}`);
    expect(row).toMatchObject({ membership_period_id: period.id, source: 'manual', location: 'The Rail' });
  });

  test('create refuses a missing name', async () => {
    const page = await agent.get('/admin/events/new').expect(200);
    const res = await agent.post('/admin/events')
      .type('form')
      .send({ _csrf: tokenFrom(page.text), name: '', event_date: today })
      .expect(400);
    expect(res.text).toContain('Event name is required.');
  });

  test('sync reports a failure to reach ESPN instead of erroring', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
    try {
      const page = await agent.get('/admin/events').expect(200);
      await agent.post('/admin/events/sync').type('form').send({ _csrf: tokenFrom(page.text) }).expect(302);
      const after = await agent.get('/admin/events').expect(200);
      expect(after.text).toContain('Could not reach the ESPN schedule');
    } finally {
      global.fetch = realFetch;
    }
  });

  test('sync creates the season\'s games', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async (url) => ({
      ok: true,
      json: async () => (url.includes('seasontype=3') ? { events: [] } : JSON.parse(JSON.stringify(espnFixture))),
    }));
    try {
      const page = await agent.get('/admin/events').expect(200);
      await agent.post('/admin/events/sync').type('form').send({ _csrf: tokenFrom(page.text) }).expect(302);
      expect(db.prepare("SELECT COUNT(*) AS c FROM events WHERE source = 'espn'").get().c).toBe(3);
    } finally {
      global.fetch = realFetch;
    }
  });

  test('attendance and raffle CSVs', async () => {
    const m = insertMember(db, { first_name: 'Sam', last_name: 'Wing', email: 'sam@x.test', member_number: 'YSH-7' });
    enrollMember(db, m.id, period.id);
    const page = await agent.get(`/admin/check-in/${event.id}/member/${m.id}`).expect(200);
    await agent.post(`/admin/check-in/${event.id}/member/${m.id}`)
      .type('form')
      .send({ _csrf: tokenFrom(page.text), [`present_${m.id}`]: '1', [`tickets_${m.id}`]: '2' })
      .expect(302);

    const attendance = await agent.get(`/admin/events/${event.id}/attendance.csv`).expect(200);
    expect(attendance.headers['content-type']).toMatch(/text\/csv/);
    expect(attendance.text).toMatch(/YSH-7,Sam,Wing,sam@x\.test,,yes,2,/);

    const raffle = await agent.get(`/admin/events/raffle.csv?period=${period.id}`).expect(200);
    expect(raffle.text).toMatch(/YSH-7,Sam,Wing,sam@x\.test,,1,2/);
  });
});

describe('member page', () => {
  test('offers Check In when there is an event today', async () => {
    const m = insertMember(db, { email: 'here@x.test' });
    const res = await agent.get(`/admin/members/${m.id}`).expect(200);
    expect(res.text).toContain(`/admin/check-in/${event.id}/member/${m.id}`);
  });
});
