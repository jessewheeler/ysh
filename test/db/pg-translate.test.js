const { translateParams, translateSql, addReturningId } = require('../../db/pg-translate');
const { SCHEMA, toPgSchema } = require('../../db/schema');

describe('pg-translate', () => {
  test('toPgSchema converts AUTOINCREMENT to SERIAL', () => {
    const pg = toPgSchema(SCHEMA);
    expect(pg).not.toContain('AUTOINCREMENT');
    expect(pg).toContain('SERIAL PRIMARY KEY');
  });

  test('toPgSchema converts datetime to NOW()', () => {
    const pg = toPgSchema(SCHEMA);
    expect(pg).not.toContain("datetime('now')");
    expect(pg).toContain('NOW()');
  });

  test('toPgSchema uses TIMESTAMP for created_at/updated_at defaults', () => {
    const pg = toPgSchema(SCHEMA);
    expect(pg).toContain('TIMESTAMP DEFAULT NOW()');
  });

  test('translateParams replaces ? with $n', () => {
    expect(translateParams('SELECT * FROM users WHERE id = ?')).toBe('SELECT * FROM users WHERE id = $1');
    expect(translateParams('INSERT INTO logs (msg, val) VALUES (?, ?)')).toBe('INSERT INTO logs (msg, val) VALUES ($1, $2)');
  });

  test('translateSql handles datetime("now")', () => {
    expect(translateSql('SELECT datetime("now")')).toBe('SELECT NOW()');
    expect(translateSql("SELECT datetime('now')")).toBe('SELECT NOW()');
  });

  test('translateSql handles INSERT OR IGNORE', () => {
    expect(translateSql('INSERT OR IGNORE INTO tags (name) VALUES (?)'))
      .toBe('INSERT INTO tags (name) VALUES (?) ON CONFLICT DO NOTHING');
  });

  test('addReturningId appends RETURNING id to INSERT', () => {
    expect(addReturningId('INSERT INTO members (name) VALUES (?)')).toBe('INSERT INTO members (name) VALUES (?) RETURNING id');
    expect(addReturningId('  INSERT INTO members (name) VALUES (?)  ')).toBe('INSERT INTO members (name) VALUES (?) RETURNING id');
    expect(addReturningId('INSERT INTO members (name) VALUES (?);')).toBe('INSERT INTO members (name) VALUES (?) RETURNING id');
  });

  test('addReturningId does not append if already present or not an INSERT', () => {
    expect(addReturningId('SELECT * FROM members')).toBe('SELECT * FROM members');
    expect(addReturningId('INSERT INTO members (name) VALUES (?) RETURNING id')).toBe('INSERT INTO members (name) VALUES (?) RETURNING id');
  });
});
