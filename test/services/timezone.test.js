const { denverInputToUtcIso, utcToDenverInput, formatDenver } = require('../../services/timezone');

describe('denverInputToUtcIso', () => {
  test.each([
    ['2026-07-04T18:00', '2026-07-05T00:00:00.000Z'], // MDT, UTC-6
    ['2026-12-01T18:00', '2026-12-02T01:00:00.000Z'], // MST, UTC-7
    ['2026-03-08T01:59', '2026-03-08T08:59:00.000Z'], // last minute of MST
    ['2026-03-08T03:00', '2026-03-08T09:00:00.000Z'], // first hour of MDT
    ['2026-11-01T00:30', '2026-11-01T06:30:00.000Z'],
    ['2026-11-01T02:30', '2026-11-01T09:30:00.000Z'], // after fall-back, MST
  ])('%s Denver is %s', (input, expected) => {
    expect(denverInputToUtcIso(input)).toBe(expected);
  });

  test('a time inside the spring-forward gap rolls an hour later', () => {
    const iso = denverInputToUtcIso('2026-03-08T02:30');
    expect(utcToDenverInput(iso)).toBe('2026-03-08T03:30');
  });

  test('the repeated hour on the fall-back night resolves to the first (MDT) occurrence', () => {
    expect(denverInputToUtcIso('2026-11-01T01:30')).toBe('2026-11-01T07:30:00.000Z');
  });

  test.each(['', 'junk', '2026-02-30T10:00', '2026-13-01T10:00', '2026-07-04 18:00', null])(
    'rejects %p', (input) => {
      expect(denverInputToUtcIso(input)).toBeNull();
    });
});

describe('utcToDenverInput', () => {
  test.each(['2026-01-15T09:05', '2026-06-30T23:59', '2026-11-01T02:30', '2026-03-08T03:00'])(
    'round-trips %s', (input) => {
      expect(utcToDenverInput(denverInputToUtcIso(input))).toBe(input);
    });

  test('reads a zone-less SQLite timestamp as UTC', () => {
    expect(utcToDenverInput('2026-07-05 00:00:00')).toBe('2026-07-04T18:00');
  });

  test('accepts a Date (PostgreSQL TIMESTAMP columns)', () => {
    expect(utcToDenverInput(new Date('2026-12-02T01:00:00Z'))).toBe('2026-12-01T18:00');
  });

  test('blank for nothing', () => {
    expect(utcToDenverInput(null)).toBe('');
  });
});

describe('formatDenver', () => {
  test('names the zone so readers know it is Montana time', () => {
    expect(formatDenver('2026-11-02T01:00:00.000Z')).toBe('Sun, Nov 1, 6:00 PM MST');
    expect(formatDenver('2026-07-05T00:00:00.000Z')).toBe('Sat, Jul 4, 6:00 PM MDT');
  });
});
