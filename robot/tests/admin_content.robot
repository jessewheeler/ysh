*** Settings ***
Resource    ../resources/common.resource
Resource    ../resources/admin.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    admin

*** Test Cases ***
Announcements List
    Seed Announcements    1
    Login As Admin
    Navigate To    /admin/announcements
    Get Text    .admin-table    contains    Test Announcement 1

Create Announcement
    Login As Admin
    Navigate To    /admin/announcements/new
    Fill Text    input[name="title"]    Robot Announcement
    Fill Text    textarea[name="body"]    Created by robot test
    Fill Text    input[name="sort_order"]    5
    Check Checkbox    input[name="is_published"]
    Submit Admin Form
    Flash Success Should Be Visible    created

Edit Announcement
    Seed Announcements    1
    Login As Admin
    Navigate To    /admin/announcements
    Click    .admin-table tbody tr:first-child a.btn-sm
    Wait For Elements State    input[name="title"]    visible    timeout=5s
    Get Attribute    input[name="title"]    value    ==    Test Announcement 1
    Fill Text    input[name="title"]    Updated Announcement
    Submit Admin Form
    Flash Success Should Be Visible    updated

Delete Announcement
    Seed Announcements    1
    Login As Admin
    Navigate To    /admin/announcements
    Handle Future Dialogs    action=accept
    Click    .admin-table tbody tr:first-child button.btn-sm.btn-danger
    Flash Success Should Be Visible    deleted

Bios List
    Seed Bios    2
    Login As Admin
    Navigate To    /admin/bios
    Get Text    .admin-table    contains    Test Person 1
    Get Text    .admin-table    contains    Test Person 2

Create Bio
    Login As Admin
    Navigate To    /admin/bios/new
    Fill Text    input[name="name"]    Robot Bio Person
    Fill Text    input[name="role"]    Test Role
    Fill Text    textarea[name="bio_text"]    A bio created by robot tests.
    Fill Text    input[name="sort_order"]    10
    Check Checkbox    input[name="is_visible"]
    Submit Admin Form
    Flash Success Should Be Visible    created

Delete Bio
    Seed Bios    1
    Login As Admin
    Navigate To    /admin/bios
    Handle Future Dialogs    action=accept
    Click    .admin-table tbody tr:first-child button.btn-sm.btn-danger
    Flash Success Should Be Visible    deleted
