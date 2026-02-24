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

// Mock fs
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    writeFileSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
  };
});

// Mock storage — default to not configured (local path)
jest.mock('../../services/storage', () => ({
    isConfigured: jest.fn().mockReturnValue(false),
    uploadFileAtKey: jest.fn(),
}));

jest.mock('../../db/database', () => require('../helpers/setupDb'));

const fs = require('fs');
const storage = require('../../services/storage');
const db = require('../../db/database');
const { insertMember, insertCard } = require('../helpers/fixtures');

let cardService;
let testMember;

beforeEach(() => {
  db.__resetTestDb();
  jest.clearAllMocks();

  // Reset fs mocks
  fs.existsSync.mockReturnValue(true);
  fs.writeFileSync.mockImplementation(() => {});
  fs.mkdirSync.mockImplementation(() => {});

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
