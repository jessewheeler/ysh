const eventsRepo = require('../db/repos/events');
const periodsRepo = require('../db/repos/membershipPeriods');

// The club meets in Montana. Game days are defined by local date: a 6:20 PM Sunday night
// kickoff is 00:20Z Monday, and checking in against the UTC date would miss it.
const TIMEZONE = 'America/Denver';

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit',
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' in America/Denver for a Date or ISO string (default: now). */
function localDate(when = new Date()) {
  return DATE_FMT.format(when instanceof Date ? when : new Date(when));
}

/**
 * "6:42 PM" in America/Denver. Accepts a Date (node-pg returns TIMESTAMP columns as Dates)
 * or a string: an ISO string with a zone, or SQLite's zone-less 'YYYY-MM-DD HH:MM:SS',
 * which datetime('now') writes in UTC.
 */
function localTime(when) {
  if (!when) return '';
  let d = when;
  if (!(d instanceof Date)) {
    const s = String(when);
    d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  }
  return Number.isNaN(d.getTime()) ? '' : TIME_FMT.format(d);
}

/**
 * Validate and normalise the admin event form. Returns {errors, fields}; `fields` only
 * holds the admin-editable columns.
 */
function parseEventForm(body = {}) {
  const errors = [];
  const name = String(body.name || '').trim();
  const eventDate = String(body.event_date || '').trim();
  const homeAway = ['home', 'away'].includes(body.home_away) ? body.home_away : null;
  if (!name) errors.push('Event name is required.');
  if (!DATE_RE.test(eventDate) || Number.isNaN(new Date(`${eventDate}T12:00:00Z`).getTime())) {
    errors.push('Event date must be a valid date.');
  }
  const periodId = parseInt(body.membership_period_id, 10) || null;
  return {
    errors,
    fields: {
      name,
      event_date: eventDate,
      opponent: String(body.opponent || '').trim() || null,
      home_away: homeAway,
      location: String(body.location || '').trim() || null,
      notes: String(body.notes || '').trim() || null,
      membership_period_id: periodId,
      cancelled: body.cancelled === 'on' || body.cancelled === '1' ? 1 : 0,
    },
  };
}

/** Creates an event, filing it under the season its date falls in when none is given. */
async function createEvent(fields) {
  let periodId = fields.membership_period_id;
  if (!periodId) {
    const period = await periodsRepo.getCurrent(fields.event_date);
    periodId = period ? period.id : null;
  }
  return eventsRepo.create({ ...fields, membership_period_id: periodId });
}

module.exports = { TIMEZONE, localDate, localTime, parseEventForm, createEvent };
