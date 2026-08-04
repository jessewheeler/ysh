# Council Membership Report

The Sea Hawkers Central Council collects chapter rosters on a fixed Excel workbook,
`MASTER Chapter Membership Reporting.xlsx`. The admin site fills in the NATIONAL tab of
that workbook from our own data and hands it back with the Council's formatting intact,
so the downloaded file can be submitted without editing.

Any admin can generate the report. Super admin is not required.

## Generating the report

1. Click **Reports** in the sidebar.
2. Pick the **membership period** you are reporting on. The list defaults to the current
   season.
3. Read the preview: the member count, the board block, and any warnings.
4. Adjust **Chapter name**, **Month/year ending**, **Submitted by**, and **File name** if
   you need to. All four are prefilled.
5. Click **Download .xlsx**.

Open the file before sending it. The report is generated from whatever is in the database
at that moment, so the preview and the workbook always agree, but only a person can tell
whether the roster itself looks right.

## What goes in each part of the workbook

| Workbook cell | Filled with |
|---------------|-------------|
| Chapter name | The value in the form, defaulting to "Yellowstone Sea Hawkers" |
| Total member count | The number of member rows written |
| Month/year ending | The value in the form, defaulting to the period's end month, e.g. "July 2026" |
| Submitted by | Your name, from your admin record |
| Social media block | Our Facebook, Instagram, and website links, which are fixed in the code |
| Board block | Titles, names, and emails from the visible board bios |
| Member rows | One row per person, starting on row 19 |

Each member row carries first and last name, street address, city, state, ZIP, email,
phone, "Y" in the Primary Chapter column, the year they joined, and their board position
if they hold one. Primary Chapter is always "Y" for this chapter.

## Who appears on the report

Everyone enrolled in the selected period, plus the family members of anyone enrolled.
Cancelled members are left off.

The Council requires each person on their own numbered row and specifically forbids
grouping entries with notes like "see above" or "w/ John". Family members are therefore
listed individually, and a family member with no address of their own inherits the
primary member's street, city, state, ZIP, and phone. Their email is not inherited: two
rows sharing one email address invites the Council to treat a family as a single person.

## The board block

Every visible board bio goes in the block, in bio sort order, with the **Role** from the
bio written into the Position column as-is. "Vice-President", "Central Council Rep", and
"Director of PR/Entertainment" all appear exactly as they are saved.

The Council's template ships with six titles pre-printed down that column: President, Vice
President, Secretary, Treasurer, Membership, Chapter Rep. Those are overwritten with our
own titles, and any row we do not fill has its label cleared, so no title is ever left
sitting next to an empty name.

Two people can hold the same title. Both are listed.

The block has room for ten people. Past that, the extras are named in a warning and left
off, because the Council's box has nowhere to put them. Hide a bio or raise its sort order
to control who makes the cut.

Board emails come from the **Email** field on the bio. Fill it in for everyone on the
board; the Council marks the block mandatory. To fix a missing email or a missing role, go
to **Board Bios** and edit the person. The report page links straight to the bio in both
cases.

Hidden bios are left off. The report lists the same people the public Bios page does.

## Warnings on the report page

The preview lists anything worth checking before you submit. None of them block the
download.

| Warning | What to do |
|---------|------------|
| Name has no email address on their bio | Add an email to their bio |
| Name has no role on their bio | Add a role, or accept a blank Position cell |
| No visible board bios | Make at least one board bio visible |
| The board block holds 10 people; Name, Name did not fit | Hide a bio, or reorder with sort order |
| N member(s) have no street address | Fill in the addresses, or submit with blank cells |
| N member(s) have no email address | Same |

## File name

The field is prefilled as
`Yellowstone-Sea-Hawkers-Membership-Report-2026-07.xlsx`, using the reporting period's
year and month. Type over it if the Council asks for a different name. Anything that
would make an unsafe file name is stripped, and the `.xlsx` extension is always added.

## Notes

The workbook you download is a copy of the Council's own file with values dropped into
it. Column widths, colors, borders, the numbered rows, the print setup, and the other
four tabs (INTERNATIONAL, Sheet3, Sheet4, Sheet5) are byte-for-byte the Council's. The
"Local Chapter Board Position" column is hidden in the Council's template, so it is
filled in but will not show until you unhide column L.

The template pre-numbers 2500 member rows. Past that, extra rows are added and the
report page says so.
