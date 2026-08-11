const db = require('../database');
const {getActor} = require('../audit-context');
const auditLog = require('./auditLog');

async function create({name, email, message, campaign_id = null, email_status = 'sent'}) {
    const actor = getActor();
    const result = await db.run(
        `INSERT INTO contact_submissions (name, email, message, campaign_id, email_status)
         VALUES (?, ?, ?, ?, ?)`,
        name, email, message, campaign_id, email_status
    );
    const row = await db.get('SELECT * FROM contact_submissions WHERE id = ?', result.lastInsertRowid);
    await auditLog.insert({
        tableName: 'contact_submissions',
        recordId: result.lastInsertRowid,
        action: 'INSERT',
        actor,
        oldValues: null,
        newValues: row
    });
    return row;
}

async function list({limit = 50, offset = 0} = {}) {
    return db.all(`
        SELECT s.*, c.name AS campaign_name, c.utm_campaign
        FROM contact_submissions s
                 LEFT JOIN campaigns c ON c.id = s.campaign_id
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT ? OFFSET ?
    `, limit, offset);
}

async function count() {
    const row = await db.get('SELECT COUNT(*) AS c FROM contact_submissions');
    return row ? Number(row.c) : 0;
}

async function listByCampaign(campaignId, limit = 25) {
    return db.all(
        `SELECT * FROM contact_submissions WHERE campaign_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
        campaignId, limit
    );
}

module.exports = {create, list, count, listByCampaign};
