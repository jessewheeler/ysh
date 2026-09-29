const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

const FIELDS = ['name', 'event_date', 'kickoff_at', 'opponent', 'home_away', 'location', 'notes',
    'membership_period_id', 'cancelled'];

async function get(id) {
    return db.get('SELECT * FROM events WHERE id = ?', id);
}

async function findByExternalId(externalId) {
    return db.get('SELECT * FROM events WHERE external_id = ?', externalId);
}

// Upcoming runs from today onward, soonest first; Past is before today, most recent first;
// All reads like a schedule. `today` is the America/Denver date, bound as a parameter.
const EVENT_VIEWS = ['upcoming', 'past', 'all'];
const VIEW_DATE_CLAUSE = {upcoming: 'e.event_date >= ?', past: 'e.event_date < ?'};
const VIEW_ORDER = {
    upcoming: 'e.event_date ASC, e.kickoff_at ASC, e.id ASC',
    past: 'e.event_date DESC, e.kickoff_at DESC, e.id DESC',
    all: 'e.event_date ASC, e.kickoff_at ASC, e.id ASC',
};

/**
 * Events in one view, each with its attendance and ticket totals.
 * `periodId` narrows to one season; cancelled events are left out unless asked for.
 */
async function list({periodId = null, includeCancelled = true, view = 'all', today = null} = {}) {
    if (!EVENT_VIEWS.includes(view)) view = 'all';
    const clauses = [];
    const params = [];
    if (periodId) {
        clauses.push('e.membership_period_id = ?');
        params.push(periodId);
    }
    if (!includeCancelled) clauses.push('e.cancelled = 0');
    if (VIEW_DATE_CLAUSE[view]) {
        clauses.push(VIEW_DATE_CLAUSE[view]);
        params.push(today);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await db.all(
        `SELECT e.*,
                (SELECT COUNT(*) FROM check_ins c WHERE c.event_id = e.id) AS attendance,
                (SELECT COALESCE(SUM(c.tickets_issued), 0) FROM check_ins c WHERE c.event_id = e.id) AS tickets
         FROM events e
         ${where}
         ORDER BY ${VIEW_ORDER[view]}`,
        ...params
    );
    return rows.map(r => ({...r, attendance: Number(r.attendance), tickets: Number(r.tickets)}));
}

/** Pill counts for the Events list: {upcoming, past, all}, narrowed to one season when given. */
async function countByView({periodId = null, today}) {
    const where = periodId ? 'WHERE membership_period_id = ?' : '';
    const params = periodId ? [today, periodId] : [today];
    const row = await db.get(
        `SELECT COUNT(*) AS all_count,
                COALESCE(SUM(CASE WHEN event_date >= ? THEN 1 ELSE 0 END), 0) AS upcoming
         FROM events ${where}`,
        ...params
    );
    const all = Number(row.all_count);
    const upcoming = Number(row.upcoming);
    return {upcoming, past: all - upcoming, all};
}

/**
 * The event check-in should open on: today's (earliest kickoff), else the next upcoming
 * one, else the most recent past one. Cancelled events are skipped; null when none exist.
 */
async function findNearest(date) {
    const next = await db.get(
        `SELECT * FROM events WHERE event_date >= ? AND cancelled = 0
         ORDER BY event_date ASC, kickoff_at ASC, id ASC LIMIT 1`,
        date
    );
    if (next) return next;
    const last = await db.get(
        `SELECT * FROM events WHERE event_date < ? AND cancelled = 0
         ORDER BY event_date DESC, kickoff_at DESC, id DESC LIMIT 1`,
        date
    );
    return last || null;
}

/** Events on one local date, earliest kickoff first. Cancelled events are left out. */
async function listOnDate(date) {
    return db.all(
        'SELECT * FROM events WHERE event_date = ? AND cancelled = 0 ORDER BY kickoff_at ASC, id ASC',
        date
    );
}

/** Candidates for the check-in event picker: events not cancelled within `days` of `date`. */
async function listAround(date, days = 7) {
    const d = new Date(`${date}T12:00:00Z`);
    const from = new Date(d.getTime() - days * 86400000).toISOString().slice(0, 10);
    const to = new Date(d.getTime() + days * 86400000).toISOString().slice(0, 10);
    return db.all(
        `SELECT * FROM events WHERE event_date >= ? AND event_date <= ? AND cancelled = 0
         ORDER BY event_date ASC, kickoff_at ASC, id ASC`,
        from, to
    );
}

async function create(fields) {
    const actor = getActor();
    const values = FIELDS.map(f => fields[f] ?? (f === 'cancelled' ? 0 : null));
    const result = await db.run(
        `INSERT INTO events (${FIELDS.join(', ')}, source, external_id, created_by, updated_by)
         VALUES (${FIELDS.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
        ...values, fields.source || 'manual', fields.external_id || null, actor.id || null, actor.id || null
    );
    const row = await get(result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'events',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return row;
}

/** Updates only the fields present in `changes`; source and external_id never change. */
async function update(id, changes) {
    const actor = getActor();
    const old = await get(id);
    if (!old) return null;
    const keys = FIELDS.filter(f => Object.prototype.hasOwnProperty.call(changes, f));
    if (!keys.length) return old;
    await db.run(
        `UPDATE events SET ${keys.map(k => `${k}=?`).join(', ')}, updated_at=datetime('now'), updated_by=? WHERE id=?`,
        ...keys.map(k => changes[k] ?? null), actor.id || null, id
    );
    const row = await get(id);
    await auditLog.insert({
        tableName: 'events',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return row;
}

module.exports = {
    EVENT_VIEWS, get, findByExternalId, list, countByView, findNearest, listOnDate, listAround, create, update,
};
