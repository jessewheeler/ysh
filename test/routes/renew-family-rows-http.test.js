/**
 * Renders the renewal page for real, through the Pug template, rather than asserting on a
 * mocked res.render. The existing renewal tests stub rendering, so a template change there
 * goes unchecked — and this page builds the same family-member rows as the signup form.
 */
process.env.NODE_ENV = 'test';

jest.mock('../../db/database', () => require('../helpers/setupDb'));

const request = require('supertest');
const app = require('../../server');
const db = require('../../db/database');
const membersRepo = require('../../db/repos/members');
const {insertMember, insertPeriod, insertSetting} = require('../helpers/fixtures');

const TOKEN = 'a'.repeat(64);

async function seedFamilyRenewal() {
    insertPeriod(db, {start_date: '2025-01-01', end_date: '2099-12-31'});
    insertSetting(db, 'max_family_members', '6');

    const primary = insertMember(db, {
        first_name: 'Pat',
        last_name: 'Wheeler',
        email: 'primary-renew@example.com',
        status: 'active',
        membership_type: 'family',
    });
    insertMember(db, {
        first_name: 'Sam',
        last_name: 'Wheeler',
        email: 'sam-renew@example.com',
        membership_type: 'family',
        primary_member_id: primary.id,
    });

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await membersRepo.setRenewalToken(primary.id, TOKEN, expiresAt);
    return primary;
}

describe('GET /renew/:token — family member rows', () => {
    beforeEach(() => db.__resetTestDb());

    test('renders the page and its existing family rows', async () => {
        await seedFamilyRenewal();
        const res = await request(app).get(`/renew/${TOKEN}`);

        expect(res.status).toBe(200);
        expect(res.text).toContain('family-member-row');
        expect(res.text).toContain('Family member 1');
        expect(res.text).toContain('family_members[0][first_name]');
    });

    test('keeps each member\'s fields inside their own row', async () => {
        // Indentation is structure in Pug, and a reformat once pushed the hidden id and
        // the three field groups out to siblings of .family-member-row, so each member's
        // fields rendered outside the bordered row they belong to. Parsed rather than
        // string-matched on purpose: a substring search between the row and the add
        // button still contains sibling fields, so it passes on exactly this bug.
        await seedFamilyRenewal();
        const res = await request(app).get(`/renew/${TOKEN}`);

        const { JSDOM } = require('jsdom');
        const { document } = new JSDOM(res.text).window;

        const rows = document.querySelectorAll('.family-member-row');
        expect(rows).toHaveLength(1);

        const row = rows[0];
        expect(row.querySelector('.family-member-head')).not.toBeNull();
        ['id', 'first_name', 'last_name', 'email'].forEach(field => {
            expect(row.querySelector(`[name="family_members[0][${field}]"]`)).not.toBeNull();
        });
        // And nothing belonging to a member sits loose in the container.
        const container = document.getElementById('family-members-container');
        [...container.querySelectorAll('[name^="family_members"]')].forEach(input => {
            expect(input.closest('.family-member-row')).not.toBeNull();
        });
    });

    test('every family field label points at its input', async () => {
        // A bare label with no `for` doesn't focus its input when tapped.
        await seedFamilyRenewal();
        const res = await request(app).get(`/renew/${TOKEN}`);

        ['first_name', 'last_name', 'email'].forEach(field => {
            const id = `renew-family-0-${field}`;
            expect(res.text).toContain(`for="${id}"`);
            expect(res.text).toContain(`id="${id}"`);
        });
    });

    test('carries no inline styling for the row or its remove button', async () => {
        // These were a 200-character inline cssText apiece, including a red that appears
        // nowhere else in the palette.
        await seedFamilyRenewal();
        const res = await request(app).get(`/renew/${TOKEN}`);

        expect(res.text).not.toContain('#dc3545');
        expect(res.text).toContain('class="btn-remove remove-family-member"');
        const rowMarkup = res.text.slice(
            res.text.indexOf('family-member-row'),
            res.text.indexOf('family_members[0][email]')
        );
        expect(rowMarkup).not.toContain('style=');
    });
});
