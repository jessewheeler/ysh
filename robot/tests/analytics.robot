*** Settings ***
Documentation    Google Analytics loads and runs in a real browser.
...
...    These tests exist because the previous GA setup rendered perfectly correct markup that
...    the browser then refused to execute — helmet's script-src allowed neither
...    googletagmanager nor the inline bootstrap, and CSP refusals are invisible unless you
...    read the console. Asserting the tag is in the HTML would have passed the whole time.
...    So: assert the console is free of CSP violations, and assert the bootstrap actually ran.
...
...    ServerManager pins GA_MEASUREMENT_ID to a fake ID, so nothing here reaches the real
...    property. gtag.js may fail to load (bad ID / no network) — that is a network failure,
...    not a CSP one, and does not affect these assertions.
Resource    ../resources/common.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    analytics

*** Test Cases ***
Homepage Loads Without CSP Violations
    Navigate To    /
    Wait For Elements State    section#home-slider h1    visible    timeout=5s
    Console Should Have No CSP Violations

Membership Page Loads Without CSP Violations
    Navigate To    /membership
    Wait For Elements State    body    attached    timeout=5s
    Console Should Have No CSP Violations

Analytics Bootstrap Executes In The Browser
    Navigate To    /
    Wait For Elements State    section#home-slider h1    visible    timeout=5s
    # dataLayer is only populated if public/js/analytics.js was fetched AND executed.
    # A CSP refusal, a 404, or a syntax error all leave this empty. analytics.js is
    # deferred, so it has run by the time the page is loaded.
    ${entries} =    Evaluate JavaScript    ${None}
    ...    () => (window.dataLayer && window.dataLayer.length) || 0
    Should Be True    ${entries} > 0    msg=analytics.js never ran — dataLayer is empty.
    ${gtag_type} =    Evaluate JavaScript    ${None}    () => typeof window.gtag
    Should Be Equal    ${gtag_type}    function

Measurement Id Reaches The Page
    Navigate To    /
    ${ga_id} =    Get Attribute    body    data-ga-id
    Should Be Equal    ${ga_id}    G-ROBOTTEST0

*** Keywords ***
Console Should Have No CSP Violations
    [Documentation]    Fails if the browser refused anything for Content-Security-Policy reasons.
    ${messages} =    Get Console Log    full=False
    ${text} =    Catenate    SEPARATOR=\n    @{messages}
    Should Not Contain    ${text}    Content Security Policy
    ...    msg=Browser reported a CSP violation — a script or beacon was refused.
