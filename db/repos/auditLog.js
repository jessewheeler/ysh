const db = require('../database');

// Fields to strip from old/new value snapshots (sensitive secrets, hashes)
const OMIT_FIELDS = {
    members: ['otp_hash', 'renewal_token'],
};

function sanitize(tableName, row) {
    if (!row) return null;
    const omit = OMIT_FIELDS[tableName];
    if (!omit || omit.length === 0) return row;
    const out = {...row};
    for (const f of omit) delete out[f];
    return out;
}

async function insert({tableName, recordId, action, actor, oldValues, newValues}) {
    try {
        await db.run(
            `INSERT INTO audit_log (table_name, record_id, action, actor_id, actor_email, old_values, new_values)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            tableName,
            String(recordId),
            action,
            actor.id || null,
            actor.email || null,
            oldValues ? JSON.stringify(sanitize(tableName, oldValues)) : null,
            newValues ? JSON.stringify(sanitize(tableName, newValues)) : null
        );
    } catch (err) {
        // Audit failures must never break the main operation
        const logger = require('../../services/logger');
        logger.error('Audit log insert failed', {error: err.message, tableName, recordId, action});
    }
}

async function list({limit = 50, offset = 0, tableName, actorId} = {}) {
    const conditions = [];
    const params = [];
    if (tableName) {
        conditions.push('table_name = ?');
        params.push(tableName);
    }
    if (actorId) {
        conditions.push('actor_id = ?');
        params.push(actorId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = await db.get(`SELECT COUNT(*) as c FROM audit_log ${where}`, ...params);
    const rows = await db.all(
        `SELECT * FROM audit_log ${where} ORDER BY changed_at DESC LIMIT ? OFFSET ?`,
        ...params, limit, offset
    );
    return {rows, total: totalRow?.c || 0};
}

module.exports = {insert, list};
