const db = require('../database');

async function create({title, description, closes_at}) {
    const result = await db.run(
        'INSERT INTO votes (title, description, closes_at) VALUES (?, ?, ?)',
        title, description || null, closes_at || null
    );
    return await db.get('SELECT * FROM votes WHERE id = ?', result.lastInsertRowid);
}

async function createOptions(voteId, labels) {
    for (let i = 0; i < labels.length; i++) {
        await db.run(
            'INSERT INTO vote_options (vote_id, label, display_order) VALUES (?, ?, ?)',
            voteId, labels[i], i
        );
    }
}

async function findById(id) {
    return await db.get('SELECT * FROM votes WHERE id = ?', id);
}

async function listAll() {
    return await db.all('SELECT * FROM votes ORDER BY created_at DESC');
}

async function listOpen() {
    return await db.all("SELECT * FROM votes WHERE status = 'open' ORDER BY created_at DESC");
}

async function close(id) {
    return await db.run("UPDATE votes SET status = 'closed' WHERE id = ?", id);
}

async function getOptions(voteId) {
    return await db.all(
        'SELECT * FROM vote_options WHERE vote_id = ? ORDER BY display_order ASC',
        voteId
    );
}

async function getResponse(voteId, memberId) {
    return await db.get(
        `SELECT vr.*, vo.label
     FROM vote_responses vr
     JOIN vote_options vo ON vr.option_id = vo.id
     WHERE vr.vote_id = ? AND vr.member_id = ?`,
        voteId, memberId
    );
}

async function castVote(voteId, memberId, optionId) {
    return await db.run(
        'INSERT OR IGNORE INTO vote_responses (vote_id, member_id, option_id) VALUES (?, ?, ?)',
        voteId, memberId, optionId
    );
}

async function getResults(voteId) {
    return await db.all(
        `SELECT vo.id, vo.label, COUNT(vr.id) as count
     FROM vote_options vo
     LEFT JOIN vote_responses vr ON vr.option_id = vo.id
     WHERE vo.vote_id = ?
     GROUP BY vo.id, vo.label
     ORDER BY vo.display_order ASC`,
        voteId
    );
}

async function getTotalVotes(voteId) {
    const row = await db.get(
        'SELECT COUNT(*) as c FROM vote_responses WHERE vote_id = ?',
        voteId
    );
    return row ? row.c : 0;
}

module.exports = {
    create,
    createOptions,
    findById,
    listAll,
    listOpen,
    close,
    getOptions,
    getResponse,
    castVote,
    getResults,
    getTotalVotes,
};
