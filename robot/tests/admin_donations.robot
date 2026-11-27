*** Settings ***
Documentation     Admin side of donations (issue #126): the Donations page, fund management, and
...               the donation history table on the member page.
Resource          ../resources/admin.resource
Suite Setup       Start Test Server
Suite Teardown    Stop Test Server
Test Setup        Reset Test State
Force Tags        admin    donate

*** Test Cases ***
Donations Page Shows Totals Funds And Anonymous Donors
    ${wheels}=    Get Donation Fund Id    Heart Wheels
    ${general}=    Get Donation Fund Id    General Fund
    Seed Donation    ${wheels}    gift_cents=1200    fee_cover_cents=67    donor_name=Named Nancy
    Seed Donation    ${wheels}    gift_cents=2500    is_anonymous=1
    Seed Donation    ${general}    gift_cents=9900    status=pending    donor_name=Pending Pat
    Login As Admin
    Click    nav.sidebar-nav a[href="/admin/donations"]
    Current URL Should Contain    /admin/donations
    Get Text    id=donations-count    ==    2
    Get Text    id=donations-gifts    ==    $37
    Get Text    id=donations-fee-cover    ==    $0.67
    Get Text    id=donations-fee-absorbed    ==    $1.03
    Get Text    id=donations-by-fund    contains    Heart Wheels
    Get Text    id=donations-list    contains    Named Nancy
    Get Text    id=donations-list    contains    Anonymous
    Get Text    id=donations-list    contains    Pending Pat

Dashboard Shows A Donations Card After The First Donation
    ${general}=    Get Donation Fund Id    General Fund
    Seed Donation    ${general}    gift_cents=1200
    Login As Admin
    Get Text    a.stat-card[href="/admin/donations"]    contains    $12
    Click    a.stat-card[href="/admin/donations"]
    Current URL Should Contain    /admin/donations

Super Admin Adds A Fund And It Appears On The Donate Page
    Login As Admin
    Navigate To    /admin/donations
    Click    text=Manage Funds
    Current URL Should Contain    /admin/donations/funds
    Fill Text    id=new-fund-name    Turkey Drive
    Click    form#new-fund-form button[type="submit"]
    Flash Success Should Be Visible    Turkey Drive
    ${fund}=    Get Donation Fund Id    Turkey Drive
    Get Text    tr[data-fund-id="${fund}"] .badge    ==    Active
    Navigate To    /donate
    Get Text    select[name="fund_id"]    contains    Turkey Drive

Renaming A Fund Changes The Donate Page
    ${fund}=    Get Donation Fund Id    General Fund
    Login As Admin
    Navigate To    /admin/donations/funds
    Fill Text    id=fund-name-${fund}    Where Needed Most
    Click    tr[data-fund-id="${fund}"] form.fund-form button[type="submit"]
    Flash Success Should Be Visible    Where Needed Most
    Navigate To    /donate
    Get Text    select[name="fund_id"]    contains    Where Needed Most

Retiring A Fund Removes It From The Donate Page And Keeps Its Donations
    ${fund}=    Get Donation Fund Id    Heart Wheels
    Seed Donation    ${fund}    gift_cents=1200
    Login As Admin
    Navigate To    /admin/donations/funds
    # Retire carries data-confirm; Playwright dismisses dialogs unless told otherwise.
    Handle Future Dialogs    action=accept
    Click    tr[data-fund-id="${fund}"] form.inline-form button[type="submit"]
    Flash Success Should Be Visible    retired
    Get Text    tr[data-fund-id="${fund}"] .badge    ==    Retired
    Navigate To    /donate
    ${options}=    Get Element Count    select[name="fund_id"] option
    Should Be Equal As Integers    ${options}    3
    Get Text    select[name="fund_id"]    not contains    Heart Wheels
    Navigate To    /admin/donations
    Get Text    id=donations-by-fund    contains    Heart Wheels
    Get Text    id=donations-by-fund    contains    $12.00

Cancelling The Retire Confirmation Leaves The Fund Active
    ${fund}=    Get Donation Fund Id    Heart Wheels
    Login As Admin
    Navigate To    /admin/donations/funds
    Handle Future Dialogs    action=dismiss
    Click    tr[data-fund-id="${fund}"] form.inline-form button[type="submit"]
    Get Text    tr[data-fund-id="${fund}"] .badge    ==    Active
    ${rows}=    Query Sql    SELECT is_active FROM donation_funds WHERE id = ${fund}
    Should Be Equal As Integers    ${rows}[0][is_active]    1

Restoring A Retired Fund Puts It Back
    ${fund}=    Seed Donation Fund    name=Old Drive    sort_order=9    is_active=0
    Login As Admin
    Navigate To    /admin/donations/funds
    Click    tr[data-fund-id="${fund}"] form.inline-form button[type="submit"]
    Flash Success Should Be Visible    restored
    Navigate To    /donate
    Get Text    select[name="fund_id"]    contains    Old Drive

Editor Sees Donations But Cannot Manage Funds
    Login As Editor
    Navigate To    /admin/donations
    Get Text    h1.admin-page-title    contains    Donations
    ${links}=    Get Element Count    a[href="/admin/donations/funds"]
    Should Be Equal As Integers    ${links}    0
    Navigate To    /admin/donations/funds
    ${forms}=    Get Element Count    form#new-fund-form
    Should Be Equal As Integers    ${forms}    0

Member Page Shows Donation History
    ${member}=    Seed Member    first_name=Mel    last_name=Member    email=mel@example.com
    ${other}=    Seed Member    first_name=Otto    last_name=Other    email=otto@example.com
    ${wheels}=    Get Donation Fund Id    Heart Wheels
    ${birds}=    Get Donation Fund Id    Battle of the Birds
    Seed Donation    ${wheels}    gift_cents=1200    fee_cover_cents=67    member_id=${member}
    Seed Donation    ${birds}    gift_cents=5000    member_id=${member}
    Seed Donation    ${wheels}    gift_cents=9900    member_id=${other}
    Login As Admin
    Navigate To    /admin/members/${member}
    Get Text    id=member-donations-total    ==    $62.00
    ${rows}=    Get Element Count    table#member-donations tbody tr
    Should Be Equal As Integers    ${rows}    2
    Get Text    table#member-donations    contains    Heart Wheels
    Get Text    table#member-donations    contains    Battle of the Birds
    Get Text    table#member-donations    contains    $12.67
    Get Text    table#member-donations    not contains    $99.00

Member With No Donations Sees The Empty State
    ${member}=    Seed Member    first_name=Nora    last_name=None    email=nora@example.com
    Login As Admin
    Navigate To    /admin/members/${member}
    Page Should Contain Text    No donations linked to this member.
