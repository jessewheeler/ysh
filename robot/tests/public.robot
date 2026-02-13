*** Settings ***
Resource    ../resources/common.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    public

*** Test Cases ***
Homepage Loads With All Sections
    Navigate To    /
    Wait For Elements State    section#home-slider h1    visible    timeout=5s
    Get Text    section#news h2    ==    Announcements
    Wait For Elements State    section#gallery    visible
    Wait For Elements State    section#about    visible
    Wait For Elements State    section#contact    visible
    Wait For Elements State    form.contact-form    visible

Bios Page Renders Board Members
    Seed Bios    2
    Navigate To    /bios
    Get Text    h2    contains    Board Member Bios
    ${count}=    Get Element Count    .bio-card
    Should Be True    ${count} >= 1
    Get Text    .bios-grid    contains    Test Person 1

Membership Form Renders
    Navigate To    /membership
    Get Text    h2    contains    Become a Member
    Wait For Elements State    input[name="first_name"]    visible
    Wait For Elements State    input[name="last_name"]    visible
    Wait For Elements State    input[name="email"]    visible
    Wait For Elements State    input[name="phone"]    visible
    Wait For Elements State    input[name="address_street"]    visible
    Wait For Elements State    input[name="address_city"]    visible
    Wait For Elements State    input[name="address_state"]    visible
    Wait For Elements State    input[name="address_zip"]    visible
    Page Should Contain Text    $25.00

Membership Validates Required Fields
    Navigate To    /membership
    Fill Text    input[name="first_name"]    OnlyFirst
    Evaluate JavaScript    .contact-form
    ...    (form) => {
    ...        form.querySelectorAll('[required]').forEach(el => el.removeAttribute('required'));
    ...    }
    Click    button[type="submit"]
    Flash Error Should Be Visible    required

Membership Signup Attempts Stripe
    Navigate To    /membership
    Fill Text    input[name="first_name"]    Robot
    Fill Text    input[name="last_name"]    Tester
    Fill Text    input[name="email"]    robot_stripe@example.com
    Fill Text    input[name="phone"]    4065551234
    Fill Text    input[name="address_city"]    Billings
    Fill Text    input[name="address_state"]    MT
    Fill Text    input[name="address_zip"]    59101
    Click    button[type="submit"]
    Sleep    2s
    ${count}=    Get Row Count    members
    Should Be True    ${count} >= 1

Contact Form Validates Required Fields
    Navigate To    /
    Evaluate JavaScript    form.contact-form
    ...    (form) => {
    ...        form.querySelectorAll('[required]').forEach(el => el.removeAttribute('required'));
    ...    }
    Fill Text    input[name="name"]    ${EMPTY}
    Fill Text    input[name="email"]    ${EMPTY}
    Fill Text    textarea[name="message"]    ${EMPTY}
    Click    form.contact-form button[type="submit"]
    Flash Error Should Be Visible    required

Contact Form Submits Successfully
    Navigate To    /
    Scroll To Element    section#contact
    Fill Text    input[name="name"]    Robot Contact
    Fill Text    input[name="email"]    contact@example.com
    Fill Text    textarea[name="message"]    Hello from the robot tests!
    Click    form.contact-form button[type="submit"]
    Wait For Elements State    h2    visible    timeout=5s
    Get Text    h2    contains    Message Sent

Membership Success Page Renders
    Navigate To    /membership/success
    Get Text    h2    contains    Welcome to the Yellowstone Sea Hawkers

Membership Cancel Page Renders
    Navigate To    /membership/cancel
    Get Text    h2    contains    Payment Cancelled
