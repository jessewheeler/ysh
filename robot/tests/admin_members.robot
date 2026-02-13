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
