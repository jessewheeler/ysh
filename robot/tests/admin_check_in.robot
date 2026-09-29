*** Settings ***
Resource    ../resources/common.resource
Resource    ../resources/admin.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    admin    check-in

*** Test Cases ***
Checking In Two Of Three Family Members Records Exactly Those Two
    [Documentation]    Finds the family by searching, opens the household and ticks the
    ...    checkboxes through the UI — posting present_<id> directly would pass even if
    ...    the checkboxes were missing from the form.
    ${primary}=    Seed Member    first_name=Pat    last_name=Hawkfamily    email=pat@example.com
    ...    membership_type=family
    ${robin}=    Seed Family Member    ${primary}    first_name=Robin    last_name=Hawkfamily
    ${casey}=    Seed Family Member    ${primary}    first_name=Casey    last_name=Hawkfamily
    ${period}=    Get Current Period Id
    Enroll Member    ${primary}    ${period}
    ${event}=    Seed Event    name=Week 4 vs Chargers

    Login As Admin
    Click    nav.sidebar-nav >> text=Check-In
    Wait For Elements State    select#check-in-event    visible    timeout=10s
    Get Selected Options    select#check-in-event    value    ==    ${{ str($event) }}
    Fill Text    form#check-in-search input[name="search"]    Robin
    Click    form#check-in-search button[type="submit"]
    Wait For Elements State    table#check-in-results    visible    timeout=10s
    Click    table#check-in-results >> text=Open Household

    Wait For Elements State    table#household-table    visible    timeout=10s
    Get Element Count    table#household-table tbody tr    ==    3
    # Unticked rows hold their ticket count back until the person is marked present.
    Get Element States    input#tickets-${robin}    contains    disabled
    Check Checkbox    input#present-${primary}
    Check Checkbox    input#present-${robin}
    Get Element States    input#tickets-${robin}    contains    enabled
    Click    form#household-check-in button[type="submit"]
    Flash Success Should Be Visible    Checked in Pat, Robin — 2 raffle tickets

    Navigate To    /admin/events/${event}
    Get Text    p#attendance-summary    contains    2 checked in · 2 raffle tickets
    Get Element Count    table#attendance-table tbody tr    ==    2
    Get Text    table#attendance-table    contains    Pat Hawkfamily
    Get Text    table#attendance-table    contains    Robin Hawkfamily
    Get Text    table#attendance-table    not contains    Casey

Lapsed Member Is Checked In Without Raffle Tickets
    ${id}=    Seed Member    first_name=Lee    last_name=Lapsed    email=lee@example.com
    ${event}=    Seed Event
    Login As Admin
    Navigate To    /admin/check-in/${event}/member/${id}
    Wait For Elements State    table#household-table    visible    timeout=10s
    Get Text    table#household-table    contains    No raffle tickets
    Get Element States    input#tickets-${id}    contains    disabled
    Click    form#household-check-in button[type="submit"]
    Flash Success Should Be Visible    0 raffle tickets

    Navigate To    /admin/events/${event}
    Get Text    tr[data-member-id="${id}"] td.ticket-count    ==    0

Event Picker Switches The Check-In Event
    [Documentation]    Changes the picker control itself rather than navigating to ?event=,
    ...    which would pass even if data-auto-submit were broken.
    Seed Event    name=Tonight Watch Party
    ${later}=    Seed Event    name=Saturday Social    days_from_today=2
    Login As Admin
    Navigate To    /admin/check-in
    Get Text    .admin-content    contains    Tonight Watch Party
    Select Options By    select#check-in-event    value    ${{ str($later) }}
    Wait For Condition    Url    contains    event=${later}    timeout=10s
    Get Text    .admin-content    contains    Checking in for Saturday Social

Check-In Opens On The Next Event On A Non-Game Day
    [Documentation]    With no event today, the picker lands on the next upcoming game rather
    ...    than "Choose an event…" — and not on the one that has already happened.
    Seed Event    name=Last Weekend Watch Party    days_from_today=-2
    ${next}=    Seed Event    name=Thursday Night Watch Party    days_from_today=3
    Login As Admin
    Click    nav.sidebar-nav >> text=Check-In
    Wait For Elements State    select#check-in-event    visible    timeout=10s
    Get Selected Options    select#check-in-event    value    ==    ${{ str($next) }}
    Get Text    .admin-content    contains    Checking in for Thursday Night Watch Party

Admin Creates An Event By Hand
    Login As Admin
    Click    nav.sidebar-nav >> text=Events
    Click    text=+ New Event
    Fill Text    input#name    Bye Week Social
    Submit Admin Form
    Flash Success Should Be Visible    Bye Week Social
    Get Text    h1.admin-page-title    contains    Bye Week Social
