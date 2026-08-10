*** Settings ***
Documentation    Campaign tracking (issue #88): creating a campaign in the admin, the generated
...              UTM link and its QR code downloads, and end-to-end attribution — a visitor
...              arrives on a tagged link and their contact submission and membership signup
...              come back attributed to that campaign on the detail page.
Resource    ../resources/common.resource
Resource    ../resources/admin.resource
Library     OperatingSystem
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    admin    campaigns

*** Test Cases ***
Campaigns Page Accessible From Admin Nav
    Login As Admin
    Click    .sidebar-nav a[href="/admin/campaigns"]
    Get Text    h1.admin-page-title    contains    Campaigns
    Get Text    body    contains    No campaigns yet

Auth Guard Redirects Campaigns Page
    Navigate To    /admin/campaigns
    Current URL Should Contain    /admin/login

Auth Guard Redirects Contact Submissions Page
    Navigate To    /admin/contact-submissions
    Current URL Should Contain    /admin/login

Creating A Campaign Shows Its Generated Link
    Login As Admin
    Navigate To    /admin/campaigns/new
    Fill Text    input[name="name"]    Watch Party Flyer
    Fill Text    input[name="utm_campaign"]    flyer26
    Fill Text    input[name="utm_source"]    print
    Fill Text    input[name="utm_medium"]    flyer
    Submit Admin Form
    Wait For Elements State    \#campaign-url    visible    timeout=10s
    ${url}=    Get Property    \#campaign-url    value
    Should Contain    ${url}    /membership
    Should Contain    ${url}    utm_source=print
    Should Contain    ${url}    utm_medium=flyer
    Should Contain    ${url}    utm_campaign=flyer26

Invalid Campaign Code Is Rejected
    Login As Admin
    Navigate To    /admin/campaigns/new
    Fill Text    input[name="name"]    Bad Campaign
    Fill Text    input[name="utm_campaign"]    has spaces
    Submit Admin Form
    Flash Error Should Be Visible    lowercase letters
    ${count}=    Get Row Count    campaigns
    Should Be Equal As Integers    ${count}    0

QR Code Preview Renders On The Detail Page
    ${campaign}=    Seed Campaign    utm_campaign=flyer26
    Login As Admin
    Navigate To    /admin/campaigns/${campaign}
    Wait For Elements State    img\#campaign-qr    visible    timeout=10s
    ${src}=    Get Property    img\#campaign-qr    src
    Should Contain    ${src}    /admin/campaigns/${campaign}/qr.png
    ${natural}=    Get Property    img\#campaign-qr    naturalWidth
    Should Be True    ${natural} > 0    The QR image did not actually load

QR Code Downloads As SVG
    ${campaign}=    Seed Campaign    utm_campaign=flyer26
    Login As Admin
    Navigate To    /admin/campaigns/${campaign}
    ${path}=    Download Via Click    a[href$="/qr.svg"]    ysh-qr-flyer26.svg
    File Should Exist    ${path}
    ${contents}=    Get File    ${path}
    Should Contain    ${contents}    <svg

QR Code Downloads As PNG
    ${campaign}=    Seed Campaign    utm_campaign=flyer26
    Login As Admin
    Navigate To    /admin/campaigns/${campaign}
    ${path}=    Download Via Click    a[href*="qr.png"][href*="download=1"]    ysh-qr-flyer26.png
    File Should Exist    ${path}
    ${size}=    Get File Size    ${path}
    Should Be True    ${size} > 0

Copy Link Button Copies The Generated Link
    [Documentation]    Regression guard for the CSP rule in CLAUDE.md: an inline onclick would
    ...    be silently blocked by script-src-attr 'none', so this clicks the real button and
    ...    checks the handler in public/js/admin.js actually ran.
    ${campaign}=    Seed Campaign    utm_campaign=flyer26
    Login As Admin
    Navigate To    /admin/campaigns/${campaign}
    Click    \#copy-url
    Wait Until Keyword Succeeds    5x    200ms    Copy Button Should Be Confirmed

Visiting A Tagged Link Records One Visit Per Visitor
    ${campaign}=    Seed Campaign    utm_campaign=flyer26
    Navigate To    /membership?utm_source=print&utm_medium=flyer&utm_campaign=flyer26
    Wait For Elements State    .membership-tab-active    visible    timeout=10s
    Navigate To    /membership?utm_campaign=flyer26
    Navigate To    /membership?utm_campaign=flyer26
    ${visits}=    Count Campaign Visits    ${campaign}
    Should Be Equal As Integers    ${visits}    1

An Unknown Campaign Code Still Serves The Page
    Navigate To    /membership?utm_campaign=no-such-campaign
    Wait For Elements State    .membership-tab-active    visible    timeout=10s
    ${count}=    Get Row Count    campaign_visits
    Should Be Equal As Integers    ${count}    0

Contact Submission Is Attributed To The Campaign
    ${campaign}=    Seed Campaign    utm_campaign=flyer26
    Navigate To    /?utm_campaign=flyer26
    Scroll To Element    section#contact
    Fill Text    input[name="name"]    Robot Contact
    Fill Text    input[name="email"]    robot_campaign@example.com
    Fill Text    textarea[name="message"]    Saw your flyer at the watch party!
    Click    form.contact-form button[type="submit"]
    Wait For Elements State    h2    visible    timeout=10s
    Get Text    h2    contains    Message Sent
    ${attributed}=    Count Contact Submissions    ${campaign}
    Should Be Equal As Integers    ${attributed}    1

Membership Signup Is Attributed To The Campaign
    [Documentation]    Stripe is stubbed with a fake key in the robot server, so checkout
    ...    fails — but the member row is created before that call, which is what carries the
    ...    attribution.
    ${campaign}=    Seed Campaign    utm_campaign=flyer26
    Navigate To    /membership?utm_campaign=flyer26
    Click    .membership-type-card:has(input[value="individual"])
    Wait For Elements State    input[name="first_name"]    visible    timeout=5s
    Fill Text    input[name="first_name"]    Robot
    Fill Text    input[name="last_name"]    Joiner
    Fill Text    .membership-form input[name="email"]    robot_joiner@example.com
    Fill Text    input[name="address_city"]    Billings
    Fill Text    input[name="address_state"]    MT
    Fill Text    input[name="address_zip"]    59101
    Click    .membership-form button[type="submit"]
    Wait Until Keyword Succeeds    10x    500ms    Member Should Be Attributed
    ...    robot_joiner@example.com    ${campaign}

Detail Page Reports Visits Signups And Contacts
    ${campaign}=    Seed Campaign    utm_campaign=flyer26
    Navigate To    /membership?utm_campaign=flyer26
    Wait For Elements State    .membership-tab-active    visible    timeout=10s
    Navigate To    /?utm_campaign=flyer26
    Scroll To Element    section#contact
    Fill Text    input[name="name"]    Robot Contact
    Fill Text    input[name="email"]    robot_stats@example.com
    Fill Text    textarea[name="message"]    Counting test
    Click    form.contact-form button[type="submit"]
    Wait For Elements State    h2    visible    timeout=10s

    Login As Admin
    Navigate To    /admin/campaigns/${campaign}
    Get Text    \#stat-visits    ==    1
    Get Text    \#stat-contacts    ==    1
    Get Text    table#campaign-contacts    contains    robot_stats@example.com

Deactivating A Campaign Stops Attribution
    ${campaign}=    Seed Campaign    utm_campaign=flyer26
    Login As Admin
    Navigate To    /admin/campaigns
    # The Deactivate button carries data-confirm, so a dialog appears; Playwright dismisses
    # dialogs by default, which would silently cancel the submit.
    Handle Future Dialogs    action=accept
    Click    form[action="/admin/campaigns/${campaign}/toggle"] button
    Flash Success Should Be Visible    deactivated
    Get Text    \#campaigns-table    contains    Inactive

    Navigate To    /membership?utm_campaign=flyer26
    Wait For Elements State    .membership-tab-active    visible    timeout=10s
    ${visits}=    Count Campaign Visits    ${campaign}
    Should Be Equal As Integers    ${visits}    0

Contact Submissions Page Lists Messages With Their Campaign
    ${campaign}=    Seed Campaign    name=Watch Party Flyer    utm_campaign=flyer26
    Navigate To    /?utm_campaign=flyer26
    Scroll To Element    section#contact
    Fill Text    input[name="name"]    Robot Contact
    Fill Text    input[name="email"]    robot_list@example.com
    Fill Text    textarea[name="message"]    Listing test
    Click    form.contact-form button[type="submit"]
    Wait For Elements State    h2    visible    timeout=10s

    Login As Admin
    Navigate To    /admin/contact-submissions
    Get Text    table#contact-submissions    contains    robot_list@example.com
    Get Text    table#contact-submissions    contains    Watch Party Flyer

*** Keywords ***
Copy Button Should Be Confirmed
    ${label}=    Get Text    \#copy-url
    Should Not Be Equal    ${label}    Copy link

Member Should Be Attributed
    [Arguments]    ${email}    ${campaign}
    ${actual}=    Get Member Campaign Id    ${email}
    Should Be Equal As Integers    ${actual}    ${campaign}
