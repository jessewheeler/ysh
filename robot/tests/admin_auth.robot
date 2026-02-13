*** Settings ***
Resource    ../resources/common.resource
Resource    ../resources/admin.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    admin    auth

*** Test Cases ***
Admin Login Page Renders
    Navigate To    /admin/login
    Get Text    h2    ==    Admin Login
    Wait For Elements State    input[name="email"]    visible
    Wait For Elements State    button.btn[type="submit"]    visible

Successful Login Redirects To Dashboard
    Login As Admin
    Current URL Should Contain    /admin/dashboard
    ${count}=    Get Element Count    .stat-card
    Should Be Equal As Integers    ${count}    4

Failed Login Shows Invalid Code
    Navigate To    /admin/login
    Fill Text    input[name="email"]    ${ADMIN_EMAIL}
    Click    button.btn[type="submit"]
    Wait For Elements State    input[name="code"]    visible    timeout=10s
    Fill Text    input[name="code"]    999999
    Click    button.btn[type="submit"]
    Flash Error Should Be Visible    Invalid code

Auth Guard Redirects Dashboard
    Navigate To    /admin/dashboard
    Current URL Should Contain    /admin/login

Auth Guard Redirects Members
    Navigate To    /admin/members
    Current URL Should Contain    /admin/login

Auth Guard Redirects Settings
    Navigate To    /admin/settings
    Current URL Should Contain    /admin/login

Logout Destroys Session
    Login As Admin
    Click    button.sidebar-logout
    Wait For Elements State    section#home-slider    visible    timeout=10s
    Navigate To    /admin/dashboard
    Current URL Should Contain    /admin/login

Login Remembers Return URL
    Navigate To    /admin/settings
    Current URL Should Contain    /admin/login
    Fill Text    input[name="email"]    ${ADMIN_EMAIL}
    Click    button.btn[type="submit"]
    Wait For Elements State    input[name="code"]    visible    timeout=10s
    Fill Text    input[name="code"]    ${OTP_CODE}
    Click    button.btn[type="submit"]
    Wait For Elements State    h1.admin-page-title    visible    timeout=10s
    Current URL Should Contain    /admin/settings
