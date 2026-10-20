function escapeCsvValue(val) {
  if (val === null || val === undefined) return '';
    let str = String(val);
    // Prefix formula-trigger characters to prevent CSV injection
    if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
    }
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCsv(rows, columns, headers) {
  const headerRow = (headers || columns).map(escapeCsvValue).join(',');
  const dataRows = rows.map(row =>
    columns.map(col => escapeCsvValue(row[col])).join(',')
  );
  return [headerRow, ...dataRows].join('\n');
}

/** Sends rows as a CSV attachment. */
function sendCsv(res, filename, rows, columns, headers) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(rows, columns, headers));
}

module.exports = { escapeCsvValue, toCsv, sendCsv };
