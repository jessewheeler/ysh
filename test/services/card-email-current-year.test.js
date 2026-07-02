// Regression: sendCardEmail must attach the member's CURRENT-year card, never
// whichever card was created most recently.
//
// Root cause (Defect B): sendCardEmail (services/email.js) looks up the card
// via cardsRepo.findLatestByMemberId(), which is `ORDER BY created_at DESC
// LIMIT 1` and ignores the `year` column. When the current-year card is
// missing (e.g. renewal generation failed — see Defect A), this returns last
// year's card and emails it as if it were the current season's.
//
// The attachment is even mislabeled: the filename is built from
// member.membership_year (2026) while the bytes fetched are the 2025 card.

jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const { insertMember, insertCard } = require('../helpers/fixtures');

let emailService;
let member;

beforeEach(() => {
  db.__resetTestDb();
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 202 });

  jest.isolateModules(() => {
    emailService = require('../../services/email');
  });

  const testDb = db.__getCurrentDb();
  // Member has renewed into the 2026 season...
  member = insertMember(testDb, {
    email: 'member@test.com',
    first_name: 'John',
    last_name: 'Doe',
    membership_year: 2026,
    status: 'active',
  });
  // ...but only LAST year's card (2025) exists — the 2026 card never generated.
  insertCard(testDb, {
    member_id: member.id,
    pdf_path: 'https://b2.example.com/cards/card-1-2025.pdf',
    png_path: 'https://b2.example.com/cards/card-1-2025.png',
    year: 2025,
  });
});

describe('sendCardEmail — current-year selection', () => {
  test('does not deliver last year\'s card when the current-year card is missing', async () => {
    // Track which card files get fetched for attachment.
    global.fetch = jest.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.startsWith('https://b2.example.com')) {
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(Buffer.from('x').buffer) });
      }
      return Promise.resolve({ ok: true, status: 202 });
    });

    // Fix target: with no 2026 card, sendCardEmail must NOT silently attach the
    // 2025 card. It should refuse (throw) rather than deliver a stale card.
    await expect(emailService.sendCardEmail(member)).rejects.toThrow();

    const staleFetches = global.fetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('2025')
    );
    expect(staleFetches).toHaveLength(0);
  });

  test('attaches the current-year card when it exists', async () => {
    const testDb = db.__getCurrentDb();
    insertCard(testDb, {
      member_id: member.id,
      pdf_path: 'https://b2.example.com/cards/card-1-2026.pdf',
      png_path: 'https://b2.example.com/cards/card-1-2026.png',
      year: 2026,
    });

    global.fetch = jest.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.startsWith('https://b2.example.com')) {
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(Buffer.from('x').buffer) });
      }
      return Promise.resolve({ ok: true, status: 202 });
    });

    await emailService.sendCardEmail(member);

    const fetched = global.fetch.mock.calls
      .map(([url]) => url)
      .filter((url) => typeof url === 'string' && url.startsWith('https://b2.example.com'));
    // Only the 2026 card should be fetched — never the 2025 one.
    expect(fetched.every((url) => url.includes('2026'))).toBe(true);
    expect(fetched.some((url) => url.includes('2025'))).toBe(false);
  });
});
