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

/**
 * Full member rows for everyone in a period, for the Central Council membership report.
 *
 * The Council requires each person listed separately, so family sub-members get their own
 * row. Signup enrolls them individually, but older backfills only enrolled primaries —
 * hence "enrolled, or their primary is enrolled". Their address and phone fall back to
 * the primary's, since "see above" is not allowed on the report; their email does not,
 * because two identical emails would let the Council collapse a family into one person.
 */
async function listMembersByPeriod(periodId) {
    return db.all(
        `SELECT m.*,
                COALESCE(NULLIF(m.address_street, ''), p.address_street) AS report_street,
                COALESCE(NULLIF(m.address_city, ''), p.address_city)     AS report_city,
                COALESCE(NULLIF(m.address_state, ''), p.address_state)   AS report_state,
                COALESCE(NULLIF(m.address_zip, ''), p.address_zip)       AS report_zip,
                COALESCE(NULLIF(m.phone, ''), p.phone)                   AS report_phone
         FROM members m
         LEFT JOIN members p ON p.id = m.primary_member_id
         WHERE (m.id IN (SELECT member_id FROM membership_years WHERE membership_period_id = ?)
                OR m.primary_member_id IN (SELECT member_id FROM membership_years WHERE membership_period_id = ?))
           AND m.status <> 'cancelled'
         ORDER BY LOWER(COALESCE(m.last_name, '')) ASC,
                  LOWER(COALESCE(m.first_name, '')) ASC,
                  m.id ASC`,
        periodId, periodId
    );
}

async function countByPeriod(periodId) {
    const row = await db.get('SELECT COUNT(*) as c FROM membership_years WHERE membership_period_id = ?', periodId);
    return row ? row.c : 0;
}

module.exports = {enroll, isEnrolled, findByMember, findByPeriod, listMembersByPeriod, countByPeriod};
