jest.mock('../../db/database', () => require('../helpers/setupDb'));

const fs = require('fs');
const path = require('path');
const db = require('../../db/database');
const storage = require('../../services/storage');
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

jest.mock('../../services/storage', () => ({
    isConfigured: jest.fn(() => false),
    uploadFile: jest.fn(),
    deleteFile: jest.fn().mockResolvedValue(undefined),
}));

const mockExecFile = jest.fn((cmd, args, cb) => cb(null, {stdout: '', stderr: ''}));
jest.mock('child_process', () => ({...jest.requireActual('child_process'), execFile: mockExecFile}));

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
    jest.clearAllMocks();
    storage.isConfigured.mockReturnValue(false);
    mockExecFile.mockImplementation((cmd, args, cb) => cb(null, {stdout: '', stderr: ''}));
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

// Templates used to be written into public/img/, which the deploy checkout replaces —
// so every release silently reverted the card to the committed default (issue #96).
describe('card template upload', () => {
    const B2_URL = 'https://f002.backblazeb2.com/file/ysh';
    const validBody = {
        label: '2026-27 Season',
        start_date: '2026-04-01',
        end_date: '2027-07-31',
        individual_dues: '16.00',
        family_dues: '26.00',
        electronic_surcharge: '1.50',
    };

    function pngUpload() {
        return {buffer: Buffer.from('fake-png'), originalname: 'card.png', mimetype: 'image/png'};
    }

    function session() {
        return {adminId: 1, adminRole: 'super_admin'};
    }

    function periodRow(id) {
        return db.__getCurrentDb().prepare('SELECT * FROM membership_periods WHERE id = ?').get(id);
    }

    beforeEach(() => {
        storage.isConfigured.mockReturnValue(true);
        storage.uploadFile.mockImplementation(async (_buf, _name, folder) => `${B2_URL}/${folder}/uploaded.png`);
    });

    test('POST /periods stores the storage URL, not a public/img filename', async () => {
        const req = mockReq({body: validBody, file: pngUpload(), session: session()});
        await mockHandlers['POST /periods'](req, mockRes());

        const row = db.__getCurrentDb().prepare('SELECT * FROM membership_periods').get();
        expect(row.card_template_path).toBe(`${B2_URL}/card-templates/uploaded.png`);
        expect(storage.uploadFile).toHaveBeenCalledWith(expect.any(Buffer), 'card-template.png', 'card-templates');
    });

    test('POST /periods leaves the served static directory untouched', async () => {
        const imgDir = path.join(__dirname, '..', '..', 'public', 'img');
        const before = fs.readdirSync(imgDir);

        const req = mockReq({body: validBody, file: pngUpload(), session: session()});
        await mockHandlers['POST /periods'](req, mockRes());

        expect(fs.readdirSync(imgDir)).toEqual(before);
    });

    test('without B2 the template lands on the persistent data/ disk', async () => {
        storage.isConfigured.mockReturnValue(false);
        const req = mockReq({body: validBody, file: pngUpload(), session: session()});
        await mockHandlers['POST /periods'](req, mockRes());

        const stored = db.__getCurrentDb().prepare('SELECT * FROM membership_periods').get().card_template_path;
        expect(stored).toMatch(/^\/uploads\/\d+-\d+\.png$/);
        const onDisk = path.join(__dirname, '..', '..', 'data', 'uploads', path.basename(stored));
        try {
            expect(fs.readFileSync(onDisk)).toEqual(Buffer.from('fake-png'));
        } finally {
            fs.unlinkSync(onDisk);
        }
    });

    test('POST /periods/:id/edit replaces the template and deletes the old one', async () => {
        const p = insertPeriod(db);
        db.__getCurrentDb()
            .prepare('UPDATE membership_periods SET card_template_path = ? WHERE id = ?')
            .run(`${B2_URL}/card-templates/old.png`, p.id);

        const req = mockReq({params: {id: String(p.id)}, body: validBody, file: pngUpload(), session: session()});
        await mockHandlers['POST /periods/:id/edit'](req, mockRes());

        expect(periodRow(p.id).card_template_path).toBe(`${B2_URL}/card-templates/uploaded.png`);
        expect(storage.deleteFile).toHaveBeenCalledWith(`${B2_URL}/card-templates/old.png`);
    });

    test('POST /periods/:id/edit keeps the existing template when no file is uploaded', async () => {
        const p = insertPeriod(db);
        db.__getCurrentDb()
            .prepare('UPDATE membership_periods SET card_template_path = ? WHERE id = ?')
            .run(`${B2_URL}/card-templates/keep.png`, p.id);

        const req = mockReq({params: {id: String(p.id)}, body: validBody, session: session()});
        await mockHandlers['POST /periods/:id/edit'](req, mockRes());

        expect(periodRow(p.id).card_template_path).toBe(`${B2_URL}/card-templates/keep.png`);
        expect(storage.deleteFile).not.toHaveBeenCalled();
    });

    test('converts a PDF upload before storing it', async () => {
        // Stand in for gs/magick: write the file each invocation is asked to produce.
        mockExecFile.mockImplementation((cmd, args, cb) => {
            const out = cmd === 'gs'
                ? args.find(a => a.startsWith('-sOutputFile=')).slice('-sOutputFile='.length)
                : args[args.length - 1];
            fs.writeFileSync(out, Buffer.from(`converted-by-${cmd}`));
            cb(null, {stdout: '', stderr: ''});
        });

        const req = mockReq({
            body: validBody,
            file: {buffer: Buffer.from('%PDF-1.4'), originalname: 'card.pdf', mimetype: 'application/pdf'},
            session: session(),
        });
        await mockHandlers['POST /periods'](req, mockRes());

        expect(mockExecFile.mock.calls.map(c => c[0])).toEqual(['gs', 'magick']);
        expect(storage.uploadFile).toHaveBeenCalledWith(
            Buffer.from('converted-by-magick'), 'card-template.png', 'card-templates'
        );
    });

    test('flashes a PNG-instead message when the PDF toolchain is missing', async () => {
        mockExecFile.mockImplementation((cmd, args, cb) => {
            const err = new Error(`spawn ${cmd} ENOENT`);
            err.code = 'ENOENT';
            cb(err);
        });

        const req = mockReq({
            body: validBody,
            file: {buffer: Buffer.from('%PDF-1.4'), originalname: 'card.pdf', mimetype: 'application/pdf'},
            session: session(),
        });
        const res = mockRes();
        await mockHandlers['POST /periods'](req, res);

        expect(req.session.flash_error).toContain('Upload a PNG instead');
        expect(res._redirectUrl).toBe('/admin/periods/new');
        expect(storage.uploadFile).not.toHaveBeenCalled();
    });
});
