/**
 * Sea Hawkers Central Council "Chapter Membership Tracking Report".
 *
 * The Council supplies a fixed .xlsx template and expects it back in exactly that
 * formatting, so this builds the report by injecting values into the committed template
 * in place rather than by generating a workbook. Almost every cell we write already
 * exists in the template's `NATIONAL` sheet with the correct style, so we keep each
 * cell's `s` attribute and only add its value — leaving styles.xml, the theme, merged
 * ranges, print setup, calcChain, the shared `=ROW()-18` formulas in column A, and the
 * other four sheets untouched.
 */
const fs = require('fs/promises');
const path = require('path');
const JSZip = require('jszip');

const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'council-membership-report-template.xlsx');

/** The NATIONAL tab is sheet1 in the Council's workbook. */
const SHEET_ENTRY = 'xl/worksheets/sheet1.xml';

const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The board block occupies rows 6–15 of the template, so it holds ten people. Rows 6–11
 * arrive pre-labelled with the Council's own six titles; we overwrite the Position column
 * with each bio's actual role and blank out the labels on any row we don't fill.
 */
const BOARD_FIRST_ROW = 6;
const BOARD_LAST_ROW = 15;
const BOARD_ROWS = BOARD_LAST_ROW - BOARD_FIRST_ROW + 1;

/** Static per the chapter — the Council asks for links to our social platforms. */
const SOCIAL = [
  ['Facebook', 'https://www.facebook.com/MontanaSeahawkers.org/'],
  ['Instagram', 'https://www.instagram.com/yellowstone_sea_hawkers/'],
  ['Website', 'https://yellowstoneseahawkers.org/'],
];

const DEFAULT_CHAPTER_NAME = 'Yellowstone Sea Hawkers';

/** First and last data rows pre-built in the template (2500 numbered rows). */
const FIRST_DATA_ROW = 19;
const LAST_TEMPLATE_ROW = 2518;

/** Refuse to generate an absurd sheet rather than trying to. */
const MAX_MEMBERS = 20000;

const DATA_COLUMNS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

/** Styles used when appending rows past the template's last pre-built row. */
const OVERFLOW_STYLES = { A: '17', B: '2', C: '2', D: '2', E: '2', F: '2', G: '2', H: '2', I: '2', J: '2', K: '2', L: '21' };

/** The social-media cells don't exist in the template; labels copy B14's bold style. */
const SOCIAL_LABEL_STYLE = '14';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The template's "ST" column wants a two-letter code, but members can be stored with a
 * full state name. Truncating would be actively wrong — "Montana" would become "MO",
 * which is Missouri — so full names are mapped, and anything unrecognized is passed
 * through untouched for a human to notice.
 */
const STATE_ABBREVIATIONS = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'puerto rico': 'PR', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY',
};

// Control characters that are illegal in XML 1.0 content — Excel refuses to open a
// workbook containing them, so they are stripped rather than escaped.
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = new RegExp('[\\u0000-\\u001F"\\\\/:*?<>|]', 'g');

function escapeXml(value) {
  return String(value)
    .replace(ILLEGAL_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 'AB12' -> 28 */
function columnIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index;
}

/**
 * Builds the board block from the bios as they are actually titled, in bio sort order.
 * The Council's six pre-printed titles don't describe a real chapter board (ours has a
 * Director of PR/Entertainment and Central Council Reps), so each bio's own role goes in
 * the Position column and the template's labels are overwritten.
 *
 * The caller passes visible bios; the block holds ten, and anyone past that is named in a
 * warning rather than dropped silently.
 */
function resolveBoard(bios) {
  const all = (bios || []).map(bio => ({
    position: (bio.role || '').trim(),
    name: (bio.name || '').trim(),
    email: (bio.email || '').trim(),
    bioId: bio.id ?? null,
  }));

  const board = all.slice(0, BOARD_ROWS);
  const overflow = all.slice(BOARD_ROWS);

  const warnings = [];
  if (!board.length) {
    warnings.push('No visible board bios, so the board block will be blank. The Council marks it mandatory.');
  }
  for (const row of board) {
    if (!row.email) warnings.push(`${row.name || 'A board bio'} has no email address on their bio.`);
    if (!row.position) warnings.push(`${row.name || 'A board bio'} has no role on their bio, so the Position cell will be blank.`);
  }
  if (overflow.length) {
    const names = overflow.map(row => row.name || 'unnamed').join(', ');
    warnings.push(`The board block holds ${BOARD_ROWS} people; ${names} did not fit and are not on the report.`);
  }

  return { board, warnings: [...new Set(warnings)] };
}

/** Normalizes a state to the two-letter code the "ST" column expects. */
function formatState(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.length === 2) return value.toUpperCase();
  return STATE_ABBREVIATIONS[value.toLowerCase()] || value;
}

/** Renders a 10-digit US number as (406) 555-1234; anything else is passed through. */
function formatPhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return formatPhone(digits.slice(1));
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return String(raw).trim();
}

/**
 * The "Member Since" column wants a year; join_date is the truth, created_at the
 * fallback. Postgres hands back a Date where SQLite hands back a string.
 */
function memberSinceYear(member) {
  const source = member.join_date || member.created_at;
  if (!source) return null;
  if (source instanceof Date) return source.getFullYear();
  const year = parseInt(String(source).slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}

/** "July 2026" for the MONTH/YEAR ENDING cell, derived from a period's end_date. */
function monthYearEndingFrom(endDate) {
  if (!endDate) return '';
  const iso = endDate instanceof Date ? endDate.toISOString().slice(0, 10) : String(endDate);
  const [year, month] = iso.split('-');
  const index = parseInt(month, 10) - 1;
  if (!year || !MONTHS[index]) return iso;
  return `${MONTHS[index]} ${year}`;
}

/** Yellowstone-Sea-Hawkers-Membership-Report-2026-07.xlsx */
function defaultFilename(endDate) {
  const iso = endDate instanceof Date ? endDate.toISOString().slice(0, 10) : String(endDate || '');
  const stamp = /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : new Date().toISOString().slice(0, 7);
  return `Yellowstone-Sea-Hawkers-Membership-Report-${stamp}.xlsx`;
}

/** Keeps a user-supplied filename to a single safe .xlsx basename. */
function sanitizeFilename(name) {
  const base = path.basename(String(name || '').trim())
    .replace(UNSAFE_FILENAME_CHARS, '')
    .replace(/^\.+/, '')
    .trim();
  if (!base) return defaultFilename(null);
  return base.toLowerCase().endsWith('.xlsx') ? base : `${base}.xlsx`;
}

function cellXml(ref, { value, type, style }) {
  const attr = style ? ` s="${style}"` : '';
  if (type === 'blank') return `<c r="${ref}"${attr}/>`;
  if (type === 'number') return `<c r="${ref}"${attr}><v>${value}</v></c>`;
  return `<c r="${ref}"${attr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/**
 * Gives each requested cell its value in a single pass over the sheet XML.
 *
 * Cells that already exist keep their `s` (style) attribute, so they keep the Council's
 * formatting. Cells the template doesn't have — the social-media block in rows 15–17 —
 * are inserted into their row in column order, which Excel requires.
 *
 * Strings are written as inline strings: xl/sharedStrings.xml stays valid and untouched,
 * and Excel can never interpret member-supplied text as a formula, because in
 * SpreadsheetML only an `<f>` element makes a cell a formula.
 *
 * @param {Map<string, {value: *, type: 'string'|'number', style?: string}>} cells by ref
 */
function writeCells(xml, cells) {
  const pending = new Set(cells.keys());

  let next = xml.replace(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g, (whole, ref, attrs) => {
    const cell = cells.get(ref);
    if (!cell) return whole;
    pending.delete(ref);
    const styleMatch = attrs.match(/\ss="(\d+)"/);
    return cellXml(ref, { ...cell, style: styleMatch ? styleMatch[1] : cell.style });
  });

  if (!pending.size) return next;

  // Insert the cells the template doesn't carry, grouped by row and kept in column order.
  const byRow = new Map();
  for (const ref of pending) {
    const row = parseInt(ref.match(/\d+$/)[0], 10);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(ref);
  }

  for (const [row, refs] of byRow) {
    const rowPattern = new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
    const match = next.match(rowPattern);
    if (!match) throw new Error(`Report template has no row ${row}`);

    const existing = match[2].match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
    const ordered = existing.map(cell => ({
      xml: cell,
      index: columnIndex(cell.match(/r="([A-Z]+\d+)"/)[1]),
    }));
    for (const ref of refs) {
      ordered.push({ xml: cellXml(ref, cells.get(ref)), index: columnIndex(ref) });
    }
    ordered.sort((a, b) => a.index - b.index);

    next = next.replace(rowPattern, () => `${match[1]}${ordered.map(c => c.xml).join('')}${match[3]}`);
  }

  return next;
}

/** Cells for one member, keyed by column letter. */
function memberCells(member, boardPositionByName) {
  const name = `${(member.first_name || '').trim()} ${(member.last_name || '').trim()}`.trim().toLowerCase();
  return {
    B: member.first_name || '',
    C: member.last_name || '',
    D: member.report_street ?? member.address_street ?? '',
    E: member.report_city ?? member.address_city ?? '',
    F: formatState(member.report_state ?? member.address_state),
    G: member.report_zip ?? member.address_zip ?? '',
    // Deliberately the member's own email, never the primary's: two identical emails
    // would let the Council's dedupe collapse a family into one person, which is the
    // opposite of the template's "list each member separately" instruction.
    H: member.email || '',
    I: formatPhone(member.phone || member.report_phone),
    // Every member of this chapter reports Yellowstone as their primary chapter.
    J: 'Y',
    K: memberSinceYear(member),
    L: boardPositionByName.get(name) || '',
  };
}

/**
 * An extra data row for members past the template's 2500 pre-built rows. Column A gets a
 * literal number rather than a formula, so xl/calcChain.xml stays valid as written.
 */
function overflowRow(rowNumber, cells) {
  const parts = [`<c r="A${rowNumber}" s="${OVERFLOW_STYLES.A}"><v>${rowNumber - (FIRST_DATA_ROW - 1)}</v></c>`];
  for (const col of DATA_COLUMNS) {
    const ref = `${col}${rowNumber}`;
    const value = cells[col];
    if (value === null || value === undefined || value === '') {
      parts.push(`<c r="${ref}" s="${OVERFLOW_STYLES[col]}"/>`);
    } else {
      parts.push(cellXml(ref, {
        value,
        type: col === 'K' ? 'number' : 'string',
        style: OVERFLOW_STYLES[col],
      }));
    }
  }
  return `<row r="${rowNumber}" spans="1:12">${parts.join('')}</row>`;
}

/** Non-fatal things the admin should know about before submitting to the Council. */
function memberWarnings(members) {
  const warnings = [];
  const noAddress = members.filter(m => !(m.report_street ?? m.address_street)).length;
  const noEmail = members.filter(m => !m.email).length;
  if (noAddress) warnings.push(`${noAddress} member(s) have no street address — those cells will be blank.`);
  if (noEmail) warnings.push(`${noEmail} member(s) have no email address — those cells will be blank.`);
  if (members.length > LAST_TEMPLATE_ROW - FIRST_DATA_ROW + 1) {
    warnings.push(`The template pre-formats ${LAST_TEMPLATE_ROW - FIRST_DATA_ROW + 1} rows; ${members.length} rows will be written, so extra rows are appended.`);
  }
  return warnings;
}

/**
 * Builds the report workbook.
 * @returns {Promise<Buffer>} the .xlsx bytes
 */
async function buildWorkbook({ chapterName, monthYearEnding, submittedBy, board, members }) {
  const rows = members || [];
  if (rows.length > MAX_MEMBERS) {
    throw new Error(`Refusing to build a membership report with ${rows.length} rows (limit ${MAX_MEMBERS})`);
  }

  const zip = await JSZip.loadAsync(await fs.readFile(TEMPLATE_PATH));
  const sheet = zip.file(SHEET_ENTRY);
  if (!sheet) throw new Error(`Report template is missing ${SHEET_ENTRY}`);
  let xml = await sheet.async('string');

  const cells = new Map();
  const put = (ref, value, type = 'string', style) => {
    if (value === null || value === undefined || value === '') return;
    cells.set(ref, { value, type, style });
  };
  /** Empties a cell the template ships with content in. */
  const blank = (ref) => cells.set(ref, { type: 'blank' });

  // Header block
  put('C3', chapterName || DEFAULT_CHAPTER_NAME);
  put('C4', rows.length, 'number');
  put('C5', monthYearEnding);
  put('C6', submittedBy);

  // Social media links — these cells don't exist in the template and get inserted.
  SOCIAL.forEach(([label, url], i) => {
    put(`B${15 + i}`, label, 'string', SOCIAL_LABEL_STYLE);
    put(`C${15 + i}`, url);
  });

  // Board block, rows 6–15. Each bio's own role goes in the Position column, replacing the
  // Council's pre-printed titles; unused rows have their label cleared so no title is left
  // sitting next to an empty name.
  const boardRows = board || [];
  for (let i = 0; i < BOARD_ROWS; i++) {
    const row = BOARD_FIRST_ROW + i;
    const entry = boardRows[i];
    if (entry && entry.position) put(`G${row}`, entry.position);
    else blank(`G${row}`);
    if (!entry) continue;
    put(`H${row}`, entry.name);
    put(`I${row}`, entry.email);
  }

  // Board members are also flagged in the last column of their own data row.
  const boardPositionByName = new Map();
  for (const entry of board || []) {
    if (entry.name) boardPositionByName.set(entry.name.trim().toLowerCase(), entry.position);
  }

  const appended = [];
  rows.forEach((member, i) => {
    const rowNumber = FIRST_DATA_ROW + i;
    const values = memberCells(member, boardPositionByName);
    if (rowNumber > LAST_TEMPLATE_ROW) {
      appended.push(overflowRow(rowNumber, values));
      return;
    }
    for (const col of DATA_COLUMNS) {
      put(`${col}${rowNumber}`, values[col], col === 'K' ? 'number' : 'string');
    }
  });

  xml = writeCells(xml, cells);

  if (appended.length) {
    const lastRow = FIRST_DATA_ROW + rows.length - 1;
    xml = xml.replace('</sheetData>', `${appended.join('')}</sheetData>`);
    xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:L${lastRow}"/>`);
  }

  zip.file(SHEET_ENTRY, xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = {
  SOCIAL,
  CONTENT_TYPE,
  DEFAULT_CHAPTER_NAME,
  TEMPLATE_PATH,
  FIRST_DATA_ROW,
  LAST_TEMPLATE_ROW,
  BOARD_FIRST_ROW,
  BOARD_ROWS,
  MAX_MEMBERS,
  resolveBoard,
  formatPhone,
  formatState,
  memberSinceYear,
  monthYearEndingFrom,
  defaultFilename,
  sanitizeFilename,
  memberWarnings,
  buildWorkbook,
};
