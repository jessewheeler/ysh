const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

// member_numbers and enrolled_period_ids are stored as JSON text so the table works the
// same in both dialects; callers only ever see arrays.
function hydrate(row) {
    if (!row) return row;
    return {
        ...row,
        member_numbers: parseList(row.member_numbers),
        enrolled_period_ids: parseList(row.enrolled_period_ids),
    };
}

function parseList(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
        return [];
    }
}

async function findById(id) {
    return hydrate(await db.get('SELECT * FROM archived_members WHERE id = ?', id));
}

async function insert({firstName, lastName, joinDate, memberNumbers = [], enrolledPeriodIds = [], formerMemberId, formerPrimaryMemberId}) {
    const actor = getActor();
    const result = await db.run(
        `INSERT INTO archived_members (first_name, last_name, join_date, member_numbers, enrolled_period_ids,
                                       former_member_id, former_primary_member_id, archived_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        firstName, lastName, joinDate || null, JSON.stringify(memberNumbers), JSON.stringify(enrolledPeriodIds),
        formerMemberId || null, formerPrimaryMemberId || null, new Date().toISOString(),
        actor.id || null, actor.id || null
    );
    const row = await db.get('SELECT * FROM archived_members WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'archived_members',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return hydrate(row);
}

// Unrestored people only. lastName matches as a prefix of the last name (the add-family
// suggestions); q matches as a prefix of either name (the archive page's search box).
async function search({q, lastName, limit = 100} = {}) {
    const conditions = ['restored_at IS NULL'];
    const params = [];
    if (lastName) {
        conditions.push('LOWER(last_name) LIKE ?');
        params.push(`${lastName.trim().toLowerCase()}%`);
    }
    if (q) {
        conditions.push('(LOWER(last_name) LIKE ? OR LOWER(first_name) LIKE ?)');
        const term = `${q.trim().toLowerCase()}%`;
        params.push(term, term);
    }
    const rows = await db.all(
        `SELECT * FROM archived_members WHERE ${conditions.join(' AND ')}
         ORDER BY LOWER(last_name) ASC, LOWER(first_name) ASC, id ASC LIMIT ?`,
        ...params, limit
    );
    return rows.map(hydrate);
}

async function markRestored(id, memberId) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM archived_members WHERE id = ?', id);
    const now = new Date().toISOString();
    await db.run(
        'UPDATE archived_members SET restored_at = ?, restored_member_id = ?, updated_at = ?, updated_by = ? WHERE id = ?',
        now, memberId, now, actor.id || null, id
    );
    const row = await db.get('SELECT * FROM archived_members WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'archived_members',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return hydrate(row);
}

// The archive row a live member was restored from, if any — so archiving the same person a
// second time carries their earlier member numbers and original join date forward.
async function findRestoredAs(memberId) {
    return hydrate(await db.get(
        'SELECT * FROM archived_members WHERE restored_member_id = ? ORDER BY id DESC LIMIT 1',
        memberId
    ));
}

module.exports = {findById, insert, search, markRestored, findRestoredAs};
