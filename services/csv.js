function escapeCsvValue(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
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

module.exports = { escapeCsvValue, toCsv };
