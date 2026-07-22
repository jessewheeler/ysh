jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { insertAdmin, insertMember, insertPeriod, enrollMember } = require('../helpers/fixtures');

const mockHandlers = {};
jest.mock('express', () => {
  const realExpress = jest.requireActual('express');
  const fakeRouter = {
    get(path, ...fns) { mockHandlers['GET ' + path] = fns[fns.length - 1]; },
    post(path, ...fns) { mockHandlers['POST ' + path] = fns[fns.length - 1]; },
    use() {},
  };
  return { ...realExpress, Router: () => fakeRouter };
});

jest.mock('../../services/storage', () => ({ isConfigured: () => false, uploadFile: jest.fn() }));

function mockReq(overrides = {}) {
  return { body: {}, params: {}, session: {}, get: () => null, ...overrides };
}

function mockRes() {
  const res = { _redirectUrl: null, redirect(url) { res._redirectUrl = url; }, render: jest.fn() };
  return res;
}

beforeEach(() => {
  db.__resetTestDb();
  Object.keys(mockHandlers).forEach(k => delete mockHandlers[k]);
  jest.isolateModules(() => { require('../../routes/admin'); });
});

describe('GET /members (views, sorting, filters)', () => {
  test('view=pending renders only pending members with pill counts', async () => {
    insertMember(db, { email: 'p@t.com', status: 'pending' });
    insertMember(db, { email: 'a@t.com', status: 'active' });

    const req = mockReq({ query: { view: 'pending' } });
    const res = mockRes();
    await mockHandlers['GET /members'](req, res);

    expect(res.render).toHaveBeenCalledWith('admin/members/list', expect.objectContaining({
      view: 'pending',
      counts: expect.objectContaining({ all: 2, pending: 1 }),
    }));
    const locals = res.render.mock.calls[0][1];
    expect(locals.members.map(m => m.email)).toEqual(['p@t.com']);
  });

  test('invalid view, sort, and dir are sanitized to defaults', async () => {
    insertMember(db, { email: 'a@t.com' });

    const req = mockReq({ query: { view: 'nonsense', sort: 'evil', dir: 'up' } });
    const res = mockRes();
    await mockHandlers['GET /members'](req, res);

    const locals = res.render.mock.calls[0][1];
    expect(locals.view).toBe('all');
    expect(locals.sort).toBe('created_at');
    expect(locals.dir).toBe('desc');
    expect(locals.members).toHaveLength(1);
  });

  test('period param filters to enrolled members', async () => {
    const period = insertPeriod(db);
    const enrolled = insertMember(db, { email: 'in@t.com', status: 'active' });
    enrollMember(db, enrolled.id, period.id);
    insertMember(db, { email: 'out@t.com', status: 'active' });

    const req = mockReq({ query: { period: String(period.id) } });
    const res = mockRes();
    await mockHandlers['GET /members'](req, res);

    const locals = res.render.mock.calls[0][1];
    expect(locals.members.map(m => m.email)).toEqual(['in@t.com']);
    expect(locals.periods.map(p => p.id)).toContain(period.id);
  });

  test('qs helper preserves state and omits defaults', async () => {
    insertMember(db, { email: 'a@t.com' });

    const req = mockReq({ query: { view: 'lifetime', sort: 'name', dir: 'asc' } });
    const res = mockRes();
    await mockHandlers['GET /members'](req, res);

    const { qs } = res.render.mock.calls[0][1];
    expect(qs({})).toBe('?view=lifetime&sort=name&dir=asc');
    expect(qs({ view: 'all' })).toBe('?sort=name&dir=asc');
    expect(qs({ page: 2 })).toBe('?view=lifetime&sort=name&dir=asc&page=2');
  });

  test('clear-filters override drops search/status/period but keeps view and sort', async () => {
    const period = insertPeriod(db);
    insertMember(db, { email: 'a@t.com' });

    const req = mockReq({ query: { view: 'active', sort: 'name', dir: 'asc', search: 'smith', status: 'active', period: String(period.id) } });
    const res = mockRes();
    await mockHandlers['GET /members'](req, res);

    const { qs } = res.render.mock.calls[0][1];
    expect(qs({ search: '', status: '', period: '', page: 1 })).toBe('?view=active&sort=name&dir=asc');
  });
});

describe('GET /members/export (filter-aware)', () => {
  function mockCsvRes() {
    const res = { headers: {}, body: null, setHeader(k, v) { res.headers[k] = v; }, send(b) { res.body = b; } };
    return res;
  }

  test('honors view and search params', async () => {
    insertMember(db, { email: 'life@t.com', first_name: 'Lila', status: 'active', is_lifetime: 1 });
    insertMember(db, { email: 'reg@t.com', first_name: 'Reggie', status: 'active' });

    const req = mockReq({ query: { view: 'lifetime' } });
    const res = mockCsvRes();
    await mockHandlers['GET /members/export'](req, res);

    expect(res.body).toContain('Lila');
    expect(res.body).not.toContain('Reggie');
    expect(res.headers['Content-Disposition']).toContain('ysh-members-lifetime-');
  });

  test('exports everyone when no params (backward compat)', async () => {
    insertMember(db, { email: 'a@t.com', first_name: 'Alice' });
    insertMember(db, { email: 'b@t.com', first_name: 'Bob' });

    const req = mockReq({ query: {} });
    const res = mockCsvRes();
    await mockHandlers['GET /members/export'](req, res);

    expect(res.body).toContain('Alice');
    expect(res.body).toContain('Bob');
    expect(res.headers['Content-Disposition']).toContain('ysh-members-2');
  });
});

describe('POST /members/:id/delete', () => {
  test('blocks an admin from deleting their own record', async () => {
    const admin = insertAdmin(db);
    const req = mockReq({ params: { id: String(admin.id) }, session: { adminId: admin.id, adminRole: 'super_admin' } });
    const res = mockRes();
    await mockHandlers['POST /members/:id/delete'](req, res);
    expect(req.session.flash_error).toMatch(/cannot delete your own account/i);
    expect(res._redirectUrl).toBe(`/admin/members/${admin.id}`);
    const still = db.__getCurrentDb().prepare('SELECT id FROM members WHERE id = ?').get(admin.id);
    expect(still).toBeDefined();
  });

  test('allows deleting another member', async () => {
    const admin = insertAdmin(db);
    const other = insertMember(db, { email: 'other@example.com' });
    const req = mockReq({ params: { id: String(other.id) }, session: { adminId: admin.id, adminRole: 'super_admin' } });
    const res = mockRes();
    await mockHandlers['POST /members/:id/delete'](req, res);
    expect(req.session.flash_error).toBeUndefined();
    expect(res._redirectUrl).toBe('/admin/members');
    const gone = db.__getCurrentDb().prepare('SELECT id FROM members WHERE id = ?').get(other.id);
    expect(gone).toBeUndefined();
  });
});

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
