const db = require('../database');

/**
 * Campaign visits are high-volume system writes with no actor, so — like setOtp and
 * setRenewalToken — they deliberately do not write audit_log entries.
 */
async function record({campaignId, landingPath = null, referrer = null, utmSource = null, utmMedium = null, utmContent = null}) {
    const result = await db.run(
        `INSERT INTO campaign_visits (campaign_id, landing_path, referrer, utm_source, utm_medium, utm_content)
         VALUES (?, ?, ?, ?, ?, ?)`,
        campaignId, landingPath, referrer, utmSource, utmMedium, utmContent
    );
    return result.lastInsertRowid;
}

async function listRecent(campaignId, limit = 25) {
    return db.all(
        `SELECT * FROM campaign_visits WHERE campaign_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
        campaignId, limit
    );
}

async function countFor(campaignId) {
    const row = await db.get('SELECT COUNT(*) AS c FROM campaign_visits WHERE campaign_id = ?', campaignId);
    return row ? Number(row.c) : 0;
}

module.exports = {record, listRecent, countFor};
