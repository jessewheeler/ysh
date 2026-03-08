const db = require('../database');

async function create({title, body, event_type, event_date, location, status}) {
    const result = await db.run(
        `INSERT INTO events (title, body, event_type, event_date, location, status) VALUES (?, ?, ?, ?, ?, ?)`,
        title, body || null, event_type, event_date || null, location || null, status || 'draft'
    );
    return await db.get('SELECT * FROM events WHERE id = ?', result.lastInsertRowid);
}

async function update(id, {title, body, event_type, event_date, location, status}) {
    return await db.run(
        `UPDATE events SET title=?, body=?, event_type=?, event_date=?, location=?, status=?, updated_at=datetime('now') WHERE id=?`,
        title, body || null, event_type, event_date || null, location || null, status, id
    );
}

async function findById(id) {
    return await db.get('SELECT * FROM events WHERE id = ?', id);
}

async function listAll() {
    return await db.all(
        'SELECT * FROM events ORDER BY CASE WHEN event_date IS NULL THEN 1 ELSE 0 END, event_date ASC, created_at DESC'
    );
}

async function listPublished() {
    return await db.all(
        "SELECT * FROM events WHERE status = 'published' ORDER BY CASE WHEN event_date IS NULL THEN 1 ELSE 0 END, event_date ASC"
    );
}

async function deleteById(id) {
    return await db.run('DELETE FROM events WHERE id = ?', id);
}

// --- Volunteer roles ---

async function createRole(eventId, {role_name, max_volunteers, display_order}) {
    const result = await db.run(
        'INSERT INTO event_volunteer_roles (event_id, role_name, max_volunteers, display_order) VALUES (?, ?, ?, ?)',
        eventId, role_name, max_volunteers || null, display_order || 0
    );
    return result.lastInsertRowid;
}

async function updateRole(id, {role_name, max_volunteers, display_order}) {
    return await db.run(
        'UPDATE event_volunteer_roles SET role_name=?, max_volunteers=?, display_order=? WHERE id=?',
        role_name, max_volunteers || null, display_order || 0, id
    );
}

async function deleteRole(roleId) {
    return await db.run('DELETE FROM event_volunteer_roles WHERE id = ?', roleId);
}

async function getRoles(eventId) {
    return await db.all(
        'SELECT * FROM event_volunteer_roles WHERE event_id = ? ORDER BY display_order ASC',
        eventId
    );
}

// --- Volunteer signups ---

async function getSignup(eventId, memberId) {
    return await db.get(
        `SELECT vs.*, r.role_name
     FROM volunteer_signups vs
     JOIN event_volunteer_roles r ON vs.role_id = r.id
     WHERE vs.event_id = ? AND vs.member_id = ?`,
        eventId, memberId
    );
}

async function getSignupsByEvent(eventId) {
    return await db.all(
        `SELECT vs.*, m.first_name, m.last_name, m.email, r.role_name, r.display_order as role_order
     FROM volunteer_signups vs
     JOIN members m ON vs.member_id = m.id
     JOIN event_volunteer_roles r ON vs.role_id = r.id
     WHERE vs.event_id = ?
     ORDER BY r.display_order ASC, vs.signed_up_at ASC`,
        eventId
    );
}

async function getSignupCountByRole(roleId) {
    const row = await db.get(
        'SELECT COUNT(*) as c FROM volunteer_signups WHERE role_id = ?',
        roleId
    );
    return row ? row.c : 0;
}

async function createSignup(eventId, roleId, memberId) {
    return await db.run(
        'INSERT OR IGNORE INTO volunteer_signups (event_id, role_id, member_id) VALUES (?, ?, ?)',
        eventId, roleId, memberId
    );
}

async function deleteSignup(eventId, memberId) {
    return await db.run(
        'DELETE FROM volunteer_signups WHERE event_id = ? AND member_id = ?',
        eventId, memberId
    );
}

module.exports = {
    create,
    update,
    findById,
    listAll,
    listPublished,
    deleteById,
    createRole,
    updateRole,
    deleteRole,
    getRoles,
    getSignup,
    getSignupsByEvent,
    getSignupCountByRole,
    createSignup,
    deleteSignup,
};
