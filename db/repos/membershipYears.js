const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

async function enroll(memberId, periodId, paymentId) {
    const actor = getActor();
    const existing = await db.get(
        'SELECT * FROM membership_years WHERE member_id = ? AND membership_period_id = ?',
        memberId, periodId
    );
    if (existing) return existing;

    const result = await db.run(
        `INSERT INTO membership_years (member_id, membership_period_id, payment_id, created_by)
     VALUES (?, ?, ?, ?)`,
        memberId, periodId, paymentId || null, actor.id || null
    );
    const row = await db.get('SELECT * FROM membership_years WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'membership_years',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return row;
}

async function isEnrolled(memberId, periodId) {
    const row = await db.get(
        'SELECT id FROM membership_years WHERE member_id = ? AND membership_period_id = ?',
        memberId, periodId
    );
    return !!row;
}

async function findByMember(memberId) {
    return db.all(
        `SELECT my.*, mp.label, mp.start_date, mp.end_date,
                p.amount_cents, p.status AS payment_status, p.payment_method,
                p.created_at AS payment_date
         FROM membership_years my
         JOIN membership_periods mp ON mp.id = my.membership_period_id
         LEFT JOIN payments p ON p.id = my.payment_id
         WHERE my.member_id = ?
         ORDER BY mp.start_date DESC`,
        memberId
    );
}

async function findByPeriod(periodId) {
    return db.all(
        'SELECT my.*, m.first_name, m.last_name, m.email FROM membership_years my JOIN members m ON m.id = my.member_id WHERE my.membership_period_id = ? ORDER BY m.last_name ASC, m.first_name ASC',
        periodId
    );
}

module.exports = {enroll, isEnrolled, findByMember, findByPeriod};
