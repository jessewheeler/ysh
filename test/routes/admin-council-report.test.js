jest.mock('../../db/database', () => require('../helpers/setupDb'));

const JSZip = require('jszip');
const db = require('../../db/database');
const { insertMember, insertPeriod, insertFamilyMembership } = require('../helpers/fixtures');
const membershipYearsRepo = require('../../db/repos/membershipYears');
const biosRepo = require('../../db/repos/bios');
const councilReport = require('../../services/councilReport');

// Like the CSV export tests, this exercises the download pipeline directly rather than
// booting Express with sessions — the route is a thin wrapper over these calls.

beforeEach(() => {
  db.__resetTestDb();
});

async function enroll(memberId, periodId) {
  await membershipYearsRepo.enroll(memberId, periodId, null);
}

describe('membership report download pipeline', () => {
  test('produces a workbook for everyone enrolled in the period', async () => {
    const period = insertPeriod(db, { end_date: '2026-07-31' });
    const alice = insertMember(db, {
      email: 'alice@test.com', first_name: 'Alice', last_name: 'Smith', phone: '4065551234'
    });
    const { primary, familyMembers } = insertFamilyMembership(db);
    await enroll(alice.id, period.id);
    await enroll(primary.id, period.id);

    await biosRepo.create({ name: 'Pat Pres', role: 'President', email: 'president@ysh.org', is_visible: true, sort_order: 1 });

    const members = await membershipYearsRepo.listMembersByPeriod(period.id);
    const { board, warnings } = councilReport.resolveBoard(await biosRepo.findAll());

    const buffer = await councilReport.buildWorkbook({
      chapterName: councilReport.DEFAULT_CHAPTER_NAME,
      monthYearEnding: councilReport.monthYearEndingFrom(period.end_date),
      submittedBy: 'Jesse Wheeler',
      board,
      members,
    });

    // A real .xlsx: zip magic, and the NATIONAL sheet reflects the enrolled roster.
    expect(buffer.slice(0, 2).toString('latin1')).toBe('PK');
    const xml = await (await JSZip.loadAsync(buffer)).file('xl/worksheets/sheet1.xml').async('string');
    expect(xml).toContain(`<c r="C4" s="2"><v>${2 + familyMembers.length}</v></c>`);
    expect(xml).toContain('July 2026');
    expect(xml).toContain('president@ysh.org');
    expect(xml).toContain('Alice');
    // Every family member is listed separately, as the Council requires.
    for (const fm of familyMembers) expect(xml).toContain(fm.first_name);
    // The board block carries the bio's own role, and the Council's other pre-printed
    // titles are cleared so none is left next to an empty name.
    expect(xml).toContain('<c r="G6" s="32" t="inlineStr"><is><t xml:space="preserve">President</t></is></c>');
    expect(xml).toContain('<c r="G9" s="33"/>');
    expect(warnings).toEqual([]);
  });

  test('serves the expected content type and a safe filename', () => {
    expect(councilReport.CONTENT_TYPE)
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(councilReport.sanitizeFilename(councilReport.defaultFilename('2026-07-31')))
      .toBe('Yellowstone-Sea-Hawkers-Membership-Report-2026-07.xlsx');
    // A filename from the form can't escape the header or the directory.
    expect(councilReport.sanitizeFilename('../../etc/passwd')).toBe('passwd.xlsx');
    expect(councilReport.sanitizeFilename('a"b;c')).toBe('ab;c.xlsx');
  });

  test('still builds a valid workbook for a period with nobody enrolled', async () => {
    const period = insertPeriod(db);
    const members = await membershipYearsRepo.listMembersByPeriod(period.id);
    expect(members).toEqual([]);

    const buffer = await councilReport.buildWorkbook({ board: [], members });
    const xml = await (await JSZip.loadAsync(buffer)).file('xl/worksheets/sheet1.xml').async('string');
    // Zero is a legitimate count to report, and the template is otherwise intact.
    expect(xml).toContain('<c r="C4" s="2"><v>0</v></c>');
    expect(xml).toContain('<mergeCells count="13">');
  });
});
