*** Settings ***
Resource    ../resources/common.resource
Resource    ../resources/admin.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    admin    events

*** Test Cases ***
Events Opens On Upcoming With The Next Event First
    Seed Event    name=Two Weeks Ago Watch Party    days_from_today=-14
    Seed Event    name=Next Week Watch Party    days_from_today=7
    ${next}=    Seed Event    name=Tomorrow Watch Party    days_from_today=1
    Login As Admin
    Click    nav.sidebar-nav >> text=Events
    Wait For Elements State    table#events-table    visible    timeout=10s
    Get Attribute    table#events-table tbody tr >> nth=0    data-event-id    ==    ${{ str($next) }}
    Get Element Count    table#events-table tbody tr    ==    2
    Get Text    a.view-pill-active    contains    Upcoming
    Get Text    a.view-pill-active .pill-count    ==    2

View Pills Filter Past And All Events
    [Documentation]    Clicks the pills rather than navigating to ?view=, which would pass
    ...    even if the links were wrong.
    ${older}=    Seed Event    name=Two Weeks Ago Watch Party    days_from_today=-14
    ${recent}=    Seed Event    name=Last Week Watch Party    days_from_today=-7
    Seed Event    name=Tomorrow Watch Party    days_from_today=1
    Login As Admin
    Navigate To    /admin/events
    Get Text    .view-pills >> text=Past    contains    2
    Get Text    .view-pills >> text=All    contains    3

    Click    .view-pills >> text=Past
    Wait For Condition    Url    contains    view=past    timeout=10s
    Get Element Count    table#events-table tbody tr    ==    2
    Get Attribute    table#events-table tbody tr >> nth=0    data-event-id    ==    ${{ str($recent) }}
    Get Attribute    table#events-table tbody tr >> nth=1    data-event-id    ==    ${{ str($older) }}
    Get Text    table#events-table    not contains    Tomorrow Watch Party

    Click    .view-pills >> text=All
    Wait For Condition    Url    contains    view=all    timeout=10s
    Get Element Count    table#events-table tbody tr    ==    3
    Get Attribute    table#events-table tbody tr >> nth=0    data-event-id    ==    ${{ str($older) }}

Changing The Season Keeps The Current View
    ${other}=    Seed Period    label=Other Season
    Seed Event    name=Other Season Past Party    days_from_today=-3    period_id=${other}
    Seed Event    name=This Season Past Party    days_from_today=-5
    Seed Event    name=Tomorrow Watch Party    days_from_today=1
    Login As Admin
    Navigate To    /admin/events
    Click    .view-pills >> text=Past
    Wait For Condition    Url    contains    view=past    timeout=10s
    Select Options By    select[name="period"]    value    all
    Wait For Condition    Url    contains    period=all    timeout=10s
    Get Url    contains    view=past
    Get Text    table#events-table    contains    Other Season Past Party
    Get Text    table#events-table    contains    This Season Past Party
    Get Text    table#events-table    not contains    Tomorrow Watch Party
