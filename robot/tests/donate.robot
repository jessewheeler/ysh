*** Settings ***
Resource    ../resources/common.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    public    donate

*** Test Cases ***
Donate Link Appears In Nav
    Navigate To    /
    Wait For Elements State    a.btn-donate    visible    timeout=5s
    Get Text    a.btn-donate    contains    Donate

Donate Form Renders
    Navigate To    /donate
    Get Text    h2    contains    Donate to the Yellowstone Sea Hawkers
    Wait For Elements State    input[name="donor_name"]    visible
    Wait For Elements State    input[name="donor_email"]    visible
    ${presets}=    Get Element Count    input[name="amount_preset"]
    Should Be Equal As Integers    ${presets}    5
    Page Should Contain Text    $25
    Page Should Contain Text    $50
    Page Should Contain Text    $100
    Page Should Contain Text    $250

Custom Amount Field Toggles On Selection
    Navigate To    /donate
    Wait For Elements State    id=custom-amount-group    hidden
    Click    label.donate-preset:has-text("Custom")
    Wait For Elements State    id=custom-amount-group    visible
    Wait For Elements State    input[name="amount_custom"]    visible

Donate Validates Required Fields
    Navigate To    /donate
    Evaluate JavaScript    form.contact-form
    ...    (form) => {
    ...        form.setAttribute('novalidate', '');
    ...        form.querySelectorAll('[required]').forEach(el => el.removeAttribute('required'));
    ...    }
    Fill Text    input[name="donor_name"]    ${EMPTY}
    Fill Text    input[name="donor_email"]    ${EMPTY}
    Click    button[type="submit"]
    Flash Error Should Be Visible    required

Donate Rejects Invalid Email
    Navigate To    /donate
    Evaluate JavaScript    form.contact-form
    ...    (form) => { form.setAttribute('novalidate', ''); }
    Fill Text    input[name="donor_name"]    Robot Donor
    Fill Text    input[name="donor_email"]    not-an-email
    Click    button[type="submit"]
    Flash Error Should Be Visible    valid email

Donate With Preset Amount Attempts Stripe
    Navigate To    /donate
    Fill Text    input[name="donor_name"]    Robot Donor
    Fill Text    input[name="donor_email"]    robot_donor@example.com
    Click    button[type="submit"]
    Sleep    2s
    ${count}=    Get Row Count    donations
    Should Be True    ${count} >= 1
    ${rows}=    Query Sql    SELECT amount_cents, status FROM donations ORDER BY id DESC LIMIT 1
    Should Be Equal As Integers    ${rows}[0][amount_cents]    2500
    Should Be Equal    ${rows}[0][status]    pending

Donate With Custom Amount Attempts Stripe
    Navigate To    /donate
    Fill Text    input[name="donor_name"]    Custom Donor
    Fill Text    input[name="donor_email"]    custom_donor@example.com
    Click    label.donate-preset:has-text("Custom")
    Wait For Elements State    input[name="amount_custom"]    visible
    Fill Text    input[name="amount_custom"]    15.50
    Click    button[type="submit"]
    Sleep    2s
    ${rows}=    Query Sql    SELECT amount_cents FROM donations ORDER BY id DESC LIMIT 1
    Should Be Equal As Integers    ${rows}[0][amount_cents]    1550

Donate Success Page Renders
    Navigate To    /donate/success
    Get Text    h2    contains    Thank You for Your Donation

Donate Cancel Page Renders
    Navigate To    /donate/cancel
    Get Text    h2    contains    Payment Cancelled
