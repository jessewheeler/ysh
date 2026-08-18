*** Settings ***
Resource    ../resources/common.resource
Resource    ../resources/admin.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    admin    settings

*** Test Cases ***
Settings Page Loads With Values
    Login As Admin
    Navigate To    /admin/settings
    Get Text    h1.admin-page-title    contains    Site Settings
    Get Attribute    input[name="hero_title"]    value    ==    Yellowstone Sea Hawkers
    Wait For Elements State    input[name="stripe_publishable_key"]    visible

Update Settings
    Login As Admin
    Navigate To    /admin/settings
    Fill Text    input[name="hero_title"]    Updated Title
    Fill Text    input[name="hero_button_text"]    Updated Button
    Submit Admin Form
    Flash Success Should Be Visible    saved
    Navigate To    /admin/settings
    Get Attribute    input[name="hero_title"]    value    ==    Updated Title
    Get Attribute    input[name="hero_button_text"]    value    ==    Updated Button

Settings Reflect On Homepage
    Login As Admin
    Navigate To    /admin/settings
    Fill Text    input[name="hero_title"]    Robot Hawks
    Submit Admin Form
    Flash Success Should Be Visible    saved
    Navigate To    /
    Get Text    section#home-slider h1    ==    Robot Hawks

Dashboard Shows Statistics
    Seed Member    first_name=Stat    last_name=One    email=stat1@example.com
    Seed Member    first_name=Stat    last_name=Two    email=stat2@example.com
    Login As Admin
    Navigate To    /admin/dashboard
    Get Text    .stats-grid    contains    2

KPI Values Stay Inside Their Cards
    [Documentation]    The regression guard for the reported defect: "$2034.00" at a fixed
    ...    2.25rem was wider than the card's content box and painted outside it. A text
    ...    assertion cannot see that, so this compares scroll width against client width on
    ...    every tile — the only check that would have caught it. Seeds a large revenue figure
    ...    because the overflow only shows up once the number is long.
    ${id}=    Seed Member    first_name=Big    last_name=Spender    email=big@example.com
    Seed Payment    member_id=${id}    amount_cents=98765432
    Login As Admin
    Navigate To    /admin/dashboard
    Wait For Elements State    .stats-grid    visible    timeout=10s
    ${overflowing}=    Evaluate JavaScript    ${None}
    ...    () => [...document.querySelectorAll('.stat-card')].filter(c => c.scrollWidth > c.clientWidth).length
    Should Be Equal As Integers    ${overflowing}    0

