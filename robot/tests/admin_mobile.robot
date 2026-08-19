*** Settings ***
Documentation     Phone-width layout guards for the admin UI.
...
...               The other suites all run at Playwright's default 1280x720, so nothing
...               exercised the @media (max-width: 768px) rules. That is how the admin
...               shipped with tables wide enough to overflow the *document* — with no
...               scroll container, the whole page scrolled sideways, which made the panels
...               look off-centre with a grey strip down the left even though they were
...               centred. These tests fail on that layout.
Resource          ../resources/common.resource
Resource          ../resources/admin.resource
Suite Setup       Start Test Server
Suite Teardown    Stop Test Server
Test Setup        Reset Test State
Force Tags        admin    mobile

*** Variables ***
${PHONE_WIDTH}     390
${PHONE_HEIGHT}    844
@{ADMIN_PATHS}     /admin/dashboard    /admin/members    /admin/members/new
...                /admin/announcements    /admin/gallery    /admin/bios
...                /admin/payments    /admin/emails    /admin/emails/renewal
...                /admin/reports/membership    /admin/campaigns
...                /admin/contact-submissions    /admin/periods    /admin/settings
...                /admin/admins    /admin/audit

*** Test Cases ***
Members List Fits A Phone
    ${id}=    Seed Member    Danette    Sawin    danette.sawin@example.com
    Login As Admin
    Use Phone Viewport
    Navigate To    /admin/members
    Page Should Not Scroll Sideways

Needs Attention View Fits A Phone
    [Documentation]    The widest list in the app: the Signals column makes it eight columns.
    ...    A failed payment on a pending member is what puts a row in this view at all —
    ...    without one the table is not rendered and the test would pass on an empty page.
    ${id}=    Seed Member    first_name=Dana    last_name=Declined    email=declined@example.com    status=pending
    Seed Payment    ${id}    status=failed
    Login As Admin
    Use Phone Viewport
    Navigate To    /admin/members?view=needs-attention
    Wait For Elements State    .badge-attention    visible    timeout=10s
    Page Should Not Scroll Sideways

Member Record Fits A Phone
    ${id}=    Seed Member    Danette    Sawin    danette.sawin@example.com
    ...    address_street=419 Wood Duck Drive    address_city=Park City    address_zip=59063
    Seed Payment    ${id}    amount_cents=5600
    ${period}=    Get Current Period Id
    Enroll Member    ${id}    ${period}
    Seed Email Log    ${id}
    Login As Admin
    Use Phone Viewport
    Navigate To    /admin/members/${id}
    Page Should Not Scroll Sideways

Payments List Fits A Phone
    ${id}=    Seed Member    Danette    Sawin    danette.sawin@example.com
    Seed Payment    ${id}    amount_cents=5600
    Login As Admin
    Use Phone Viewport
    Navigate To    /admin/payments
    Page Should Not Scroll Sideways

Audit Log Fits A Phone
    [Documentation]    The audit table opts out of the card layout, so its own
    ...    .table-responsive wrapper has to keep the scrolling off the document.
    Seed Member    Danette    Sawin    danette.sawin@example.com
    Login As Admin
    Use Phone Viewport
    Navigate To    /admin/audit
    Page Should Not Scroll Sideways

Table Rows Carry Their Column Labels
    [Documentation]    public/js/admin.js copies the thead into data-label, which
    ...    td::before renders as the row label once the table is laid out as cards.
    ${id}=    Seed Member    Danette    Sawin    danette.sawin@example.com
    Seed Payment    ${id}    amount_cents=5600
    Login As Admin
    Use Phone Viewport
    Navigate To    /admin/members/${id}
    ${label}=    Get Attribute    css=#member-payments tbody tr:first-child td:nth-child(1)    data-label
    Should Be Equal    ${label}    Amount
    ${label}=    Get Attribute    css=#member-payments tbody tr:first-child td:nth-child(5)    data-label
    Should Be Equal    ${label}    Date

Sort Indicators Are Stripped From The Labels
    [Documentation]    members/list.pug's sortTh appends an arrow to the active column, and
    ...    it must not end up in the card label.
    Seed Member    Danette    Sawin    danette.sawin@example.com
    Login As Admin
    Use Phone Viewport
    Navigate To    /admin/members?sort=name&dir=asc
    ${label}=    Get Attribute    .admin-table tbody tr:first-child td:nth-child(2)    data-label
    Should Be Equal    ${label}    Name

Every Admin Page Fits A Phone
    [Documentation]    A sweep, so a table added to any admin page cannot quietly reintroduce
    ...    the document-level sideways scroll. Every list is seeded first: an empty table is
    ...    not rendered at all, and this would pass on the empty state.
    ${id}=    Seed Member    first_name=Danette    last_name=Sawin    email=danette.sawin@example.com
    ...    address_street=419 Wood Duck Drive    address_city=Park City    address_zip=59063
    Seed Payment    ${id}    amount_cents=5600
    Seed Email Log    ${id}
    ${period}=    Get Current Period Id
    Enroll Member    ${id}    ${period}
    Seed Announcements    2
    Seed Bios    2
    Seed Gallery    2
    Seed Campaign
    Login As Admin
    Use Phone Viewport
    FOR    ${path}    IN    @{ADMIN_PATHS}
        Navigate To    ${path}
        # The error page does not extend the admin layout, so this also catches a path in
        # the list above that has stopped resolving — otherwise the sweep would measure a
        # 404 and happily report that it fits.
        Wait For Elements State    .admin-page-title    visible    timeout=10s
        Page Should Not Scroll Sideways    ${path}
    END

*** Keywords ***
Use Phone Viewport
    Set Viewport Size    ${PHONE_WIDTH}    ${PHONE_HEIGHT}

Page Should Not Scroll Sideways
    [Documentation]    scrollWidth against clientWidth, not innerWidth: clientWidth already
    ...    excludes the vertical scrollbar, so the difference is the real overflow.
    [Arguments]    ${where}=${EMPTY}
    ${overflow}=    Evaluate JavaScript    ${None}
    ...    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    Should Be True    ${overflow} <= 1
    ...    ${where} overflows its viewport by ${overflow}px at ${PHONE_WIDTH}px wide
