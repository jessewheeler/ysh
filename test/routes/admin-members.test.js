const pug = require('pug');
const path = require('path');

const FORM_TEMPLATE = path.resolve(__dirname, '../../views/admin/members/form.pug');

// Fixed-version formatDate that handles Date objects, ISO strings, and SQLite
// space-separated timestamps. This mirrors the expected post-fix behavior of
// middleware/locals.js so that the template test isolates template correctness.
function formatDate(date) {
    if (!date) return '';
    if (date instanceof Date) return date.toISOString().split('T')[0];
    if (typeof date === 'string') return date.split('T')[0].split(' ')[0];
    return '';
}

function renderEditForm(memberOverrides = {}) {
    const member = {
        id: 1,
        first_name: 'Test',
        last_name: 'Member',
        email: 'test@example.com',
        phone: '555-1234',
        address_street: '123 Main St',
        address_city: 'Billings',
        address_state: 'MT',
        address_zip: '59101',
        membership_year: 2026,
        status: 'active',
        notes: null,
        join_date: null,
        ...memberOverrides,
    };
    return pug.renderFile(FORM_TEMPLATE, {
        member,
        formatDate,
        csrfToken: 'test-token',
        flash_success: null,
        flash_error: null,
        currentPath: `/admin/members/${member.id}`,
        isAdmin: true,
        adminRole: 'super_admin',
        site: {},
    });
}

describe('admin member edit form template', () => {
    test('renders without error when join_date is null', () => {
        expect(() => renderEditForm({join_date: null})).not.toThrow();
    });

    test('renders without error when join_date is a plain date string', () => {
        expect(() => renderEditForm({join_date: '2024-01-15'})).not.toThrow();
    });

    test('renders without error when join_date is a SQLite datetime string', () => {
        expect(() => renderEditForm({join_date: '2024-01-15 12:34:56'})).not.toThrow();
    });

    test('renders without error when join_date is a Date object (as returned by PostgreSQL)', () => {
        // This test fails before the fix: form.pug calls join_date.split(' ') which
        // throws TypeError on a Date object, causing a 500 in production (PostgreSQL).
        expect(() => renderEditForm({join_date: new Date('2024-01-15T00:00:00Z')})).not.toThrow();
    });

    test('date input value is YYYY-MM-DD when join_date is a Date object', () => {
        const html = renderEditForm({join_date: new Date('2024-01-15T00:00:00Z')});
        expect(html).toContain('value="2024-01-15"');
    });

    test('date input value is YYYY-MM-DD when join_date is a SQLite datetime string', () => {
        const html = renderEditForm({join_date: '2024-01-15 12:34:56'});
        expect(html).toContain('value="2024-01-15"');
    });

    test('date input is empty when join_date is null', () => {
        const html = renderEditForm({join_date: null});
        expect(html).toContain('name="join_date"');
        expect(html).not.toContain('value="2024');
    });
});
