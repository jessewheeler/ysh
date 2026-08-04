const fs = require('fs');
const JSZip = require('jszip');
const councilReport = require('../../services/councilReport');

const { buildWorkbook, resolveBoard, formatPhone, memberSinceYear, monthYearEndingFrom,
  defaultFilename, sanitizeFilename, memberWarnings, TEMPLATE_PATH, LAST_TEMPLATE_ROW } = councilReport;

const SHEET = 'xl/worksheets/sheet1.xml';

function buildMember(overrides = {}) {
  return {
    first_name: 'John',
    last_name: 'Fanzone',
    email: 'john@example.com',
    phone: '4065551234',
    report_street: '1 Main St',
    report_city: 'Billings',
    report_state: 'MT',
    report_zip: '59101',
    join_date: '2019-04-01',
    ...overrides,
  };
}

/** Pulls one cell's raw XML out of the generated sheet. */
function cell(xml, ref) {
  const match = xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`));
  return match ? match[0] : null;
}

/** The inline-string or numeric value of a cell, or null when the cell is empty. */
function value(xml, ref) {
  const raw = cell(xml, ref);
  if (!raw) return null;
  const inline = raw.match(/<t[^>]*>([\s\S]*?)<\/t>/);
  if (inline) return inline[1];
  const num = raw.match(/<v>([^<]*)<\/v>/);
  return num ? num[1] : null;
}

async function generate(overrides = {}) {
  const buffer = await buildWorkbook({
    chapterName: 'Yellowstone Sea Hawkers',
    monthYearEnding: 'July 2026',
    submittedBy: 'Jesse Wheeler',
    board: [],
    members: [],
    ...overrides,
  });
  const zip = await JSZip.loadAsync(buffer);
  return { buffer, zip, xml: await zip.file(SHEET).async('string') };
}

describe('resolveBoard', () => {
  test('uses each bio\'s own role, in the order the bios are given', () => {
    const { board, warnings } = resolveBoard([
      { id: 1, name: 'Pat Pres', role: 'President', email: 'p@ysh.org', sort_order: 1 },
      { id: 2, name: 'Vic Vee', role: 'Vice-President', email: 'v@ysh.org', sort_order: 2 },
      { id: 3, name: 'Dee Pee Arr', role: 'Director of PR/Entertainment', email: 'd@ysh.org', sort_order: 3 },
    ]);
    // Roles the Council never printed still make it onto the report, verbatim.
    expect(board.map(b => b.position)).toEqual(['President', 'Vice-President', 'Director of PR/Entertainment']);
    expect(board[1]).toMatchObject({ name: 'Vic Vee', email: 'v@ysh.org', bioId: 2 });
    expect(warnings).toEqual([]);
  });

  test('keeps two bios that share a role, rather than collapsing them', () => {
    const { board } = resolveBoard([
      { id: 1, name: 'D Becker', role: 'Central Council Rep', email: 'd@ysh.org', sort_order: 1 },
      { id: 2, name: 'Brenda Hanson', role: 'Central Council Rep', email: 'b@ysh.org', sort_order: 2 },
    ]);
    expect(board).toHaveLength(2);
    expect(board.map(b => b.name)).toEqual(['D Becker', 'Brenda Hanson']);
  });

  test('trims whitespace off the role and name', () => {
    const { board } = resolveBoard([{ id: 1, name: '  Pat Pres ', role: ' President ', email: 'p@ysh.org' }]);
    expect(board[0]).toMatchObject({ position: 'President', name: 'Pat Pres' });
  });

  test('warns about a missing email, a missing role, and an empty board', () => {
    const { warnings } = resolveBoard([
      { id: 1, name: 'Pat Pres', role: 'President', email: '', sort_order: 1 },
      { id: 2, name: 'Ann Roleless', role: '', email: 'a@ysh.org', sort_order: 2 },
    ]);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Pat Pres has no email address'),
      expect.stringContaining('Ann Roleless has no role'),
    ]));
    expect(resolveBoard([]).warnings).toEqual([
      expect.stringContaining('No visible board bios'),
    ]);
  });

  test('names anyone who does not fit the ten-row board block', () => {
    const bios = Array.from({ length: councilReport.BOARD_ROWS + 2 }, (_, i) => ({
      id: i + 1, name: `Member ${i + 1}`, role: `Role ${i + 1}`, email: `m${i + 1}@ysh.org`, sort_order: i + 1,
    }));
    const { board, warnings } = resolveBoard(bios);
    expect(board).toHaveLength(councilReport.BOARD_ROWS);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining(`Member ${councilReport.BOARD_ROWS + 1}, Member ${councilReport.BOARD_ROWS + 2}`),
    ]));
  });
});

describe('field formatting', () => {
  test.each([
    ['4065551234', '(406) 555-1234'],
    ['(406) 555-1234', '(406) 555-1234'],
    ['1-406-555-1234', '(406) 555-1234'],
    ['ext 1234', 'ext 1234'],
    ['', ''],
    [null, ''],
  ])('formatPhone(%p) -> %p', (input, expected) => {
    expect(formatPhone(input)).toBe(expected);
  });

  test.each([
    ['MT', 'MT'],
    ['mt', 'MT'],
    ['Montana', 'MT'],
    ['  montana ', 'MT'],
    ['New York', 'NY'],
    // Unrecognized values pass through rather than being silently mangled.
    ['Ontario', 'Ontario'],
    ['', ''],
    [null, ''],
  ])('formatState(%p) -> %p', (input, expected) => {
    expect(councilReport.formatState(input)).toBe(expected);
  });

  test('memberSinceYear reads join_date, falls back to created_at, and handles PG Dates', () => {
    expect(memberSinceYear({ join_date: '2019-04-01', created_at: '2022-01-01' })).toBe(2019);
    expect(memberSinceYear({ created_at: '2022-01-01' })).toBe(2022);
    expect(memberSinceYear({ join_date: new Date('2021-06-15T00:00:00Z') })).toBe(2021);
    expect(memberSinceYear({})).toBeNull();
  });

  test('monthYearEndingFrom renders a period end date the way the Council writes it', () => {
    expect(monthYearEndingFrom('2026-07-31')).toBe('July 2026');
    expect(monthYearEndingFrom('')).toBe('');
  });

  test('defaultFilename stamps the period, sanitizeFilename keeps it to a safe basename', () => {
    expect(defaultFilename('2026-07-31')).toBe('Yellowstone-Sea-Hawkers-Membership-Report-2026-07.xlsx');
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd.xlsx');
    expect(sanitizeFilename('My Report')).toBe('My Report.xlsx');
    expect(sanitizeFilename('  ')).toMatch(/^Yellowstone-Sea-Hawkers-Membership-Report-\d{4}-\d{2}\.xlsx$/);
    expect(sanitizeFilename('report.xlsx')).toBe('report.xlsx');
  });

  test('memberWarnings counts missing addresses and emails', () => {
    const warnings = memberWarnings([
      buildMember(),
      buildMember({ report_street: null }),
      buildMember({ email: '' }),
    ]);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('1 member(s) have no street address'),
      expect.stringContaining('1 member(s) have no email address'),
    ]));
  });
});

describe('buildWorkbook — header, social and board blocks', () => {
  test('fills the header block, counting members as a number', async () => {
    const { xml } = await generate({ members: [buildMember(), buildMember({ last_name: 'Smith' })] });
    expect(value(xml, 'C3')).toBe('Yellowstone Sea Hawkers');
    expect(cell(xml, 'C4')).toBe('<c r="C4" s="2"><v>2</v></c>');
    expect(value(xml, 'C5')).toBe('July 2026');
    expect(value(xml, 'C6')).toBe('Jesse Wheeler');
  });

  test('inserts the social links, which the template has no cells for, in column order', async () => {
    const { xml } = await generate();
    expect(value(xml, 'B15')).toBe('Facebook');
    expect(value(xml, 'C15')).toBe('https://www.facebook.com/MontanaSeahawkers.org/');
    expect(value(xml, 'B16')).toBe('Instagram');
    expect(value(xml, 'B17')).toBe('Website');
    expect(value(xml, 'C17')).toBe('https://yellowstoneseahawkers.org/');

    const row = xml.match(/<row r="15"[\s\S]*?<\/row>/)[0];
    const order = [...row.matchAll(/<c r="([A-Z]+)15"/g)].map(m => m[1]);
    expect(order).toEqual([...order].sort());
  });

  test('writes each board member\'s own title, name and email down rows 6-15', async () => {
    const { board } = resolveBoard([
      { id: 1, name: 'Pat Pres', role: 'President', email: 'p@ysh.org', sort_order: 1 },
      { id: 2, name: 'Tia Treas', role: 'Treasurer', email: '', sort_order: 2 },
      { id: 3, name: 'Dee Pee Arr', role: 'Director of PR/Entertainment', email: 'd@ysh.org', sort_order: 3 },
    ]);
    const { xml } = await generate({ board });

    expect(value(xml, 'G6')).toBe('President');
    expect(value(xml, 'H6')).toBe('Pat Pres');
    expect(value(xml, 'I6')).toBe('p@ysh.org');
    // Row 7 was "Vice President" in the template; it now carries the second bio's title.
    expect(value(xml, 'G7')).toBe('Treasurer');
    expect(value(xml, 'H7')).toBe('Tia Treas');
    expect(cell(xml, 'I7')).toBe('<c r="I7" s="48"/>');
    // A role the Council never printed lands on row 8, replacing "Secretary".
    expect(value(xml, 'G8')).toBe('Director of PR/Entertainment');
    expect(value(xml, 'H8')).toBe('Dee Pee Arr');
  });

  test('clears the template\'s pre-printed titles on board rows it does not fill', async () => {
    const { board } = resolveBoard([{ id: 1, name: 'Pat Pres', role: 'President', email: 'p@ysh.org' }]);
    const { xml } = await generate({ board });

    // Rows 7-11 shipped with Vice President / Secretary / Treasurer / Membership / Chapter
    // Rep. Leaving them would put a title next to an empty name.
    for (const ref of ['G7', 'G8', 'G9', 'G10', 'G11']) {
      expect(value(xml, ref)).toBeNull();
    }
    // Each cleared cell keeps its own style, so the box still looks right.
    expect(cell(xml, 'G7')).toBe('<c r="G7" s="32"/>');
    expect(cell(xml, 'G11')).toBe('<c r="G11" s="33"/>');
  });

  test('fills all ten board rows when the board is full', async () => {
    const bios = Array.from({ length: councilReport.BOARD_ROWS }, (_, i) => ({
      id: i + 1, name: `Member ${i + 1}`, role: `Role ${i + 1}`, email: `m${i + 1}@ysh.org`, sort_order: i + 1,
    }));
    const { board } = resolveBoard(bios);
    const { xml } = await generate({ board });

    expect(value(xml, 'G6')).toBe('Role 1');
    expect(value(xml, `G${councilReport.BOARD_FIRST_ROW + councilReport.BOARD_ROWS - 1}`)).toBe('Role 10');
    expect(value(xml, `H${councilReport.BOARD_FIRST_ROW + councilReport.BOARD_ROWS - 1}`)).toBe('Member 10');
  });
});

describe('buildWorkbook — member rows', () => {
  test('writes a member across columns B–L starting at row 19', async () => {
    const { board } = resolveBoard([{ id: 1, name: 'John Fanzone', role: 'President', email: 'p@ysh.org', sort_order: 1 }]);
    const { xml } = await generate({ board, members: [buildMember()] });

    expect(value(xml, 'B19')).toBe('John');
    expect(value(xml, 'C19')).toBe('Fanzone');
    expect(value(xml, 'D19')).toBe('1 Main St');
    expect(value(xml, 'E19')).toBe('Billings');
    expect(value(xml, 'F19')).toBe('MT');
    expect(value(xml, 'G19')).toBe('59101');
    expect(value(xml, 'H19')).toBe('john@example.com');
    expect(value(xml, 'I19')).toBe('(406) 555-1234');
    // Primary Chapter is always Y for this chapter.
    expect(value(xml, 'J19')).toBe('Y');
    expect(cell(xml, 'K19')).toBe('<c r="K19" s="2"><v>2019</v></c>');
    // Board members are flagged in the local board position column.
    expect(value(xml, 'L19')).toBe('President');
  });

  test('maps a full state name to its code rather than truncating it', async () => {
    // "Montana".slice(0, 2) would be "MO" — Missouri. The map has to do the work.
    const { xml } = await generate({ members: [buildMember({ report_state: 'montana' })] });
    expect(value(xml, 'F19')).toBe('MT');
  });

  test('leaves cells empty rather than writing placeholders for missing data', async () => {
    const { xml } = await generate({ members: [buildMember({ report_street: null, phone: null, email: '' })] });
    expect(cell(xml, 'D19')).toBe('<c r="D19" s="2"/>');
    expect(cell(xml, 'I19')).toBe('<c r="I19" s="4"/>');
    expect(cell(xml, 'H19')).toBe('<c r="H19" s="3"/>');
  });

  test('escapes XML-significant characters and never turns text into a formula', async () => {
    const { xml, zip } = await generate({
      members: [buildMember({ last_name: 'Smith & Sons <MT>', email: '=cmd|\'/c calc\'!A1' })],
    });
    expect(cell(xml, 'C19')).toContain('Smith &amp; Sons &lt;MT&gt;');
    // Inline strings carry no <f>, so Excel stores the "=..." as literal text.
    expect(cell(xml, 'H19')).toContain('t="inlineStr"');
    expect(cell(xml, 'H19')).not.toContain('<f>');
    // The CSV apostrophe defense must not leak in here — it would corrupt the value.
    expect(value(xml, 'H19')).toBe('=cmd|\'/c calc\'!A1');
    expect(zip.file(SHEET)).toBeTruthy();
  });

  test('appends rows past the template\'s last pre-built row and widens the dimension', async () => {
    const count = LAST_TEMPLATE_ROW - councilReport.FIRST_DATA_ROW + 3;
    const members = Array.from({ length: count }, (_, i) => buildMember({ last_name: `L${i}` }));
    const { xml } = await generate({ members });

    const lastRow = councilReport.FIRST_DATA_ROW + count - 1;
    expect(xml).toContain(`<dimension ref="A1:L${lastRow}"/>`);
    expect(value(xml, `B${lastRow}`)).toBe('John');
    // Appended rows number themselves literally, so xl/calcChain.xml stays valid.
    expect(cell(xml, `A${lastRow}`)).toBe(`<c r="A${lastRow}" s="17"><v>${count}</v></c>`);
    expect(cell(xml, `A${lastRow}`)).not.toContain('<f');
  });

  test('refuses an implausibly large report instead of generating it', async () => {
    const members = Array.from({ length: councilReport.MAX_MEMBERS + 1 }, () => buildMember());
    await expect(buildWorkbook({ members, board: [] })).rejects.toThrow(/Refusing to build/);
  });
});

describe('template fidelity', () => {
  test('leaves the pre-built rows we did not write exactly as the template has them', async () => {
    const { xml } = await generate({ members: [buildMember()] });
    // Row 19 is written, so row 20 onward must be untouched — including the shared formula.
    expect(cell(xml, 'A20')).toContain('<f t="shared" ref="A20:A83" si="0">ROW()-18</f>');
    expect(cell(xml, 'B20')).toBe('<c r="B20" s="5"/>');
    expect(cell(xml, 'L20')).toBe('<c r="L20" s="21"/>');
    // Column A of a written row keeps its formula and gradient style too.
    expect(cell(xml, 'A19')).toBe('<c r="A19" s="17"><f>ROW()-18</f><v>1</v></c>');
  });

  test('keeps the Council instruction text and mandatory markers', async () => {
    const { xml } = await generate({ members: [buildMember()] });
    expect(cell(xml, 'C7')).toBe('<c r="C7" s="14" t="s"><v>16</v></c>');
    expect(cell(xml, 'A18')).toBeTruthy();
  });

  test('every other part of the workbook is byte-identical to the template', async () => {
    const { zip } = await generate({ members: [buildMember()] });
    const template = await JSZip.loadAsync(fs.readFileSync(TEMPLATE_PATH));

    const names = Object.keys(template.files).filter(name => !template.files[name].dir);
    expect(names).toContain('xl/styles.xml');
    expect(names).toContain('xl/printerSettings/printerSettings1.bin');
    expect(names).toContain('xl/calcChain.xml');

    for (const name of names) {
      expect(zip.file(name)).toBeTruthy();
      if (name === SHEET) continue;
      const before = await template.file(name).async('nodebuffer');
      const after = await zip.file(name).async('nodebuffer');
      expect(Buffer.compare(before, after)).toBe(0);
    }
    // No entries added or dropped — the other four sheets survive untouched.
    expect(Object.keys(zip.files).filter(n => !zip.files[n].dir).sort()).toEqual(names.sort());
  });

  test('the sheet keeps its merged ranges and print setup', async () => {
    const { xml } = await generate({ members: [buildMember()] });
    expect(xml).toContain('<mergeCells count="13">');
    expect(xml).toContain('<mergeCell ref="G3:J4"/>');
    expect(xml).toContain('<pageSetup paperSize="5" orientation="landscape"');
  });
});
