jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const {insertAdmin, insertPeriod} = require('../helpers/fixtures');

const mockHandlers = {};
jest.mock('express', () => {
    const realExpress = jest.requireActual('express');
    const fakeRouter = {
        get(path, ...fns) {
            mockHandlers['GET ' + path] = fns[fns.length - 1];
        },
        post(path, ...fns) {
            mockHandlers['POST ' + path] = fns[fns.length - 1];
        },
        use() {
        },
    };
    return {...realExpress, Router: () => fakeRouter};
});

jest.mock('../../services/storage', () => ({isConfigured: () => false, uploadFile: jest.fn()}));

function mockReq(overrides = {}) {
    return {body: {}, params: {}, session: {}, get: () => null, ...overrides};
}

function mockRes() {
    const res = {
        _redirectUrl: null, redirect(url) {
            res._redirectUrl = url;
        }, render: jest.fn()
    };
    return res;
}

beforeEach(() => {
    db.__resetTestDb();
    Object.keys(mockHandlers).forEach(k => delete mockHandlers[k]);
    jest.isolateModules(() => {
        require('../../routes/admin');
    });
});

describe('GET /periods', () => {
    test('renders list with periods', async () => {
        insertAdmin(db);
        insertPeriod(db, {label: 'Test Period'});
        const req = mockReq({session: {adminId: 1, adminRole: 'super_admin'}});
        const res = mockRes();
        await mockHandlers['GET /periods'](req, res);
        expect(res.render).toHaveBeenCalledWith('admin/periods/list', expect.objectContaining({periods: expect.any(Array)}));
        expect(res.render.mock.calls[0][1].periods[0].label).toBe('Test Period');
    });
});

describe('GET /periods/new', () => {
    test('renders form with null period', async () => {
        const req = mockReq({session: {adminId: 1, adminRole: 'super_admin'}});
        const res = mockRes();
        await mockHandlers['GET /periods/new'](req, res);
        expect(res.render).toHaveBeenCalledWith('admin/periods/form', expect.objectContaining({period: null}));
    });
});

describe('POST /periods', () => {
    const validBody = {
        label: '2026-27 Season',
        start_date: '2026-04-01',
        end_date: '2027-07-31',
        individual_dues: '16.00',
        family_dues: '26.00',
        electronic_surcharge: '1.50',
    };

    test('creates a period and redirects to /admin/periods', async () => {
        const req = mockReq({body: validBody, session: {adminId: 1, adminRole: 'super_admin'}});
        const res = mockRes();
        await mockHandlers['POST /periods'](req, res);
        expect(res._redirectUrl).toBe('/admin/periods');
        const rows = db.__getCurrentDb().prepare('SELECT * FROM membership_periods').all();
        expect(rows.length).toBe(1);
        expect(rows[0].label).toBe('2026-27 Season');
        expect(rows[0].electronic_surcharge_cents).toBe(150);
    });

    test('flashes error and redirects back on validation failure', async () => {
        const req = mockReq({
            body: {...validBody, end_date: '2025-01-01'}, // end before start
            session: {adminId: 1, adminRole: 'super_admin'},
        });
        const res = mockRes();
        await mockHandlers['POST /periods'](req, res);
        expect(req.session.flash_error).toBeTruthy();
        expect(res._redirectUrl).toBe('/admin/periods/new');
    });

    test('allows overlapping date ranges', async () => {
        insertPeriod(db, {start_date: '2025-04-01', end_date: '2026-07-31'});
        const req = mockReq({
            body: {...validBody, start_date: '2026-04-01', end_date: '2027-07-31'},
            session: {adminId: 1, adminRole: 'super_admin'},
        });
        const res = mockRes();
        await mockHandlers['POST /periods'](req, res);
        expect(res._redirectUrl).toBe('/admin/periods');
        const rows = db.__getCurrentDb().prepare('SELECT * FROM membership_periods').all();
        expect(rows.length).toBe(2);
    });
});

describe('GET /periods/:id/edit', () => {
    test('renders form with existing period', async () => {
        const p = insertPeriod(db, {label: 'Edit Me'});
        const req = mockReq({params: {id: String(p.id)}, session: {adminId: 1, adminRole: 'super_admin'}});
        const res = mockRes();
        await mockHandlers['GET /periods/:id/edit'](req, res);
        expect(res.render).toHaveBeenCalledWith('admin/periods/form', expect.objectContaining({
            period: expect.objectContaining({label: 'Edit Me'}),
        }));
    });

    test('redirects with error when period not found', async () => {
        const req = mockReq({params: {id: '999'}, session: {adminId: 1, adminRole: 'super_admin'}});
        const res = mockRes();
        await mockHandlers['GET /periods/:id/edit'](req, res);
        expect(res._redirectUrl).toBe('/admin/periods');
        expect(req.session.flash_error).toBeTruthy();
    });
});

describe('POST /periods/:id/edit', () => {
    test('updates period and redirects to /admin/periods', async () => {
        const p = insertPeriod(db, {label: 'Original'});
        const req = mockReq({
            params: {id: String(p.id)},
            body: {
                label: 'Updated',
                start_date: '2026-04-01',
                end_date: '2027-07-31',
                individual_dues: '20.00',
                family_dues: '30.00',
                electronic_surcharge: '2.00'
            },
            session: {adminId: 1, adminRole: 'super_admin'},
        });
        const res = mockRes();
        await mockHandlers['POST /periods/:id/edit'](req, res);
        expect(res._redirectUrl).toBe('/admin/periods');
        const updated = db.__getCurrentDb().prepare('SELECT * FROM membership_periods WHERE id = ?').get(p.id);
        expect(updated.label).toBe('Updated');
        expect(updated.individual_dues_cents).toBe(2000);
    });

    test('flashes error on validation failure', async () => {
        const p = insertPeriod(db);
        const req = mockReq({
            params: {id: String(p.id)},
            body: {
                label: 'Bad',
                start_date: '2027-01-01',
                end_date: '2026-01-01',
                individual_dues: '16',
                family_dues: '26',
                electronic_surcharge: '0'
            },
            session: {adminId: 1, adminRole: 'super_admin'},
        });
        const res = mockRes();
        await mockHandlers['POST /periods/:id/edit'](req, res);
        expect(req.session.flash_error).toBeTruthy();
        expect(res._redirectUrl).toContain('/edit');
    });
});
