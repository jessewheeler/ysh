jest.mock('../../db/database', () => require('../helpers/setupDb'));

const db = require('../../db/database');
const cardsRepo = require('../../db/repos/cards');
const { insertMember, insertCard } = require('../helpers/fixtures');

beforeEach(() => {
  db.__resetTestDb();
});

describe('findLatestByMemberId', () => {
  test('returns most recent card by id', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertCard(testDb, { member_id: m.id, png_path: 'first.png', year: 2025 });

    const card = await cardsRepo.findLatestByMemberId(m.id);
    expect(card.png_path).toBe('first.png');
  });

  test('returns undefined when no card', async () => {
    const card = await cardsRepo.findLatestByMemberId(999);
    expect(card).toBeUndefined();
  });
});

describe('findByMemberId', () => {
  test('returns all cards for member', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertCard(testDb, { member_id: m.id, year: 2024 });
    insertCard(testDb, { member_id: m.id, year: 2025 });
    const cards = await cardsRepo.findByMemberId(m.id);
    expect(cards).toHaveLength(2);
  });
});

describe('upsertPng', () => {
  test('inserts when no existing card', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    await cardsRepo.upsertPng(m.id, 2025, 'data/cards/card.png');
    const card = await cardsRepo.findLatestByMemberId(m.id);
    expect(card.png_path).toBe('data/cards/card.png');
  });

  test('updates when card exists for year', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertCard(testDb, { member_id: m.id, png_path: 'old.png', year: 2025 });
    await cardsRepo.upsertPng(m.id, 2025, 'new.png');
    const card = await cardsRepo.findLatestByMemberId(m.id);
    expect(card.png_path).toBe('new.png');
  });
});

describe('upsertPdf', () => {
  test('inserts when no existing card', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    await cardsRepo.upsertPdf(m.id, 2025, 'data/cards/card.pdf');
    const card = await cardsRepo.findLatestByMemberId(m.id);
    expect(card.pdf_path).toBe('data/cards/card.pdf');
  });

  test('updates when card exists for year', async () => {
    const testDb = db.__getCurrentDb();
    const m = insertMember(testDb, { email: 'a@a.com' });
    insertCard(testDb, { member_id: m.id, pdf_path: 'old.pdf', year: 2025 });
    await cardsRepo.upsertPdf(m.id, 2025, 'new.pdf');
    const card = await cardsRepo.findLatestByMemberId(m.id);
    expect(card.pdf_path).toBe('new.pdf');
  });
});
