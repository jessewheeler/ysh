*** Settings ***
Documentation    The Sea Hawkers Central Council membership report: preview page, board
...              block resolution, and the generated .xlsx download. The report must come
...              back in the Council's own template formatting, so the download tests
...              assert on real cell values and on the template's parts being untouched.
Resource    ../resources/common.resource
Resource    ../resources/admin.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    admin    reports

*** Test Cases ***
Report Page Accessible From Admin Nav
    Login As Admin
    Click    .sidebar-nav a[href="/admin/reports/membership"]
    Get Text    h1.admin-page-title    contains    Council Membership Report

Auth Guard Redirects Report Page
    Navigate To    /admin/reports/membership
    Current URL Should Contain    /admin/login

Auth Guard Redirects Report Download
    Navigate To    /admin/reports/membership/download
    Current URL Should Contain    /admin/login

Preview Shows Enrolled Member Count
    ${period}=    Get Current Period Id
    ${one}=    Seed Member    first_name=Ren    last_name=Roster    email=ren@example.com
    ${two}=    Seed Member    first_name=Sam    last_name=Roster    email=sam@example.com
    Seed Member    first_name=Not    last_name=Enrolled    email=not@example.com
    Enroll Member    ${one}    ${period}
    Enroll Member    ${two}    ${period}
    Login As Admin
    Navigate To    /admin/reports/membership
    Get Text    table#report-summary    contains    Total member count
    Get Text    \#download-report    contains    2 members

Changing The Period Dropdown Updates The Preview
    [Documentation]    Regression: the dropdown used an inline onchange attribute, which
    ...    helmet blocks with script-src-attr 'none', so changing the period did nothing to
    ...    the preview or to the period the download used.
    ${current}=    Get Current Period Id
    ${other}=    Seed Period    label=Older Robot Season
    ${here}=    Seed Member    first_name=In    last_name=Current    email=in@example.com
    ${there}=    Seed Member    first_name=Two    last_name=Older    email=one@example.com
    ${alsothere}=    Seed Member    first_name=Three    last_name=Older    email=two@example.com
    Enroll Member    ${here}    ${current}
    Enroll Member    ${there}    ${other}
    Enroll Member    ${alsothere}    ${other}
    Login As Admin
    Navigate To    /admin/reports/membership
    Get Text    \#download-report    contains    1 member

    ${other_value}=    Convert To String    ${other}
    Select Options By    select[name="period"]    value    ${other_value}
    Wait For Elements State    \#download-report    visible    timeout=10s
    Current URL Should Contain    period=${other}
    Get Text    \#download-report    contains    2 members

Changing The Period Dropdown Changes What The Download Contains
    ${current}=    Get Current Period Id
    ${other}=    Seed Period    label=Older Robot Season
    ${here}=    Seed Member    first_name=In    last_name=Current    email=in@example.com
    ${there}=    Seed Member    first_name=Two    last_name=Older    email=one@example.com
    Enroll Member    ${here}    ${current}
    Enroll Member    ${there}    ${other}
    Login As Admin
    Navigate To    /admin/reports/membership
    ${other_value}=    Convert To String    ${other}
    Select Options By    select[name="period"]    value    ${other_value}
    Wait For Elements State    \#download-report    visible    timeout=10s
    ${file}=    Download Via Click    \#download-report
    # The workbook follows the dropdown, not the period the page first loaded with.
    Xlsx Cell Should Be    ${file}    C4    1
    Xlsx Cell Should Be    ${file}    C19    Older

The Apply Period Button Also Applies The Period
    [Documentation]    The button is the fallback if the auto-submit script ever fails, so
    ...    it has to work on its own.
    ${other}=    Seed Period    label=Older Robot Season
    ${there}=    Seed Member    first_name=Two    last_name=Older    email=one@example.com
    Enroll Member    ${there}    ${other}
    Login As Admin
    Navigate To    /admin/reports/membership?period=${other}
    Click    button#apply-period
    Wait For Elements State    \#download-report    visible    timeout=10s
    Current URL Should Contain    period=${other}
    Get Text    \#download-report    contains    1 member

Preview Lists Static Social Media Links
    Login As Admin
    Navigate To    /admin/reports/membership
    Page Should Contain Text    https://www.facebook.com/MontanaSeahawkers.org/
    Page Should Contain Text    https://www.instagram.com/yellowstone_sea_hawkers/
    Page Should Contain Text    https://yellowstoneseahawkers.org/

Preview Fills Board Block From Bio Roles
    Seed Bio    name=Pat President    role=President    email=president@example.com    sort_order=1
    Seed Bio    name=Vic Vice    role=Vice-President    email=vp@example.com    sort_order=2
    Seed Bio    name=Dee Pee Arr    role=Director of PR/Entertainment    email=pr@example.com    sort_order=3
    Login As Admin
    Navigate To    /admin/reports/membership
    # Titles the Council never pre-printed are listed as the bios have them.
    Get Text    table#report-board    contains    Vice-President
    Get Text    table#report-board    contains    Director of PR/Entertainment
    Get Text    table#report-board    contains    pr@example.com
    Get Text    table#report-summary    contains    Board members listed

Preview Hides Bios That Are Not Visible
    Seed Bio    name=Pat President    role=President    email=president@example.com    sort_order=1
    Seed Bio    name=Hidden Person    role=Historian    email=hidden@example.com    sort_order=2    is_visible=0
    Login As Admin
    Navigate To    /admin/reports/membership
    Get Text    table#report-board    contains    Pat President
    ${board}=    Get Text    table#report-board
    Should Not Contain    ${board}    Hidden Person

Preview Warns About Board Bio Missing An Email
    Seed Bio    name=Pat President    role=President    sort_order=1
    Login As Admin
    Navigate To    /admin/reports/membership
    Flash Error Should Be Visible    Pat President has no email address

Preview Warns When There Are No Visible Bios
    Login As Admin
    Navigate To    /admin/reports/membership
    Flash Error Should Be Visible    No visible board bios

Filename Field Is Prefilled And Editable
    Login As Admin
    Navigate To    /admin/reports/membership
    ${value}=    Get Property    input[name="filename"]    value
    Should Match Regexp    ${value}    ^Yellowstone-Sea-Hawkers-Membership-Report-\\d{4}-\\d{2}\\.xlsx$
    Fill Text    input[name="filename"]    Custom Council Report
    Get Property    input[name="filename"]    value    ==    Custom Council Report

Download Produces A Valid Workbook In The Council Format
    ${period}=    Get Current Period Id
    ${id}=    Seed Member    first_name=Alice    last_name=Downloader    email=alice@example.com
    ...    phone=4065551234    address_street=1 Main St    address_city=Billings
    ...    address_state=MT    address_zip=59101
    Enroll Member    ${id}    ${period}
    Seed Bio    name=Pat President    role=President    email=president@example.com    sort_order=1
    Login As Admin
    Navigate To    /admin/reports/membership
    ${file}=    Download Via Click    \#download-report

    Xlsx Should Be A Valid Workbook    ${file}
    ${sheets}=    Get Xlsx Sheet Names    ${file}
    Should Be Equal    ${sheets}[0]    NATIONAL
    Length Should Be    ${sheets}    5

Download Fills The Header And Board Blocks
    ${period}=    Get Current Period Id
    ${id}=    Seed Member    first_name=Alice    last_name=Downloader    email=alice@example.com
    Enroll Member    ${id}    ${period}
    Seed Bio    name=Pat President    role=President    email=president@example.com    sort_order=1
    Login As Admin
    Navigate To    /admin/reports/membership
    ${file}=    Download Via Click    \#download-report

    Xlsx Cell Should Be    ${file}    C3    Yellowstone Sea Hawkers
    Xlsx Cell Should Be    ${file}    C4    1
    Xlsx Cell Should Be    ${file}    C6    Test Admin
    Xlsx Cell Should Be    ${file}    G6    President
    Xlsx Cell Should Be    ${file}    H6    Pat President
    Xlsx Cell Should Be    ${file}    I6    president@example.com
    # Only one bio, so the Council's other five pre-printed titles are cleared.
    Xlsx Cell Should Be    ${file}    G7    ${EMPTY}
    Xlsx Cell Should Be    ${file}    G11    ${EMPTY}
    Xlsx Cell Should Be    ${file}    H8    ${EMPTY}
    Xlsx Cell Should Be    ${file}    B15    Facebook
    Xlsx Cell Should Be    ${file}    C15    https://www.facebook.com/MontanaSeahawkers.org/
    Xlsx Cell Should Be    ${file}    C17    https://yellowstoneseahawkers.org/

Download Writes Each Member As Their Own Row
    ${period}=    Get Current Period Id
    ${first}=    Seed Member    first_name=Alice    last_name=Aardvark    email=alice@example.com
    ...    phone=4065551234    address_street=1 Main St    address_city=Billings
    ...    address_state=MT    address_zip=59101
    ${second}=    Seed Member    first_name=Bob    last_name=Bobson    email=bob@example.com
    ...    phone=4065559999    address_street=2 Elm St    address_city=Laurel
    ...    address_state=MT    address_zip=59044
    Enroll Member    ${first}    ${period}
    Enroll Member    ${second}    ${period}
    Login As Admin
    Navigate To    /admin/reports/membership
    ${file}=    Download Via Click    \#download-report

    ${rows}=    Get Xlsx Data Rows    ${file}
    Length Should Be    ${rows}    2
    # Sorted by last name, and the phone is formatted the way the Council's column expects.
    Should Be Equal    ${rows}[0][0]    Alice
    Should Be Equal    ${rows}[0][1]    Aardvark
    Should Be Equal    ${rows}[0][2]    1 Main St
    Should Be Equal    ${rows}[0][3]    Billings
    Should Be Equal    ${rows}[0][4]    MT
    Should Be Equal    ${rows}[0][5]    59101
    Should Be Equal    ${rows}[0][6]    alice@example.com
    Should Be Equal    ${rows}[0][7]    (406) 555-1234
    Should Be Equal    ${rows}[1][1]    Bobson

Download Marks Every Member As Primary Chapter Y
    ${period}=    Get Current Period Id
    ${first}=    Seed Member    first_name=Alice    last_name=Aardvark    email=alice@example.com
    ${second}=    Seed Member    first_name=Bob    last_name=Bobson    email=bob@example.com
    Enroll Member    ${first}    ${period}
    Enroll Member    ${second}    ${period}
    Login As Admin
    Navigate To    /admin/reports/membership
    ${file}=    Download Via Click    \#download-report

    Xlsx Cell Should Be    ${file}    J19    Y
    Xlsx Cell Should Be    ${file}    J20    Y

Download Flags A Board Member In Their Own Row
    ${period}=    Get Current Period Id
    ${id}=    Seed Member    first_name=Pat    last_name=President    email=pat@example.com
    Enroll Member    ${id}    ${period}
    Seed Bio    name=Pat President    role=Director of PR/Entertainment    email=president@example.com    sort_order=1
    Login As Admin
    Navigate To    /admin/reports/membership
    ${file}=    Download Via Click    \#download-report
    Xlsx Cell Should Be    ${file}    L19    Director of PR/Entertainment

Download Writes Board Titles Verbatim Down Rows 6 To 15
    Seed Bio    name=Pat President    role=President    email=president@example.com    sort_order=1
    Seed Bio    name=Vic Vice    role=Vice-President    email=vp@example.com    sort_order=2
    Seed Bio    name=Dee Becker    role=Central Council Rep    email=d@example.com    sort_order=3
    Seed Bio    name=Bee Hanson    role=Central Council Rep    email=b@example.com    sort_order=4
    Login As Admin
    Navigate To    /admin/reports/membership
    ${file}=    Download Via Click    \#download-report

    Xlsx Cell Should Be    ${file}    G6    President
    Xlsx Cell Should Be    ${file}    G7    Vice-President
    # Two people can hold the same title; neither is dropped.
    Xlsx Cell Should Be    ${file}    G8    Central Council Rep
    Xlsx Cell Should Be    ${file}    H8    Dee Becker
    Xlsx Cell Should Be    ${file}    G9    Central Council Rep
    Xlsx Cell Should Be    ${file}    H9    Bee Hanson
    Xlsx Cell Should Be    ${file}    G10    ${EMPTY}

Download Honours Edited Header Fields
    ${period}=    Get Current Period Id
    ${id}=    Seed Member    first_name=Alice    last_name=Downloader    email=alice@example.com
    Enroll Member    ${id}    ${period}
    Login As Admin
    Navigate To    /admin/reports/membership
    Fill Text    input[name="chapter_name"]    Yellowstone Sea Hawkers Chapter
    Fill Text    input[name="month_year"]    December 2026
    Fill Text    input[name="submitted_by"]    Robot Reporter
    ${file}=    Download Via Click    \#download-report

    Xlsx Cell Should Be    ${file}    C3    Yellowstone Sea Hawkers Chapter
    Xlsx Cell Should Be    ${file}    C5    December 2026
    Xlsx Cell Should Be    ${file}    C6    Robot Reporter

Download Preserves The Council Template Formatting Exactly
    [Documentation]    Every part of the workbook except the NATIONAL sheet must be
    ...    byte-identical to the committed template — styles, theme, print settings and
    ...    the other four Council tabs. This is the guard on "exact formatting".
    ${period}=    Get Current Period Id
    ${id}=    Seed Member    first_name=Alice    last_name=Downloader    email=alice@example.com
    Enroll Member    ${id}    ${period}
    Login As Admin
    Navigate To    /admin/reports/membership
    ${file}=    Download Via Click    \#download-report
    Xlsx Should Match Template Formatting    ${file}    ${REPORT_TEMPLATE}

Download Works For A Period With Nobody Enrolled
    Login As Admin
    Navigate To    /admin/reports/membership
    Get Text    \#download-report    contains    0 members
    ${file}=    Download Via Click    \#download-report
    Xlsx Should Be A Valid Workbook    ${file}
    Xlsx Cell Should Be    ${file}    C4    0
    Xlsx Cell Should Be    ${file}    B19    ${EMPTY}

Bio Form Saves A Council Board Email
    Login As Admin
    Navigate To    /admin/bios/new
    Fill Text    input[name="name"]    Robot Treasurer
    Fill Text    input[name="role"]    Assistant Treasurer
    Fill Text    input[name="email"]    treasurer@example.com
    Submit Admin Form
    Flash Success Should Be Visible    created
    ${rows}=    Query Sql    SELECT name, role, email FROM bios WHERE name = 'Robot Treasurer'
    Should Be Equal    ${rows}[0][email]    treasurer@example.com
    # And it immediately reaches the report's board block.
    Navigate To    /admin/reports/membership
    Get Text    body    contains    treasurer@example.com
