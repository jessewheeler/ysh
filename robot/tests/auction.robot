*** Settings ***
Documentation     Silent auction (issue #119): admin setup with photos, bidder sign-in and
...               bidding, the shipping and handling notice, closing, bid removal and winners.
Resource    ../resources/common.resource
Resource    ../resources/admin.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    auction

*** Variables ***
${NOTICE}    Shipping and handling costs are the winning bidder's responsibility.

*** Keywords ***
Sign In As Bidder
    [Arguments]    ${email}=bidder@example.com    ${name}=Robot Bidder    ${phone}=406-555-0100
    Fill Text    input[name="name"]    ${name}
    Fill Text    input[name="email"]    ${email}
    Fill Text    input[name="phone"]    ${phone}
    Click    form[action="/auctions/login"] button[type="submit"]
    Wait For Elements State    input[name="code"]    visible    timeout=10s
    Fill Text    input[name="code"]    ${OTP_CODE}
    Click    form[action="/auctions/login/verify"] button[type="submit"]
    Flash Success Should Be Visible    signed in

*** Test Cases ***
Admin Creates An Auction With A Two-Photo Item And Publishes It
    [Documentation]    Uses the real forms, including the multi-file photo input, then checks the
    ...    public side: the nav link, the shipping notice, the cover photo and the gallery.
    Login As Admin
    Click    nav.sidebar-nav >> text=Auctions
    Click    text=+ New Auction
    Fill Text    input#title    Robot Holiday Auction
    # datetime-local takes YYYY-MM-DDTHH:MM; a window around now keeps it live.
    ${start}=    Evaluate    (__import__('datetime').datetime.now(__import__('zoneinfo').ZoneInfo('America/Denver')) - __import__('datetime').timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M')
    ${end}=    Evaluate    (__import__('datetime').datetime.now(__import__('zoneinfo').ZoneInfo('America/Denver')) + __import__('datetime').timedelta(days=2)).strftime('%Y-%m-%dT%H:%M')
    Fill Text    input#starts_at    ${start}
    Fill Text    input#ends_at    ${end}
    Get Text    textarea#shipping_notice    contains    Shipping and handling costs
    Select Options By    select#status    value    published
    Submit Admin Form
    Flash Success Should Be Visible    Add items next

    Click    text=+ Add Item
    Fill Text    input#title    Signed Helmet
    Fill Text    textarea#description    Signed by the Legion of Boom.
    Fill Text    input#starting_bid    150
    Upload File By Selector    input#photos    ${PROJECT_ROOT}/public/img/logo.png    ${PROJECT_ROOT}/public/img/tbd.jpg
    Submit Admin Form
    Flash Success Should Be Visible    with 2 photos
    Get Element Count    ul.auction-photo-admin li    ==    2

    Navigate To    /
    Hover    a.dropdown-toggle[href="/#charitable"]
    Click    a.nav-auction
    Wait For Elements State    .auction-grid    visible    timeout=10s
    Get Text    .auction-shipping    contains    Shipping and handling costs
    Get Text    .auction-card    contains    Signed Helmet
    Get Text    .auction-card    contains    $150
    Click    .auction-card a
    Wait For Elements State    [data-gallery-main]    visible
    Get Element Count    [data-gallery-thumb]    ==    2
    Get Text    .auction-shipping    contains    Shipping and handling costs

Bidder Signs In, Must Acknowledge Shipping, Then Bids Without A Reload
    ${auction}=    Seed Auction
    ${item}=    Seed Auction Item    ${auction}    starting_bid_cents=2000    photos=1
    Navigate To    /auctions/${auction}/items/${item}
    Click    .auction-bid-box >> text=Sign in to bid
    Sign In As Bidder
    Current URL Should Contain    /auctions/${auction}/items/${item}

    Fill Text    input[name="amount"]    25
    # The acknowledgement box is required; the browser refuses to submit without it.
    Click    [data-bid-form] button[type="submit"]
    Get Element Count    [data-bid-history] li    ==    0
    Get Text    .auction-bid-box [data-field="current"]    ==    $20
    Check Checkbox    input[name="shipping_ack"]
    Click    [data-bid-form] button[type="submit"]

    Wait For Elements State    [data-bid-confirmation]    visible    timeout=10s
    Get Text    [data-bid-confirmation]    contains    Your bid of $25 is the high bid.
    Get Text    [data-bid-confirmation]    contains    You are Bidder #1
    Get Text    [data-bid-confirmation]    contains    ${NOTICE}
    Get Text    .auction-bid-box [data-field="current"]    ==    $25
    # The label switches from "Starting bid" once a bid exists (CSS uppercases it, so read textContent).
    ${label}=    Evaluate JavaScript    .auction-bid-box [data-field="current-label"]    (el) => el.textContent
    Should Be Equal    ${label}    Current bid
    Get Text    .auction-bid-box [data-field="high-paddle"]    contains    High bidder #1
    Get Text    [data-field="min-next"]    ==    30
    Get Text    [data-field="status"]    contains    You're the high bidder
    # Ticked once per auction; it's gone for the next bid.
    Get Element Count    input[name="shipping_ack"]    ==    0

A Bid Below The Minimum Shows The New Minimum Inline
    ${auction}=    Seed Auction
    ${item}=    Seed Auction Item    ${auction}    starting_bid_cents=2000
    ${other}=    Seed Bidder    email=other@example.com    name=Other Bidder
    Seed Bid    ${item}    ${other}    4000
    Navigate To    /auctions/login?returnTo=/auctions/${auction}/items/${item}
    Sign In As Bidder
    # The input's min would stop the browser submitting 42; type past it via the form's own check.
    Evaluate JavaScript    input[name="amount"]    (el) => el.removeAttribute('min')
    Fill Text    input[name="amount"]    42
    Check Checkbox    input[name="shipping_ack"]
    Click    [data-bid-form] button[type="submit"]
    Wait For Elements State    [data-bid-error]    visible    timeout=10s
    Get Text    [data-bid-error]    contains    at least $45

A Closed Auction Shows No Bid Form
    ${auction}=    Seed Auction    start_offset_min=-180    end_offset_min=-1
    ${item}=    Seed Auction Item    ${auction}
    Navigate To    /auctions/${auction}/items/${item}
    Get Text    .auction-meta    contains    Bidding closed
    Get Element Count    [data-bid-form]    ==    0
    Get Element Count    text=Sign in to bid    ==    0

Admin Removes A Bid With A Reason And The Previous Bid Becomes High
    ${auction}=    Seed Auction
    ${item}=    Seed Auction Item    ${auction}    title=Game Ball
    ${alice}=    Seed Bidder    email=alice@example.com    name=Alice Able
    ${bob}=    Seed Bidder    email=bob@example.com    name=Bob Baker
    Seed Bid    ${item}    ${alice}    2000
    ${bid}=    Seed Bid    ${item}    ${bob}    9000
    Login As Admin
    Navigate To    /admin/auctions/${auction}/items/${item}/bids
    Click    tr[data-bid-id="${bid}"] button[data-dialog-open]
    Wait For Elements State    dialog#remove-bid-${bid}    visible
    Fill Text    dialog#remove-bid-${bid} input[name="reason"]    Bidder meant $90, not $9000
    Click    dialog#remove-bid-${bid} button[type="submit"]
    Flash Success Should Be Visible    The high bid is now $20.
    Get Text    tr[data-bid-id="${bid}"]    contains    Removed

    Navigate To    /auctions/${auction}/items/${item}
    Get Text    .auction-bid-box [data-field="current"]    ==    $20

Admin Dashboard Shows Totals And Downloads Winners
    ${auction}=    Seed Auction
    ${helmet}=    Seed Auction Item    ${auction}    title=Helmet    starting_bid_cents=10000
    Seed Auction Item    ${auction}    title=Unloved Mug    starting_bid_cents=500
    ${alice}=    Seed Bidder    email=alice@example.com    name=Alice Able
    Seed Bid    ${helmet}    ${alice}    12500
    Login As Admin
    Navigate To    /admin/auctions/${auction}/dashboard
    Get Text    [data-stat="committed"]    ==    $125
    Get Text    [data-stat="bids"]    ==    1
    Get Text    table#item-leaderboard    contains    Alice Able
    Get Text    table#item-leaderboard tr.auction-no-bids    contains    Unloved Mug

    Click    nav.auction-subnav >> text=Winners
    ${csv}=    Download Via Click    text=Download Winners (CSV)    winners.csv
    ${content}=    Get File    ${csv}
    Should Contain    ${content}    Helmet,100.00,125.00,1,1,Alice Able,alice@example.com,406-555-0100
    Should Contain    ${content}    Unloved Mug,5.00,,0,

Item Page Works On A Phone
    [Documentation]    375px wide: tapping a thumbnail swaps the main photo, and a bar pinned to the
    ...    bottom of the screen shows the price and jumps to the bid form.
    ${auction}=    Seed Auction
    ${item}=    Seed Auction Item    ${auction}    photos=3
    Seed Bidder    email=phone@example.com
    Set Viewport Size    375    812
    Navigate To    /auctions/login?returnTo=/auctions/${auction}/items/${item}
    Sign In As Bidder    email=phone@example.com
    ${first}=    Get Attribute    [data-gallery-main]    src
    Click    [data-gallery-thumb] >> nth=2
    ${now}=    Get Attribute    [data-gallery-main]    src
    Should Not Be Equal    ${first}    ${now}
    Get Attribute    [data-gallery-thumb] >> nth=2    aria-current    ==    true
    ${position}=    Get Style    .auction-mobile-bar    position
    Should Be Equal    ${position}    fixed
    Get Text    .auction-mobile-bar [data-field="current"]    ==    $20
    Click    .auction-mobile-bar a.btn
    Current URL Should Contain    \#bid-amount
    ${top}=    Evaluate JavaScript    input#bid-amount    (el) => el.getBoundingClientRect().top
    Should Be True    0 <= ${top} < 812
    ${width}=    Evaluate JavaScript    ${None}    () => document.documentElement.scrollWidth
    Should Be True    ${width} <= 375

Outbid Bidder Sees The New Price And A Banner Without Reloading
    [Documentation]    Two browser contexts, two bidders. A marker set on Alice's page proves the
    ...    update arrived over the live stream rather than through a reload.
    ${auction}=    Seed Auction
    ${item}=    Seed Auction Item    ${auction}    title=Game Ball    starting_bid_cents=2000
    ${alice_ctx}=    Get Context Ids    CURRENT
    Navigate To    /auctions/login?returnTo=/auctions/${auction}/items/${item}
    Sign In As Bidder    email=alice@example.com    name=Alice
    Fill Text    input[name="amount"]    20
    Check Checkbox    input[name="shipping_ack"]
    Click    [data-bid-form] button[type="submit"]
    Wait For Elements State    [data-bid-confirmation]    visible    timeout=10s
    Evaluate JavaScript    ${None}    () => { window.__noReload = true; }

    New Context    userAgent=${BROWSER_USER_AGENT}
    New Page    ${BASE_URL}/auctions/login?returnTo=/auctions/${auction}/items/${item}
    Sign In As Bidder    email=bob@example.com    name=Bob
    Fill Text    input[name="amount"]    30
    Check Checkbox    input[name="shipping_ack"]
    Click    [data-bid-form] button[type="submit"]
    Wait For Elements State    [data-bid-confirmation]    visible    timeout=10s

    Switch Context    ${alice_ctx}[0]
    Wait For Elements State    [data-live-status]    visible    timeout=10s
    Get Text    [data-live-status]    contains    You've been outbid on Game Ball
    Get Text    [data-live-status]    contains    $35 or more
    Get Text    .auction-bid-box [data-field="current"]    ==    $30
    Get Text    [data-field="status"]    contains    outbid
    Get Text    [data-bid-history] li >> nth=0    contains    Bidder #2
    # Her earlier "your bid is the high bid" confirmation is gone now that she's been outbid.
    Wait For Elements State    [data-bid-confirmation]    hidden    timeout=5s
    ${still_here}=    Evaluate JavaScript    ${None}    () => window.__noReload === true
    Should Be True    ${still_here}

Admin Dashboard Updates Live When A Bid Lands
    ${auction}=    Seed Auction
    ${item}=    Seed Auction Item    ${auction}    title=Signed Jersey    starting_bid_cents=5000
    ${admin_ctx}=    Get Context Ids    CURRENT
    Login As Admin
    Navigate To    /admin/auctions/${auction}/dashboard
    Wait For Elements State    [data-live-status]    visible    timeout=10s
    Get Text    [data-stat="bids"]    ==    0
    Evaluate JavaScript    ${None}    () => { window.__noReload = true; }

    New Context    userAgent=${BROWSER_USER_AGENT}
    New Page    ${BASE_URL}/auctions/login?returnTo=/auctions/${auction}/items/${item}
    Sign In As Bidder    email=carol@example.com    name=Carol Collector
    Fill Text    input[name="amount"]    75
    Check Checkbox    input[name="shipping_ack"]
    Click    [data-bid-form] button[type="submit"]
    Wait For Elements State    [data-bid-confirmation]    visible    timeout=10s

    Switch Context    ${admin_ctx}[0]
    Wait For Condition    Text    [data-stat="bids"]    ==    1    timeout=10s
    Get Text    [data-stat="committed"]    ==    $75
    Get Text    [data-recent-bids] tr >> nth=0    contains    \#1 Carol Collector
    Get Text    table#item-leaderboard tr[data-item-id="${item}"]    contains    Carol Collector
    ${still_here}=    Evaluate JavaScript    ${None}    () => window.__noReload === true
    Should Be True    ${still_here}
