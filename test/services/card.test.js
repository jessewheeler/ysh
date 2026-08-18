// Mock canvas before requiring card service
const mockGetContext = jest.fn(() => ({
  fillRect: jest.fn(),
  fillText: jest.fn(),
  drawImage: jest.fn(),
  fillStyle: '',
  font: '',
}));
const mockToBuffer = jest.fn(() => Buffer.from('fake-png'));

jest.mock('canvas', () => ({
  createCanvas: jest.fn(() => ({
    getContext: mockGetContext,
    toBuffer: mockToBuffer,
  })),
  loadImage: jest.fn().mockResolvedValue({ width: 100, height: 100 }),
}));

// Mock pdfkit — return an EventEmitter-like object
const mockPdfEnd = jest.fn();
const mockPdfPipe = jest.fn();
const mockPdfRect = jest.fn().mockReturnThis();
const mockPdfFill = jest.fn().mockReturnThis();
const mockPdfFillColor = jest.fn().mockReturnThis();
const mockPdfFont = jest.fn().mockReturnThis();
const mockPdfFontSize = jest.fn().mockReturnThis();
const mockPdfText = jest.fn().mockReturnThis();
const mockPdfImage = jest.fn().mockReturnThis();

jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => ({
    pipe: mockPdfPipe,
    rect: mockPdfRect,
    fill: mockPdfFill,
    fillColor: mockPdfFillColor,
    font: mockPdfFont,
    fontSize: mockPdfFontSize,
    text: mockPdfText,
    image: mockPdfImage,
    end: mockPdfEnd,
  }));
});

// Mock fs — readFileSync delegates to the real one so template lookups behave
// like the filesystem does, while still being observable.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    writeFileSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    readFileSync: jest.fn((...args) => actual.readFileSync(...args)),
  };
});

jest.mock('../../services/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// Mock storage — default to not configured (local path)
jest.mock('../../services/storage', () => ({
    isConfigured: jest.fn().mockReturnValue(false),
    uploadFileAtKey: jest.fn(),
}));

jest.mock('../../db/database', () => require('../helpers/setupDb'));

const fs = require('fs');
const actualFs = jest.requireActual('fs');
const path = require('path');
const DEFAULT_TEMPLATE = path.join(__dirname, '..', '..', 'public', 'img', 'card-template.png');
const storage = require('../../services/storage');
const logger = require('../../services/logger');
const { loadImage } = require('canvas');
const db = require('../../db/database');
const { insertMember, insertCard, insertPeriod, enrollMember } = require('../helpers/fixtures');

let cardService;
let testMember;

beforeEach(() => {
  db.__resetTestDb();
  jest.clearAllMocks();

  // Reset fs mocks
  fs.existsSync.mockReturnValue(true);
  fs.writeFileSync.mockImplementation(() => {});
  fs.mkdirSync.mockImplementation(() => {});
  fs.readFileSync.mockImplementation((...args) => actualFs.readFileSync(...args));

    // Default storage: not configured
    storage.isConfigured.mockReturnValue(false);

    // When doc.end() is called, emit 'end' on the piped-to PassThrough stream
  mockPdfEnd.mockImplementation(() => {
      process.nextTick(() => {
          const pipedTo = mockPdfPipe.mock.calls[mockPdfPipe.mock.calls.length - 1]?.[0];
          if (pipedTo && typeof pipedTo.emit === 'function') {
              pipedTo.emit('end');
          }
      });
  });

  jest.isolateModules(() => {
    cardService = require('../../services/card');
  });

  const testDb = db.__getCurrentDb();
  testMember = insertMember(testDb, {
    email: 'card@test.com',
    first_name: 'Jane',
    last_name: 'Doe',
    member_number: 'YSH-2025-0001',
    membership_year: 2025,
    status: 'active',
  });
});

describe('generatePNG', () => {
  test('writes file with correct name pattern', async () => {
    await cardService.generatePNG(testMember);
    expect(fs.writeFileSync).toHaveBeenCalled();
    const writtenPath = fs.writeFileSync.mock.calls[0][0];
    expect(writtenPath).toContain(`card-${testMember.id}-2025.png`);
  });

  test('returns the file path', async () => {
    const result = await cardService.generatePNG(testMember);
    expect(result).toContain(`card-${testMember.id}-2025.png`);
  });

  test('inserts membership_cards row with png_path', async () => {
    await cardService.generatePNG(testMember);
    const card = db.prepare('SELECT * FROM membership_cards WHERE member_id = ?').get(testMember.id);
    expect(card).toBeDefined();
    expect(card.png_path).toContain(`card-${testMember.id}-2025.png`);
  });

  test('updates existing card row when one exists for same member+year', async () => {
    const testDb = db.__getCurrentDb();
    insertCard(testDb, {
      member_id: testMember.id,
      pdf_path: 'data/cards/card-old.pdf',
      png_path: null,
      year: 2025,
    });

    await cardService.generatePNG(testMember);
    const cards = db.prepare('SELECT * FROM membership_cards WHERE member_id = ?').all(testMember.id);
    expect(cards.length).toBe(1);
    expect(cards[0].png_path).toContain(`card-${testMember.id}-2025.png`);
    expect(cards[0].pdf_path).toBe('data/cards/card-old.pdf');
  });

  test('writes PNG buffer to file', async () => {
    await cardService.generatePNG(testMember);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(`card-${testMember.id}-2025.png`),
      expect.any(Buffer)
    );
  });
});

describe('generatePNG with B2 configured', () => {
    const B2_URL = 'https://f002.backblazeb2.com/file/ysh-cards';

    beforeEach(() => {
        storage.isConfigured.mockReturnValue(true);
        storage.uploadFileAtKey.mockResolvedValue(`${B2_URL}/cards/card-${testMember.id}-2025.png`);
    });

    test('uploads PNG to B2 with deterministic key', async () => {
        await cardService.generatePNG(testMember);
        expect(storage.uploadFileAtKey).toHaveBeenCalledWith(
            expect.any(Buffer),
            `cards/card-${testMember.id}-2025.png`,
            'image/png'
        );
    });

    test('stores B2 URL in DB', async () => {
        await cardService.generatePNG(testMember);
        const card = db.prepare('SELECT * FROM membership_cards WHERE member_id = ?').get(testMember.id);
        expect(card.png_path).toBe(`${B2_URL}/cards/card-${testMember.id}-2025.png`);
    });

    test('does not write local file when B2 is configured', async () => {
        await cardService.generatePNG(testMember);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    test('returns B2 URL', async () => {
        const result = await cardService.generatePNG(testMember);
        expect(result).toBe(`${B2_URL}/cards/card-${testMember.id}-2025.png`);
    });
});

describe('generatePDF', () => {
  test('returns file path with correct name pattern', async () => {
    const result = await cardService.generatePDF(testMember);
    expect(result).toContain(`card-${testMember.id}-2025.pdf`);
  });

    test('pipes PDF to a stream', async () => {
    await cardService.generatePDF(testMember);
    expect(mockPdfPipe).toHaveBeenCalled();
  });

  test('inserts membership_cards row with pdf_path', async () => {
    await cardService.generatePDF(testMember);
    const card = db.prepare('SELECT * FROM membership_cards WHERE member_id = ?').get(testMember.id);
    expect(card).toBeDefined();
    expect(card.pdf_path).toContain(`card-${testMember.id}-2025.pdf`);
  });

  test('updates existing card row when one exists for same member+year', async () => {
    const testDb = db.__getCurrentDb();
    insertCard(testDb, {
      member_id: testMember.id,
      pdf_path: null,
      png_path: 'data/cards/card-old.png',
      year: 2025,
    });

    await cardService.generatePDF(testMember);
    const cards = db.prepare('SELECT * FROM membership_cards WHERE member_id = ?').all(testMember.id);
    expect(cards.length).toBe(1);
    expect(cards[0].pdf_path).toContain(`card-${testMember.id}-2025.pdf`);
    expect(cards[0].png_path).toBe('data/cards/card-old.png');
  });

  test('calls doc.end() to finish PDF generation', async () => {
    await cardService.generatePDF(testMember);
    expect(mockPdfEnd).toHaveBeenCalled();
  });

    test('writes PDF buffer to local file', async () => {
        await cardService.generatePDF(testMember);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining(`card-${testMember.id}-2025.pdf`),
            expect.any(Buffer)
        );
    });
});

describe('generatePDF with B2 configured', () => {
    const B2_URL = 'https://f002.backblazeb2.com/file/ysh-cards';

    beforeEach(() => {
        storage.isConfigured.mockReturnValue(true);
        storage.uploadFileAtKey.mockResolvedValue(`${B2_URL}/cards/card-${testMember.id}-2025.pdf`);
    });

    test('uploads PDF to B2 with deterministic key', async () => {
        await cardService.generatePDF(testMember);
        expect(storage.uploadFileAtKey).toHaveBeenCalledWith(
            expect.any(Buffer),
            `cards/card-${testMember.id}-2025.pdf`,
            'application/pdf'
        );
    });

    test('stores B2 URL in DB', async () => {
        await cardService.generatePDF(testMember);
        const card = db.prepare('SELECT * FROM membership_cards WHERE member_id = ?').get(testMember.id);
        expect(card.pdf_path).toBe(`${B2_URL}/cards/card-${testMember.id}-2025.pdf`);
    });

    test('does not write local file when B2 is configured', async () => {
        await cardService.generatePDF(testMember);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    test('returns B2 URL', async () => {
        const result = await cardService.generatePDF(testMember);
        expect(result).toBe(`${B2_URL}/cards/card-${testMember.id}-2025.pdf`);
    });
});

// The period's template used to be read as a bare filename out of public/img/, which
// a deploy wipes (issue #96).  It now stores whatever handleUpload returned, so the
// service has to cope with a URL, a local /uploads/ path, and legacy bare filenames.
describe('card template resolution', () => {
    const UPLOADED = Buffer.from('uploaded-template');

    function givenTemplate(card_template_path) {
        const testDb = db.__getCurrentDb();
        const period = insertPeriod(testDb, {label: '2025-26 Season'});
        testDb.prepare('UPDATE membership_periods SET card_template_path = ? WHERE id = ?')
            .run(card_template_path, period.id);
        enrollMember(testDb, testMember.id, period.id);
        return period;
    }

    /** Buffer handed to canvas for the card background. */
    function templatePassedToCanvas() {
        return loadImage.mock.calls[0][0];
    }

    test('fetches the template when the path is a B2 URL', async () => {
        givenTemplate('https://f002.backblazeb2.com/file/ysh/card-templates/2025.png');
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => UPLOADED.buffer.slice(UPLOADED.byteOffset, UPLOADED.byteOffset + UPLOADED.length),
        });

        await cardService.generatePNG(testMember);

        expect(global.fetch).toHaveBeenCalledWith(
            'https://f002.backblazeb2.com/file/ysh/card-templates/2025.png',
            expect.objectContaining({signal: expect.any(AbortSignal)})
        );
        expect(templatePassedToCanvas()).toEqual(UPLOADED);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('reads from data/uploads when the path is a local upload', async () => {
        givenTemplate('/uploads/1234-abcd.png');
        fs.readFileSync.mockImplementation((p, ...rest) => (
            String(p).includes('1234-abcd.png') ? UPLOADED : actualFs.readFileSync(p, ...rest)
        ));

        await cardService.generatePNG(testMember);

        expect(fs.readFileSync).toHaveBeenCalledWith(
            expect.stringContaining(path.join('data', 'uploads', '1234-abcd.png'))
        );
        expect(templatePassedToCanvas()).toEqual(UPLOADED);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('reads legacy bare filenames from public/img', async () => {
        givenTemplate('card-template-2.png');
        // Stubbed rather than leaning on the committed card-template-2.png, which is a
        // leftover of issue #96 and due to be deleted.
        fs.readFileSync.mockImplementation((p, ...rest) => (
            String(p).includes('card-template-2.png') ? UPLOADED : actualFs.readFileSync(p, ...rest)
        ));

        await cardService.generatePNG(testMember);

        expect(fs.readFileSync).toHaveBeenCalledWith(
            expect.stringContaining(path.join('public', 'img', 'card-template-2.png'))
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('falls back to the default template and warns when a fetch fails', async () => {
        givenTemplate('https://f002.backblazeb2.com/file/ysh/card-templates/gone.png');
        global.fetch = jest.fn().mockResolvedValue({ok: false, status: 404});

        await cardService.generatePNG(testMember);

        expect(logger.warn).toHaveBeenCalledWith('Card template unavailable, using default', expect.objectContaining({
            cardTemplatePath: 'https://f002.backblazeb2.com/file/ysh/card-templates/gone.png',
        }));
        expect(templatePassedToCanvas()).toEqual(actualFs.readFileSync(DEFAULT_TEMPLATE));
    });

    test('falls back to the default template and warns when a local file is missing', async () => {
        givenTemplate('/uploads/never-deployed.png');

        await cardService.generatePNG(testMember);

        expect(logger.warn).toHaveBeenCalled();
        expect(templatePassedToCanvas()).toEqual(actualFs.readFileSync(DEFAULT_TEMPLATE));
    });

    test('uses the default template when the period has none configured', async () => {
        givenTemplate(null);

        await cardService.generatePNG(testMember);

        expect(templatePassedToCanvas()).toEqual(actualFs.readFileSync(DEFAULT_TEMPLATE));
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('bounds the fetch so a stalled B2 cannot hang card generation', async () => {
        givenTemplate('https://f002.backblazeb2.com/file/ysh/card-templates/slow.png');
        global.fetch = jest.fn().mockRejectedValue(
            Object.assign(new Error('The operation was aborted due to timeout'), {name: 'TimeoutError'})
        );

        await cardService.generatePNG(testMember);

        const [, opts] = global.fetch.mock.calls[0];
        expect(opts.signal).toBeInstanceOf(AbortSignal);
        expect(logger.warn).toHaveBeenCalled();
        expect(templatePassedToCanvas()).toEqual(actualFs.readFileSync(DEFAULT_TEMPLATE));
    });

    test('reads a template once even when many cards are generated', async () => {
        givenTemplate('https://f002.backblazeb2.com/file/ysh/card-templates/2025.png');
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => UPLOADED.buffer.slice(UPLOADED.byteOffset, UPLOADED.byteOffset + UPLOADED.length),
        });

        await cardService.generatePNG(testMember);
        await cardService.generatePDF(testMember);

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('generatePDF draws the resolved template buffer, not a path', async () => {
        givenTemplate('/uploads/1234-abcd.png');
        fs.readFileSync.mockImplementation((p, ...rest) => (
            String(p).includes('1234-abcd.png') ? UPLOADED : actualFs.readFileSync(p, ...rest)
        ));

        await cardService.generatePDF(testMember);

        expect(mockPdfImage).toHaveBeenCalledWith(UPLOADED, 0, 0, expect.any(Object));
    });
});
