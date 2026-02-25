/**
 * Translates SQL dialect differences between SQLite and PostgreSQL.
 */

/**
 * Replaces ? with $1, $2, etc.
 */
function translateParams(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

/**
 * Handles dialect-specific SQL functions and syntax.
 */
function translateSql(sql) {
  let translated = sql;

  // datetime('now') -> NOW()
  translated = translated.replace(/datetime\(['"]now['"]\)/gi, 'NOW()');

  // date('now', '+' || ? || ' days') -> (CURRENT_DATE + (? * INTERVAL '1 day'))
  translated = translated.replace(
    /date\s*\(\s*'now'\s*,\s*'\+'\s*\|\|\s*\?\s*\|\|\s*' days'\s*\)/gi,
    "(CURRENT_DATE + (? * INTERVAL '1 day'))"
  );

  // date('now') -> CURRENT_DATE
  translated = translated.replace(/date\s*\(\s*'now'\s*\)/gi, 'CURRENT_DATE');

  // strftime('%Y-%m-%dT%H:%M:%SZ', 'now') -> NOW()
  translated = translated.replace(/strftime\s*\(\s*'[^']*'\s*,\s*'now'\s*\)/gi, 'NOW()');

  // INSERT OR IGNORE INTO -> INSERT INTO ... ON CONFLICT DO NOTHING
  if (/INSERT OR IGNORE INTO/i.test(translated)) {
    translated = translated.replace(/INSERT OR IGNORE INTO/i, 'INSERT INTO');
    translated += ' ON CONFLICT DO NOTHING';
  }

  return translated;
}

/**
 * Appends RETURNING id to INSERT statements to capture lastInsertRowid.
 * Skips if already has RETURNING clause or if it's an upsert (any ON CONFLICT).
 */
function addReturningId(sql) {
  if (/^\s*INSERT INTO/i.test(sql) && !/RETURNING/i.test(sql) && !/ON CONFLICT/i.test(sql)) {
    return sql.trim().replace(/;?$/, ' RETURNING id');
  }
  return sql;
}

module.exports = {
  translateParams,
  translateSql,
  addReturningId
};
