*** Settings ***
Resource    ../resources/common.resource
Resource    ../resources/admin.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    admin    members

*** Test Cases ***
Members List Accessible
    Login As Admin
    Navigate To    /admin/members
    Get Text    h1.admin-page-title    contains    Members

Create New Member
    Login As Admin
    Navigate To    /admin/members/new
    Fill Text    input[name="first_name"]    Robot
    Fill Text    input[name="last_name"]    Created
    Fill Text    input[name="email"]    robot.created@example.com
    Fill Text    input[name="phone"]    4065559999
    Fill Text    input[name="address_street"]    123 Test St
    Fill Text    input[name="address_city"]    Billings
    Fill Text    input[name="address_state"]    MT
    Fill Text    input[name="address_zip"]    59101
    Fill Text    input[name="membership_year"]    2026
    Select Options By    select[name="status"]    value    active
    Fill Text    textarea[name="notes"]    Created by robot test
    Submit Admin Form
    Flash Success Should Be Visible    created
    Get Text    .admin-table    contains    Robot Created

View Member Details
    ${id}=    Seed Member    first_name=View    last_name=Testmember    email=view@example.com    member_number=YSH-2026-9001
    Login As Admin
    Navigate To    /admin/members/${id}
    Get Text    .detail-table    contains    View Testmember
    Get Text    .detail-table    contains    view@example.com
    Get Text    .detail-table    contains    YSH-2026-9001

Generate Renewal Link
    [Documentation]    Clicks the real button rather than posting to the route directly. The copy
    ...    control is wired in public/js/admin.js because helmet's script-src-attr 'none' kills
    ...    inline handlers silently, so only a real click proves the panel works.
    ${id}=    Seed Member    first_name=Rita    last_name=Renewer    email=rita@example.com
    Login As Admin
    Navigate To    /admin/members/${id}
    Click    button >> text=Generate Renewal Link
    Flash Success Should Be Visible    Renewal link generated
    Wait For Elements State    input#renewal-link    visible    timeout=10s
    ${url}=    Get Property    input#renewal-link    value
    Should Match Regexp    ${url}    /renew/[a-f0-9]{64}$
    Wait For Elements State    button#copy-renewal-link    visible    timeout=10s

Delete Member
    ${id}=    Seed Member    first_name=Delete    last_name=Me    email=delete@example.com
    Login As Admin
    Navigate To    /admin/members/${id}
    Handle Future Dialogs    action=accept
    Click    button.btn-danger
    Flash Success Should Be Visible    deleted
    ${count}=    Get Row Count    members
    Should Be Equal As Integers    ${count}    1    # 1 = the admin user (admins are now members)

Members Search
    Seed Member    first_name=Alice    last_name=Findable    email=alice@example.com
    Seed Member    first_name=Bob    last_name=Hidden    email=bob@example.com
    Login As Admin
    Navigate To    /admin/members
    Fill Text    input[name="search"]    Alice
    Click    .search-form button[type="submit"]
    Get Text    .admin-table    contains    Alice Findable
    ${page_text}=    Get Text    .admin-table
    Should Not Contain    ${page_text}    Bob Hidden

Edit Member Form Loads Without Error
    [Documentation]    Navigating to the edit form must render the form, not a 500.
    ...    Regression for: edit on member profile throws 500 when join_date is a
    ...    PostgreSQL Date object instead of a plain string.
    ${id}=    Seed Member    first_name=Editable    last_name=Member    email=editable@example.com
    Login As Admin
    Navigate To    /admin/members/${id}?edit=1
    Wait For Elements State    input[name="first_name"]    visible    timeout=10s
    Get Text    h1.admin-page-title    contains    Edit Member

Edit Member Updates Fields
    ${id}=    Seed Member    first_name=Before    last_name=Edit    email=before.edit@example.com
    Login As Admin
    Navigate To    /admin/members/${id}?edit=1
    Wait For Elements State    input[name="first_name"]    visible    timeout=10s
    Fill Text    input[name="first_name"]    After
    Submit Admin Form
    Flash Success Should Be Visible    updated
    Get Text    .detail-table    contains    After Edit

Needs Attention Pill Filters The List
    [Documentation]    Drives the pill itself rather than navigating to ?view=needs-attention,
    ...    because a URL-only test passes even when the pill is broken.
    ${flagged}=    Seed Member    first_name=Dana    last_name=Declined    email=declined@example.com    status=pending
    Seed Payment    ${flagged}    status=failed
    ${clean}=    Seed Member    first_name=Casey    last_name=Clean    email=clean@example.com    status=active
    ${period}=    Get Current Period Id
    Enroll Member    ${clean}    ${period}
    Seed Payment    ${clean}    status=completed
    Login As Admin
    Navigate To    /admin/members
    Click    .view-pill >> text=Needs attention
    Wait For Elements State    .admin-table    visible    timeout=10s
    Get Text    .admin-table    contains    Dana Declined
    Get Text    .badge-attention    contains    Payment failed
    ${page_text}=    Get Text    .admin-table
    Should Not Contain    ${page_text}    Casey Clean

Needs Attention Signal Select Auto Submits
    [Documentation]    Changes the select and asserts the table updated with NO further
    ...    click. helmet sends script-src-attr 'none', so an inline onchange would never
    ...    fire and would fail silently — this is the regression guard for that.
    ${declined}=    Seed Member    first_name=Dana    last_name=Declined    email=declined@example.com    status=pending
    Seed Payment    ${declined}    status=failed
    # Lapsed rather than paid up — members in good standing are excluded from the list.
    ${bounced}=    Seed Member    first_name=Boris    last_name=Bounced    email=bounced@example.com    status=active    expiry_date=2020-01-01
    Seed Email Log    ${bounced}    email_type=card_delivery    status=failed
    Login As Admin
    Navigate To    /admin/members
    Click    .view-pill >> text=Needs attention
    Wait For Elements State    select[name="signal"]    visible    timeout=10s
    Get Text    .admin-table    contains    Boris Bounced
    Select Options By    select[name="signal"]    value    payment_failed
    Wait For Elements State    .admin-table    visible    timeout=10s
    Get Text    .admin-table    contains    Dana Declined
    ${page_text}=    Get Text    .admin-table
    Should Not Contain    ${page_text}    Boris Bounced

Needs Attention Export Includes Signals
    ${flagged}=    Seed Member    first_name=Dana    last_name=Declined    email=declined@example.com    status=pending
    Seed Payment    ${flagged}    status=failed
    Login As Admin
    Navigate To    /admin/members
    Click    .view-pill >> text=Needs attention
    Wait For Elements State    .admin-table    visible    timeout=10s
    ${path}=    Download Via Click    .toolbar-actions a.btn-outline    filename=members.csv
    ${csv}=    Get File    ${path}
    Should Contain    ${csv}    Signals
    Should Contain    ${csv}    Stripe reported a failed payment
    Should Contain    ${csv}    declined@example.com

Record Offline Payment Disclosure Reveals The Form
    [Documentation]    Operates the <details> control itself. The "hidden" assertion first is
    ...    load-bearing: a test that only fills the form passes just as well when the
    ...    disclosure is stuck open or absent entirely. Also pins the dues prefill, which the
    ...    route computed but the template never used.
    Seed Period
    ${id}=    Seed Member    first_name=Owen    last_name=Offline    email=owen@example.com    status=pending
    Login As Admin
    Navigate To    /admin/members/${id}
    Wait For Elements State    input#amount    hidden    timeout=10s
    Click    summary >> text=Record Offline Payment
    Wait For Elements State    input#amount    visible    timeout=10s
    ${amount}=    Get Property    input#amount    value
    Should Match Regexp    ${amount}    ^\\d+\\.\\d{2}$
    Fill Text    input#amount    25.00
    Click    form#record-payment button[type="submit"]
    Flash Success Should Be Visible    recorded
    Get Text    table#member-payments    contains    25.00

Add Family Member Disclosure Reveals The Form
    [Documentation]    Same shape as the offline-payment disclosure: assert hidden, operate the
    ...    control, then submit through it.
    ${id}=    Seed Member    first_name=Fran    last_name=Primary    email=fran@example.com    membership_type=family
    Login As Admin
    Navigate To    /admin/members/${id}
    Wait For Elements State    input#fm_first_name    hidden    timeout=10s
    Click    summary >> text=Add Family Member
    Wait For Elements State    input#fm_first_name    visible    timeout=10s
    Fill Text    input#fm_first_name    Kid
    Fill Text    input#fm_last_name    Primary
    Fill Text    input#fm_email    kid@example.com
    Click    form#add-family-member button[type="submit"]
    Flash Success Should Be Visible    Family member Kid Primary added
    Get Text    .detail-table    contains    Kid Primary

Attach To Family Disclosure Reveals The Form
    ${primary}=    Seed Member    first_name=Hank    last_name=Household    email=hank@example.com    membership_type=family
    ${solo}=    Seed Member    first_name=Sam    last_name=Solo    email=sam@example.com
    Login As Admin
    Navigate To    /admin/members/${solo}
    Wait For Elements State    select#primary_member_id    hidden    timeout=10s
    Click    summary >> text=Attach to Family
    Wait For Elements State    select#primary_member_id    visible    timeout=10s
    ${primary_value}=    Convert To String    ${primary}
    Select Options By    select#primary_member_id    value    ${primary_value}
    Click    form#attach-family button[type="submit"]
    Flash Success Should Be Visible    attached to Hank Household's family
    Get Text    .detail-table    contains    Hank Household

Failed Offline Payment Reopens The Disclosure
    [Documentation]    A red banner above a collapsed control would be worse than the old
    ...    always-expanded form, so a validation failure re-opens the panel it came from.
    ${id}=    Seed Member    first_name=Bad    last_name=Amount    email=bad@example.com
    Login As Admin
    Navigate To    /admin/members/${id}
    Click    summary >> text=Record Offline Payment
    Wait For Elements State    input#amount    visible    timeout=10s
    # The input carries min="0.01", so the browser refuses to submit and the server-side
    # branch under test is never reached. Disable client validation for this submit only.
    Evaluate JavaScript    form#record-payment    (f) => { f.noValidate = true; }
    Fill Text    input#amount    0
    Click    form#record-payment button[type="submit"]
    Flash Error Should Be Visible    valid payment amount
    Wait For Elements State    input#amount    visible    timeout=10s

Member Actions Sit On One Row
    [Documentation]    The buttons used to be wrapped in style="display:inline", which kept them
    ...    out of the flex line and split them across two ragged rows. Asserts they share a
    ...    single row at desktop width.
    ${id}=    Seed Member    first_name=Row    last_name=Aligned    email=row@example.com
    Login As Admin
    Set Viewport Size    1440    900
    Navigate To    /admin/members/${id}
    ${rows}=    Evaluate JavaScript    ${None}
    ...    () => new Set([...document.querySelectorAll('.record-actionbar button, .record-actionbar a.btn')].map(el => Math.round(el.getBoundingClientRect().top))).size
    Should Be Equal As Integers    ${rows}    1
