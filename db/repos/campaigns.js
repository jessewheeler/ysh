const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

async function list() {
    return db.all('SELECT * FROM campaigns ORDER BY created_at DESC, id DESC');
}

/**
 * Every campaign with its attribution counts. Signups count primary members only —
 * family sub-members inherit no campaign, so counting them would double up a family join.
 */
async function listWithStats() {
    return db.all(`
        SELECT c.*,
               (SELECT COUNT(*) FROM campaign_visits v WHERE v.campaign_id = c.id)      AS visit_count,
               (SELECT COUNT(*)
                FROM members m
                WHERE m.campaign_id = c.id
                  AND m.primary_member_id IS NULL)                                      AS signup_count,
               (SELECT COUNT(*) FROM contact_submissions s WHERE s.campaign_id = c.id)  AS contact_count
        FROM campaigns c
        ORDER BY c.created_at DESC, c.id DESC
    `);
}

async function get(id) {
    return db.get('SELECT * FROM campaigns WHERE id = ?', id);
}

/**
 * Resolves an inbound utm_campaign value. Only active campaigns match, so deactivating a
 * campaign stops attribution without breaking links that are already in print.
 */
async function findByUtmCampaign(code) {
    return db.get('SELECT * FROM campaigns WHERE utm_campaign = ? AND is_active = 1', code);
}

async function statsFor(id) {
    const row = await db.get(`
        SELECT (SELECT COUNT(*) FROM campaign_visits v WHERE v.campaign_id = ?)                             AS visit_count,
               (SELECT COUNT(*) FROM members m WHERE m.campaign_id = ? AND m.primary_member_id IS NULL)      AS signup_count,
               (SELECT COUNT(*) FROM contact_submissions s WHERE s.campaign_id = ?)                         AS contact_count
    `, id, id, id);
    return row || {visit_count: 0, signup_count: 0, contact_count: 0};
}

async function listSignups(id) {
    return db.all(`
        SELECT id, member_number, first_name, last_name, email, status, created_at
        FROM members
        WHERE campaign_id = ?
          AND primary_member_id IS NULL
        ORDER BY created_at DESC
    `, id);
}

async function create({
                          name,
                          utm_campaign,
                          utm_source = null,
                          utm_medium = null,
                          utm_content = null,
                          target_path = '/membership',
                          notes = null,
                          is_active = 1
                      }) {
    const actor = getActor();
    const result = await db.run(
        `INSERT INTO campaigns (name, utm_campaign, utm_source, utm_medium, utm_content, target_path, notes,
                                is_active, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        name, utm_campaign, utm_source, utm_medium, utm_content, target_path, notes,
        is_active ? 1 : 0, actor.id || null, actor.id || null
    );
    const row = await db.get('SELECT * FROM campaigns WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'campaigns',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return row;
}

async function update(id, {
    name,
    utm_campaign,
    utm_source = null,
    utm_medium = null,
    utm_content = null,
    target_path = '/membership',
    notes = null
}) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM campaigns WHERE id = ?', id);
    await db.run(
        `UPDATE campaigns
         SET name=?,
             utm_campaign=?,
             utm_source=?,
             utm_medium=?,
             utm_content=?,
             target_path=?,
             notes=?,
             updated_at=datetime('now'),
             updated_by=?
         WHERE id = ?`,
        name, utm_campaign, utm_source, utm_medium, utm_content, target_path, notes,
        actor.id || null, id
    );
    const row = await db.get('SELECT * FROM campaigns WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'campaigns',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return row;
}

async function setActive(id, isActive) {
    const actor = getActor();
    const old = await db.get('SELECT * FROM campaigns WHERE id = ?', id);
    await db.run(
        `UPDATE campaigns SET is_active=?, updated_at=datetime('now'), updated_by=? WHERE id = ?`,
        isActive ? 1 : 0, actor.id || null, id
    );
    const row = await db.get('SELECT * FROM campaigns WHERE id = ?', id);
    await auditLog.insert({
        tableName: 'campaigns',
        recordId: id,
        action: 'UPDATE',
        actor,
        oldValues: old,
        newValues: row
    });
    return row;
}

module.exports = {list, listWithStats, get, findByUtmCampaign, statsFor, listSignups, create, update, setActive};
