const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

async function list() {
    return db.all('SELECT * FROM membership_periods ORDER BY start_date DESC');
}

async function get(id) {
    return db.get('SELECT * FROM membership_periods WHERE id = ?', id);
}

async function create({
                          label,
                          start_date,
                          end_date,
                          individual_dues_cents,
                          family_dues_cents,
                          electronic_surcharge_cents = 0
                      }) {
    const actor = getActor();
    const result = await db.run(
        `INSERT INTO membership_periods (label, start_date, end_date, individual_dues_cents, family_dues_cents, electronic_surcharge_cents, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        label, start_date, end_date, individual_dues_cents, family_dues_cents, electronic_surcharge_cents,
        actor.id || null, actor.id || null
    );
    const row = await db.get('SELECT * FROM membership_periods WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'membership_periods',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return row;
}

async function update(id, {
    label,
    start_date,
    end_date,
    individual_dues_cents,
    family_dues_cents,
    electronic_surcharge_cents = 0
}) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM membership_periods WHERE id = ?', id);
    await db.run(
        `UPDATE membership_periods SET label=?, start_date=?, end_date=?, individual_dues_cents=?, family_dues_cents=?, electronic_surcharge_cents=?, updated_at=datetime('now'), updated_by=? WHERE id=?`,
        label, start_date, end_date, individual_dues_cents, family_dues_cents, electronic_surcharge_cents, actor.id || null, id
    );
    const row = await db.get('SELECT * FROM membership_periods WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'membership_periods',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return row;
}

async function getCurrent(asOf = new Date().toISOString().slice(0, 10)) {
    const row = await db.get(
        `SELECT * FROM membership_periods
     WHERE start_date <= ? AND end_date >= ?
     ORDER BY start_date DESC
     LIMIT 1`,
        asOf, asOf
    );
    return row || null;
}

module.exports = {list, get, create, update, getCurrent};
