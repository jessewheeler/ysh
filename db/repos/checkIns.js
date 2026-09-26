const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

async function find(eventId, memberId) {
    return db.get('SELECT * FROM check_ins WHERE event_id = ? AND member_id = ?', eventId, memberId);
}

/**
 * Record one person as present at an event. Idempotent on (event, member): a second call
 * updates the ticket count rather than adding a row, so a refresh or a double scan cannot
 * check someone in twice. The UPDATE is skipped entirely when nothing changed, to keep
 * re-submits of an unchanged household out of the audit log.
 */
async function upsert({eventId, memberId, tickets, enrolled}) {
    const actor = getActor();
    const old = await find(eventId, memberId);
    if (old) {
        if (Number(old.tickets_issued) === tickets) return old;
        await db.run(
            `UPDATE check_ins SET tickets_issued=?, updated_at=datetime('now'), updated_by=? WHERE id=?`,
            tickets, actor.id || null, old.id
        );
        const row = await find(eventId, memberId);
        await auditLog.insert({
            tableName: 'check_ins', recordId: old.id, action: 'UPDATE', actor, oldValues: old, newValues: row
        });
        return row;
    }
    const result = await db.run(
        `INSERT INTO check_ins (event_id, member_id, tickets_issued, enrolled_at_check_in, checked_in_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        eventId, memberId, tickets, enrolled ? 1 : 0, actor.id || null, actor.id || null
    );
    const row = await db.get('SELECT * FROM check_ins WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'check_ins', recordId: result.lastInsertRowid, action: 'INSERT', actor, oldValues: null, newValues: row
    });
    return row;
}

/** Undo a check-in (staff unticked someone). Returns true when a row was removed. */
async function remove(eventId, memberId) {
    const actor = getActor();
    const doomed = await find(eventId, memberId);
    if (!doomed) return false;
    await db.run('DELETE FROM check_ins WHERE id = ?', doomed.id);
    await auditLog.insert({
        tableName: 'check_ins', recordId: doomed.id, action: 'DELETE', actor, oldValues: doomed, newValues: null
    });
    return true;
}

/** Existing check-ins for these members at this event, keyed by member id. */
async function findForMembers(eventId, memberIds) {
    if (!memberIds.length) return new Map();
    const rows = await db.all(
        `SELECT c.*, a.first_name AS checked_in_by_first, a.last_name AS checked_in_by_last, a.email AS checked_in_by_email
         FROM check_ins c
         LEFT JOIN members a ON a.id = c.checked_in_by
         WHERE c.event_id = ? AND c.member_id IN (${memberIds.map(() => '?').join(', ')})`,
        eventId, ...memberIds
    );
    return new Map(rows.map(r => [Number(r.member_id), r]));
}

/** Everyone checked in to an event, for the attendance page and CSV. */
async function listByEvent(eventId) {
    return db.all(
        `SELECT c.*, m.member_number, m.first_name, m.last_name, m.email, m.primary_member_id,
                p.first_name AS primary_first_name, p.last_name AS primary_last_name,
                a.email AS checked_in_by_email
         FROM check_ins c
         JOIN members m ON m.id = c.member_id
         LEFT JOIN members p ON p.id = m.primary_member_id
         LEFT JOIN members a ON a.id = c.checked_in_by
         WHERE c.event_id = ?
         ORDER BY LOWER(m.last_name) ASC, LOWER(m.first_name) ASC, m.id ASC`,
        eventId
    );
}

/**
 * Season raffle entries: one row per member with at least one ticket across the season's
 * events, for the end-of-year drawing. Cancelled events still count — tickets handed out
 * at the door were handed out.
 */
async function raffleEntries(periodId) {
    const rows = await db.all(
        `SELECT m.id AS member_id, m.member_number, m.first_name, m.last_name, m.email,
                p.first_name AS primary_first_name, p.last_name AS primary_last_name,
                SUM(c.tickets_issued) AS tickets,
                COUNT(*) AS events_attended
         FROM check_ins c
         JOIN events e ON e.id = c.event_id
         JOIN members m ON m.id = c.member_id
         LEFT JOIN members p ON p.id = m.primary_member_id
         WHERE e.membership_period_id = ?
         GROUP BY m.id, m.member_number, m.first_name, m.last_name, m.email, p.first_name, p.last_name
         HAVING SUM(c.tickets_issued) > 0
         ORDER BY LOWER(m.last_name) ASC, LOWER(m.first_name) ASC, m.id ASC`,
        periodId
    );
    return rows.map(r => ({...r, tickets: Number(r.tickets), events_attended: Number(r.events_attended)}));
}

module.exports = {find, upsert, remove, findForMembers, listByEvent, raffleEntries};
