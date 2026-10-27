/**
 * America/Denver wall-clock <-> UTC conversion for `datetime-local` form inputs.
 *
 * Admins type auction start and end times as Montana local time; the database stores them as
 * UTC ISO strings. Intl is the only time zone database we have (no extra dependency), so the
 * conversion works out Denver's UTC offset at a given instant and corrects for DST.
 */

const TIMEZONE = 'America/Denver';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' || !value) return null;
  // SQLite datetime('now') values carry no zone and are UTC.
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Denver wall-clock fields for an instant. */
function denverParts(date) {
  const out = {};
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Denver's offset from UTC at `ms`, in milliseconds (negative: -6h in summer, -7h in winter). */
function offsetMs(ms) {
  const p = denverParts(new Date(ms));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * 'YYYY-MM-DDTHH:MM' read as Denver local time -> UTC ISO string, or null if malformed.
 * A time inside the spring-forward gap (2:00–2:59 AM) comes out an hour later; an ambiguous
 * time on the fall-back night resolves to the first (MDT) occurrence.
 */
function denverInputToUtcIso(input) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(input || '').trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(naive);
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null;

  // Every offset Denver uses within a day of the typed time (one, or two across a DST switch).
  // Try each and keep the earliest instant that reads back as the typed wall time — that picks
  // MDT for the repeated fall-back hour.
  const offsets = new Set();
  for (let h = -24; h <= 24; h += 3) offsets.add(offsetMs(naive + h * 3600000));
  const candidates = [...offsets].map(off => naive - off).sort((a, b) => a - b);
  for (const t of candidates) {
    const p = denverParts(new Date(t));
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute) {
      return new Date(t).toISOString();
    }
  }
  // Nothing matches: the wall time doesn't exist (spring-forward gap). Use standard time's
  // offset, which lands an hour later on the clock.
  return new Date(naive - Math.min(...offsets)).toISOString();
}

const pad = n => String(n).padStart(2, '0');

/** UTC instant -> 'YYYY-MM-DDTHH:MM' Denver local, the value a datetime-local input expects. */
function utcToDenverInput(value) {
  const d = toDate(value);
  if (!d) return '';
  const p = denverParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const displayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

/** "Sat, Nov 1, 6:00 PM MST" — what bidders and admins read. */
function formatDenver(value) {
  const d = toDate(value);
  return d ? displayFormatter.format(d).replace(/\u202f/g, ' ') : '';
}

const shortFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Oct 18, 3:02 PM" — for dense admin tables. */
function formatDenverShort(value) {
  const d = toDate(value);
  return d ? shortFormatter.format(d).replace(/\u202f/g, ' ') : '';
}

/** 'YYYY-MM-DD' Denver calendar date of an instant, or '' when unparseable. */
function denverDate(value) {
  const d = toDate(value);
  if (!d) return '';
  const p = denverParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

const dayLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric',
});

/** 'YYYY-MM-DD' (a calendar date, no zone) -> "Sunday, November 8". `offsetDays` shifts it. */
function formatDayLabel(ymd, offsetDays = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  // Noon UTC keeps the shifted date clear of any day boundary.
  return dayLabelFormatter.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + offsetDays, 12)));
}

module.exports = {
  TIMEZONE, denverInputToUtcIso, utcToDenverInput, formatDenver, formatDenverShort, toDate, denverDate, formatDayLabel,
};
