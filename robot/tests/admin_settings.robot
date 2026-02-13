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
    Get Attribute    input[name="dues_amount_cents"]    value    ==    2500

Update Settings
    Login As Admin
    Navigate To    /admin/settings
    Fill Text    input[name="hero_title"]    Updated Title
    Fill Text    input[name="dues_amount_cents"]    5000
    Submit Admin Form
    Flash Success Should Be Visible    saved
    Navigate To    /admin/settings
    Get Attribute    input[name="hero_title"]    value    ==    Updated Title
    Get Attribute    input[name="dues_amount_cents"]    value    ==    5000

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
