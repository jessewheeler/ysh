*** Settings ***
Documentation     The public donate page (issue #126). The test server has a fake Stripe key, so a
...               submit never reaches a real checkout: the pending donation row is written first,
...               then Stripe refuses and the form shows an error. These tests assert on that row.
...               Every control is exercised by changing it in the browser, not by posting
...               straight to the route.
Resource          ../resources/common.resource
Suite Setup       Start Test Server
Suite Teardown    Stop Test Server
Test Setup        Reset Test State
Force Tags        public    donate

*** Keywords ***
Fill Donor
    [Arguments]    ${name}=Robot Donor    ${email}=robot_donor@example.com
    Fill Text    id=donor_name    ${name}
    Fill Text    id=donor_email    ${email}

Submit Donation
    Click    form#donate-form button[type="submit"]
    Wait For Elements State    .flash.flash-error    visible    timeout=10s

Latest Donation
    ${rows}=    Query Sql    SELECT * FROM donations ORDER BY id DESC LIMIT 1
    RETURN    ${rows}[0]

*** Test Cases ***
Donate Link Appears In Nav
    Navigate To    /
    Wait For Elements State    a.btn-donate    visible    timeout=5s
    Click    a.btn-donate
    Current URL Should Contain    /donate
    Get Text    h2    contains    Donate to the Yellowstone Sea Hawkers

Form Offers The Funds And Defaults To Twelve Dollars
    Navigate To    /donate
    ${funds}=    Get Element Count    select[name="fund_id"] option
    Should Be Equal As Integers    ${funds}    4
    Get Text    select[name="fund_id"]    contains    Heart Wheels
    Get Checkbox State    input[name="amount_preset"][value="1200"]    ==    checked
    Get Checkbox State    id=cover_fee    ==    unchecked
    Get Checkbox State    id=anonymous    ==    unchecked
    Get Text    id=donate-total    ==    $12.00

Default Donation Records Twelve Dollars With No Fee
    Navigate To    /donate
    Fill Donor
    Select Options By    select[name="fund_id"]    label    Heart Wheels
    Submit Donation
    ${fund}=    Get Donation Fund Id    Heart Wheels
    ${row}=    Latest Donation
    Should Be Equal As Integers    ${row}[gift_cents]    1200
    Should Be Equal As Integers    ${row}[fee_cover_cents]    0
    Should Be Equal As Integers    ${row}[amount_cents]    1200
    Should Be Equal As Integers    ${row}[fund_id]    ${fund}
    Should Be Equal    ${row}[donor_email]    robot_donor@example.com
    Should Be Equal    ${row}[status]    pending

Choosing A Preset Changes The Total
    Navigate To    /donate
    Click    label.donate-preset:has-text("$50")
    Get Text    id=donate-total    ==    $50.00
    Fill Donor
    Submit Donation
    ${row}=    Latest Donation
    Should Be Equal As Integers    ${row}[gift_cents]    5000

Other Amount Box Appears And Is Used
    Navigate To    /donate
    Wait For Elements State    id=custom-amount-group    hidden
    Click    label.donate-preset:has-text("Other")
    Wait For Elements State    id=amount_custom    visible
    Fill Text    id=amount_custom    15.50
    Get Text    id=donate-total    ==    $15.50
    Fill Donor
    Submit Donation
    ${row}=    Latest Donation
    Should Be Equal As Integers    ${row}[gift_cents]    1550

Covering The Fee Is Opt In And Raises The Total
    Navigate To    /donate
    Get Text    id=fee-amount    ==    $0.67
    Check Checkbox    id=cover_fee
    Get Text    id=donate-total    ==    $12.67
    Click    label.donate-preset:has-text("$25")
    Get Text    id=fee-amount    ==    $1.06
    Get Text    id=donate-total    ==    $26.06
    Fill Donor
    Submit Donation
    ${row}=    Latest Donation
    Should Be Equal As Integers    ${row}[gift_cents]    2500
    Should Be Equal As Integers    ${row}[fee_cover_cents]    106
    Should Be Equal As Integers    ${row}[amount_cents]    2606

Giving Anonymously Hides The Donor Fields And Stores No Details
    Navigate To    /donate
    Fill Donor    name=Should Not Be Stored    email=secret@example.com
    Check Checkbox    id=anonymous
    Wait For Elements State    id=donor_name    hidden
    Wait For Elements State    id=donor_email    hidden
    Submit Donation
    ${row}=    Latest Donation
    Should Be Equal As Integers    ${row}[is_anonymous]    1
    Should Be Equal    ${row}[donor_name]    ${None}
    Should Be Equal    ${row}[donor_email]    ${None}
    Should Be Equal    ${row}[member_id]    ${None}
    Should Be Equal As Integers    ${row}[gift_cents]    1200

Unticking Anonymous Brings The Donor Fields Back
    Navigate To    /donate
    Check Checkbox    id=anonymous
    Wait For Elements State    id=donor_name    hidden
    Uncheck Checkbox    id=anonymous
    Wait For Elements State    id=donor_name    visible
    Get Attribute    id=donor_name    required    ==    ${EMPTY}

Donation From A Member Email Is Tied To The Member
    ${member}=    Seed Member    first_name=Mel    last_name=Member    email=mel@example.com
    Navigate To    /donate
    Fill Donor    name=Mel Member    email=MEL@example.com
    Submit Donation
    ${row}=    Latest Donation
    Should Be Equal As Integers    ${row}[member_id]    ${member}

Missing Name And Email Are Refused By The Server
    Navigate To    /donate
    Evaluate JavaScript    form#donate-form
    ...    (form) => {
    ...        form.setAttribute('novalidate', '');
    ...        form.querySelectorAll('[required]').forEach(el => el.removeAttribute('required'));
    ...    }
    Click    form#donate-form button[type="submit"]
    Flash Error Should Be Visible    Name and email are required
    ${count}=    Get Row Count    donations
    Should Be Equal As Integers    ${count}    0

Fund Link From The Battle Of The Birds Page Preselects That Fund
    Navigate To    /charitable/battle-of-the-birds
    Click    a[href="/donate?fund=battle-of-the-birds"]
    Current URL Should Contain    /donate
    Get Selected Options    select[name="fund_id"]    label    ==    Battle of the Birds

Auction Page Links To The Donate Page
    ${auction}=    Seed Auction
    Navigate To    /auctions/${auction}
    Get Text    p.auction-donate    contains    Not bidding?
    Click    p.auction-donate a
    Current URL Should Contain    /donate?fund=battle-of-the-birds

Success And Cancel Pages Render
    Navigate To    /donate/success
    Get Text    h2    contains    Thank You for Your Donation
    Navigate To    /donate/cancel
    Get Text    h2    contains    Donation Cancelled
