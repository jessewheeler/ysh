const { escapeCsvValue, toCsv } = require('../../services/csv');

describe('escapeCsvValue', () => {
  test('returns empty string for null', () => {
    expect(escapeCsvValue(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(escapeCsvValue(undefined)).toBe('');
  });

  test('returns number as string', () => {
    expect(escapeCsvValue(42)).toBe('42');
  });

  test('returns plain string unchanged', () => {
    expect(escapeCsvValue('hello')).toBe('hello');
  });

  test('wraps value containing commas in quotes', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
  });

  test('wraps and escapes value containing double quotes', () => {
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
  });

  test('wraps value containing newlines', () => {
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
  });

  test('wraps value containing carriage return', () => {
    expect(escapeCsvValue('a\rb')).toBe('"a\rb"');
  });

  test('handles empty string', () => {
    expect(escapeCsvValue('')).toBe('');
  });
});

describe('toCsv', () => {
  test('produces header row and data rows', () => {
    const rows = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
    const result = toCsv(rows, ['name', 'age']);
    expect(result).toBe('name,age\nAlice,30\nBob,25');
  });

  test('uses custom headers when provided', () => {
    const rows = [{ name: 'Alice' }];
    const result = toCsv(rows, ['name'], ['Full Name']);
    expect(result).toBe('Full Name\nAlice');
  });

  test('returns only header row for empty rows', () => {
    const result = toCsv([], ['a', 'b'], ['A', 'B']);
    expect(result).toBe('A,B');
  });

  test('handles missing columns with empty string', () => {
    const rows = [{ a: 1 }];
    const result = toCsv(rows, ['a', 'b']);
    expect(result).toBe('a,b\n1,');
  });

  test('escapes values in data rows', () => {
    const rows = [{ val: 'has,comma' }];
    const result = toCsv(rows, ['val']);
    expect(result).toBe('val\n"has,comma"');
  });

  test('escapes values in header row', () => {
    const rows = [];
    const result = toCsv(rows, ['a'], ['Header, With Comma']);
    expect(result).toBe('"Header, With Comma"');
  });
});
