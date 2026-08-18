*** Settings ***
Resource    ../resources/common.resource
Suite Setup    Start Test Server
Suite Teardown    Stop Test Server
Test Setup    Reset Test State
Force Tags    public

*** Variables ***
${ABOUT_CARET}          li.dropdown:has(a.dropdown-toggle[href="/#about"]) .dropdown-caret
${ABOUT_SUBMENU}        li.dropdown:has(a.dropdown-toggle[href="/#about"]) .dropdown-menu
${CHARITABLE_CARET}     li.dropdown:has(a.dropdown-toggle[href="/#charitable"]) .dropdown-caret

*** Test Cases ***
Homepage Loads With All Sections
    Navigate To    /
    Wait For Elements State    section#home-slider h1    visible    timeout=5s
    Get Text    section#news h2    ==    Announcements
    Wait For Elements State    section#gallery    visible
    Wait For Elements State    section#about    visible
    Wait For Elements State    section#contact    visible
    Wait For Elements State    form.contact-form    visible

Bios Page Renders Board Members
    Seed Bios    2
    Navigate To    /bios
    Get Text    h2    contains    Board Members
    ${count}=    Get Element Count    .bio-card
    Should Be True    ${count} >= 1
    Get Text    .bios-grid    contains    Test Person 1

Membership Form Renders Every Field Without A Click
    # The form used to reveal itself a step at a time, so the panel opened on two prices
    # above a large blank area with nothing indicating a click was expected. Nothing here
    # may depend on choosing a plan first.
    Navigate To    /membership
    Get Text    .membership-tab-active    contains    Become a Member
    Page Should Contain Text    $16.00
    Page Should Contain Text    $26.00
    Wait For Elements State    input[name="first_name"]    visible    timeout=3s
    Wait For Elements State    input[name="last_name"]    visible
    # name="email" appears in both the new-member and renew forms; scope to this form.
    Wait For Elements State    .membership-form input[name="email"]    visible
    Wait For Elements State    input[name="phone"]    visible
    Wait For Elements State    input[name="address_street"]    visible
    Wait For Elements State    input[name="address_city"]    visible
    Wait For Elements State    input[name="address_state"]    visible
    Wait For Elements State    input[name="address_zip"]    visible
    Wait For Elements State    .membership-form button[type="submit"]    visible

Membership Page Does Not Scroll Sideways On A Phone
    # Two separate causes, both predating the form rework: the tab labels are nowrap and
    # together exceed the panel, and hCaptcha renders a fixed ~360px widget that an fr
    # track's automatic minimum let stretch the whole grid. 434px of content in a 375px
    # viewport, which clipped the benefits copy on the right.
    Set Viewport Size    375    812
    Navigate To    /membership
    Wait For Elements State    .membership-form    visible    timeout=5s
    ${overflow}=    Evaluate JavaScript    ${EMPTY}
    ...    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    Should Be True    ${overflow} <= 1    Page scrolls ${overflow}px sideways
    ${tabs_fit}=    Evaluate JavaScript    ${EMPTY}
    ...    () => {
    ...        const vw = document.documentElement.clientWidth;
    ...        return [...document.querySelectorAll('.membership-tab')]
    ...            .every(tab => tab.getBoundingClientRect().right <= vw + 1);
    ...    }
    Should Be True    ${tabs_fit}

Membership Plan Radios Are Visible Controls
    # They were opacity: 0, which removed the one cue everyone recognises and left the
    # price cards not reading as controls at all.
    Navigate To    /membership
    Wait For Elements State    .membership-type-card input[value="individual"]    visible    timeout=3s
    Wait For Elements State    .membership-type-card input[value="family"]    visible
    ${size}=    Evaluate JavaScript    .membership-type-card input[value="individual"]
    ...    (input) => {
    ...        const box = input.getBoundingClientRect();
    ...        return Math.min(box.width, box.height);
    ...    }
    Should Be True    ${size} >= 16
    # No plan is preselected, so the browser has to ask rather than assume a price.
    ${checked}=    Evaluate JavaScript    ${EMPTY}
    ...    () => document.querySelectorAll('input[name="membership_type"]:checked').length
    Should Be Equal As Integers    ${checked}    0

Membership Captcha Sits Directly Above The Submit Button
    # It used to gate the fields, so anyone who could not solve it never learned a form
    # existed. Rendered only when a site key is configured, so this checks the ordering
    # of whatever is present rather than requiring the widget.
    Navigate To    /membership
    ${submit_is_last}=    Evaluate JavaScript    .membership-form
    ...    (form) => {
    ...        const submit = form.querySelector('button[type="submit"]');
    ...        const captcha = form.querySelector('.h-captcha');
    ...        if (!captcha) return submit === form.lastElementChild;
    ...        return captcha.compareDocumentPosition(submit) === Node.DOCUMENT_POSITION_FOLLOWING;
    ...    }
    Should Be True    ${submit_is_last}

Membership Validates Required Fields
    Navigate To    /membership
    Fill Text    input[name="first_name"]    OnlyFirst
    Evaluate JavaScript    .membership-form
    ...    (form) => {
    ...        form.querySelectorAll('[required]').forEach(el => el.removeAttribute('required'));
    ...    }
    Click    .membership-form button[type="submit"]
    Flash Error Should Be Visible    required

Membership Signup Attempts Stripe
    Navigate To    /membership
    Click    .membership-type-card:has(input[value="individual"])
    Fill Text    input[name="first_name"]    Robot
    Fill Text    input[name="last_name"]    Tester
    Fill Text    .membership-form input[name="email"]    robot_stripe@example.com
    Fill Text    input[name="phone"]    4065551234
    Fill Text    input[name="address_city"]    Billings
    Fill Text    input[name="address_state"]    MT
    Fill Text    input[name="address_zip"]    59101
    Click    .membership-form button[type="submit"]
    Sleep    2s
    ${count}=    Get Row Count    members
    Should Be True    ${count} >= 1

Contact Form Validates Required Fields
    Navigate To    /
    Evaluate JavaScript    form.contact-form
    ...    (form) => {
    ...        form.querySelectorAll('[required]').forEach(el => el.removeAttribute('required'));
    ...    }
    Fill Text    input[name="name"]    ${EMPTY}
    Fill Text    input[name="email"]    ${EMPTY}
    Fill Text    textarea[name="message"]    ${EMPTY}
    Click    form.contact-form button[type="submit"]
    Flash Error Should Be Visible    required

Contact Form Submits Successfully
    Navigate To    /
    Scroll To Element    section#contact
    Fill Text    input[name="name"]    Robot Contact
    Fill Text    input[name="email"]    contact@example.com
    Fill Text    textarea[name="message"]    Hello from the robot tests!
    Click    form.contact-form button[type="submit"]
    Wait For Elements State    h2    visible    timeout=5s
    Get Text    h2    contains    Message Sent

Membership Success Page Renders
    Navigate To    /membership/success
    Get Text    h2    contains    Welcome to the Yellowstone Sea Hawkers

Membership Cancel Page Renders
    Navigate To    /membership/cancel
    Get Text    h2    contains    Payment Cancelled

Family Membership Shows Add Family Member Section
    Navigate To    /membership
    Wait For Elements State    \#family-members-section    hidden
    Click    .membership-type-card:has(input[value="family"])
    Wait For Elements State    \#family-members-section    visible    timeout=3s
    Wait For Elements State    \#add-family-member    visible    timeout=3s

Family Membership Can Add A Family Member Row
    Navigate To    /membership
    Click    .membership-type-card:has(input[value="family"])
    Wait For Elements State    \#add-family-member    visible    timeout=3s
    Click    \#add-family-member
    Wait For Elements State    .family-member-row    visible    timeout=3s
    Wait For Elements State    .family-member-row input[name*="first_name"]    visible

Family Member Rows Never Reuse A Field Index
    # Add three, remove the middle, add another: the old counter handed the new row the
    # index of a live one. Express parses the duplicate name into an array rather than a
    # string, and the route threw when it trimmed it, losing the entire signup.
    Navigate To    /membership
    Click    .membership-type-card:has(input[value="family"])
    Wait For Elements State    \#add-family-member    visible    timeout=3s
    Click    \#add-family-member
    Click    \#add-family-member
    Click    \#add-family-member
    Get Element Count    .family-member-row    ==    3
    Click    .family-member-row:nth-child(2) .btn-remove
    Click    \#add-family-member
    Get Element Count    .family-member-row    ==    3
    ${total}=    Evaluate JavaScript    ${EMPTY}
    ...    () => document.querySelectorAll('#family-members-container input').length
    ${unique}=    Evaluate JavaScript    ${EMPTY}
    ...    () => {
    ...        const inputs = document.querySelectorAll('#family-members-container input');
    ...        return new Set([...inputs].map(i => i.name)).size;
    ...    }
    Should Be Equal As Integers    ${total}    9
    Should Be Equal As Integers    ${unique}    ${total}

Family Member Labels Focus Their Own Input
    # The generated rows used bare labels with no `for`, so tapping one did nothing —
    # worst on a phone, where the label is the easiest target to hit.
    Navigate To    /membership
    Click    .membership-type-card:has(input[value="family"])
    Wait For Elements State    \#add-family-member    visible    timeout=3s
    Click    \#add-family-member
    Click    .family-member-row label[for$="last_name"]
    ${focused}=    Evaluate JavaScript    ${EMPTY}    () => document.activeElement.name
    Should Contain    ${focused}    last_name

Renew Tab Shows Its Email Field Immediately
    # The captcha used to gate this field, so anyone who could not solve it never saw
    # that a renewal form existed.
    Navigate To    /membership
    Click    .membership-tab[data-tab="renew"]
    Wait For Elements State    \#renew_email    visible    timeout=3s
    Wait For Elements State    \#tab-new    hidden

Family Membership Switching Back To Individual Hides Section
    Navigate To    /membership
    Click    .membership-type-card:has(input[value="family"])
    Wait For Elements State    \#family-members-section    visible    timeout=3s
    Click    .membership-type-card:has(input[value="individual"])
    Wait For Elements State    \#family-members-section    hidden    timeout=3s

Man Crush Monday Page Renders The Wall
    Navigate To    /man-crush-monday
    Get Text    h2    contains    ManCrushMonday
    Page Should Contain Text    run by Kate
    Page Should Contain Text    Kate does not take nominations
    ${count}=    Get Element Count    .mcm-frame
    Should Be Equal As Integers    ${count}    24
    Get Text    .mcm-wall    contains    Julian Love

Man Crush Monday Reachable From About Nav
    # Navigating straight to the URL would pass whether or not the nav entry works.
    Navigate To    /
    Hover    .nav-menu li.dropdown:has(a.dropdown-toggle[href="/#about"])
    ${link}=    Set Variable    .nav-menu li.dropdown a[href="/man-crush-monday"]
    Wait For Elements State    ${link}    visible    timeout=3s
    Click    ${link}
    Current URL Should Contain    /man-crush-monday
    Get Text    h2    contains    ManCrushMonday

Man Crush Monday Scrolls Infinitely Back To Signing Day
    # Proves the fetch in /js/mcm.js is not being blocked by CSP.
    Navigate To    /man-crush-monday
    ${before}=    Get Element Count    .mcm-frame
    Scroll To Element    \#mcm-sentinel
    Wait Until Keyword Succeeds    10x    1s    Frame Count Should Exceed    ${before}

Battle Of The Birds Page Links Out To The News Video
    # Deliberately a link, not an iframe: the owner disabled off-site playback, so an
    # embed renders a black "Video unavailable" box mid-page.
    Navigate To    /charitable/battle-of-the-birds
    Get Text    h2    contains    Battle of the Birds
    Wait For Elements State    a.video-card    visible    timeout=5s
    ${href}=    Get Attribute    a.video-card    href
    Should Contain    ${href}    youtu.be/0S-kCaPTRlo
    # Any iframe, not .video-embed iframe — that wrapper no longer exists in any
    # template, so scoping to it would pass even if a bare embed came back.
    Get Element Count    iframe    ==    0
    Page Should Contain Text    KTVQ
    Page Should Contain Text    Watch on YouTube

Battle Of The Birds Thumbnail Is Served Locally
    # A hotlinked thumbnail would put this page back to depending on a third party.
    Navigate To    /charitable/battle-of-the-birds
    ${src}=    Get Attribute    a.video-card img    src
    Should Contain    ${src}    /img/ktvq-battle-of-the-birds.jpg
    ${loaded}=    Evaluate JavaScript    a.video-card img    (img) => img.naturalWidth > 0
    Should Be True    ${loaded}

Phone Menu Opens Submenus On Tap
    # The submenu used to open on :hover only. Touch devices have no hover, so on a
    # phone /bios and /man-crush-monday had no route in from the navigation at all.
    # Navigating straight to the URL would pass whether or not the control works.
    Set Viewport Size    390    844
    Navigate To    /
    Wait For Elements State    .nav-toggle    visible    timeout=5s
    Click    .nav-toggle
    Wait For Elements State    .nav-menu.active    visible    timeout=3s
    Wait For Elements State    ${ABOUT_SUBMENU}    hidden
    Click    ${ABOUT_CARET}
    Wait For Elements State    ${ABOUT_SUBMENU}    visible    timeout=3s
    Get Attribute    ${ABOUT_CARET}    aria-expanded    ==    true
    Click    .nav-menu a[href="/man-crush-monday"]
    Current URL Should Contain    /man-crush-monday
    Get Text    h2    contains    ManCrushMonday

Phone Menu Reaches Board Member Bios
    Set Viewport Size    390    844
    Navigate To    /
    Click    .nav-toggle
    Click    ${ABOUT_CARET}
    Wait For Elements State    .nav-menu a[href="/bios"]    visible    timeout=3s
    Click    .nav-menu a[href="/bios"]
    Current URL Should Contain    /bios

Phone Menu Reaches The Charitable Pages
    Set Viewport Size    390    844
    Navigate To    /
    Click    .nav-toggle
    Click    ${CHARITABLE_CARET}
    Wait For Elements State    .nav-menu a[href="/charitable/heartwheels"]    visible    timeout=3s
    Click    .nav-menu a[href="/charitable/heartwheels"]
    Current URL Should Contain    /charitable/heartwheels

Phone Menu Collapses Submenus When The Menu Closes
    Set Viewport Size    390    844
    Navigate To    /
    Click    .nav-toggle
    Click    ${ABOUT_CARET}
    Wait For Elements State    ${ABOUT_SUBMENU}    visible    timeout=3s
    Click    .nav-toggle
    Get Attribute    ${ABOUT_CARET}    aria-expanded    ==    false

Desktop Caret Click Does Not Pin The Submenu Open
    # A caret click adds .dropdown--open, which opens the menu at every width. Without a
    # click-outside handler the panel stayed overlaid on the page after the pointer left.
    Set Viewport Size    1400    900
    Navigate To    /
    Click    ${ABOUT_CARET}
    Wait For Elements State    ${ABOUT_SUBMENU}    visible    timeout=3s
    Click    section#news h2
    Wait For Elements State    ${ABOUT_SUBMENU}    hidden    timeout=3s
    Get Attribute    ${ABOUT_CARET}    aria-expanded    ==    false

Escape Closes A Desktop Submenu
    # Escape returns focus to the caret. While :focus-within also opened the menu, that
    # focus re-opened it on the spot while aria-expanded reported "false".
    # The pointer has to move off the item first: :hover legitimately holds the menu open
    # at this width, and Escape is not meant to fight it.
    Set Viewport Size    1400    900
    Navigate To    /
    Click    ${ABOUT_CARET}
    Hover    .nav-menu a[href="/membership"]
    Wait For Elements State    ${ABOUT_SUBMENU}    visible    timeout=3s
    Keyboard Key    press    Escape
    Wait For Elements State    ${ABOUT_SUBMENU}    hidden    timeout=3s
    Get Attribute    ${ABOUT_CARET}    aria-expanded    ==    false

Keyboard Focus Alone Does Not Open A Submenu
    # aria-expanded tracks the class the caret toggles, so opening on :focus-within too
    # would let the menu be open while the attribute said it was closed.
    Set Viewport Size    1400    900
    Navigate To    /
    ${state}=    Evaluate JavaScript    ${ABOUT_CARET}
    ...    (caret) => {
    ...        caret.focus();
    ...        const menu = caret.parentElement.querySelector('.dropdown-menu');
    ...        return getComputedStyle(menu).display + '|' + caret.getAttribute('aria-expanded');
    ...    }
    Should Be Equal    ${state}    none|false

Phone Menu Button Icon Is Centred
    # The icon used to be centred by line-height and text-align, which both stop working
    # once the media query flips the button to display: flex — the glyph became an
    # anonymous flex item in the start corner, visibly left of centre and high inside
    # its focus ring.
    Set Viewport Size    390    844
    Navigate To    /
    Wait For Elements State    .nav-toggle    visible    timeout=5s
    ${offset}=    Evaluate JavaScript    .nav-toggle
    ...    (btn) => {
    ...        const box = btn.getBoundingClientRect();
    ...        const range = document.createRange();
    ...        range.selectNodeContents(btn);
    ...        const glyph = range.getBoundingClientRect();
    ...        return Math.max(
    ...            Math.abs((glyph.left + glyph.width / 2) - (box.left + box.width / 2)),
    ...            Math.abs((glyph.top + glyph.height / 2) - (box.top + box.height / 2))
    ...        );
    ...    }
    # Allows for the glyph's own font metrics being marginally asymmetric.
    Should Be True    ${offset} < 2
    ...    Menu icon is ${offset}px off centre inside its 44px button

In Page Anchors Clear The Sticky Navbar
    # The navbar is sticky, so without scroll-margin-top on the targets an anchor jump
    # parks the heading behind it — "About YSH" was hidden completely.
    FOR    ${id}    IN    news    about    gallery    membership    charitable    contact
        Anchor Heading Should Be Below The Navbar    ${id}
    END

Phone In Page Anchors Clear The Sticky Navbar
    Set Viewport Size    390    844
    FOR    ${id}    IN    news    about    contact
        Anchor Heading Should Be Below The Navbar    ${id}
    END

Desktop Nav Keeps Carets On The Link Row
    # The .dropdown row is a flex container so the caret can sit beside its link. It must
    # not wrap at desktop widths: with flex-wrap allowed, the carets dropped onto a second
    # line as soon as the nav got tight, which regressed once during this work.
    Set Viewport Size    1025    800
    Navigate To    /
    Wait For Elements State    ${ABOUT_CARET}    visible    timeout=5s
    ${same_row}=    Evaluate JavaScript    ${ABOUT_CARET}
    ...    (caret) => {
    ...        const link = caret.parentElement.querySelector('a.dropdown-toggle');
    ...        const gap = caret.getBoundingClientRect().top - link.getBoundingClientRect().top;
    ...        return Math.abs(gap) < 8;
    ...    }
    Should Be True    ${same_row}
    ${scrolls}=    Evaluate JavaScript    ${EMPTY}
    ...    () => document.documentElement.scrollWidth > window.innerWidth
    Should Not Be True    ${scrolls}

Nav Logo Keeps Its Aspect Ratio On A Tablet
    # Between roughly 769px and 1100px the logo used to shrink horizontally while its
    # height stayed fixed, squashing the wordmark about 4x.
    Set Viewport Size    834    1112
    Navigate To    /
    Wait For Elements State    .nav-logo    visible    timeout=5s
    ${skew}=    Evaluate JavaScript    .nav-logo
    ...    (img) => {
    ...        const box = img.getBoundingClientRect();
    ...        return (box.width / box.height) / (img.naturalWidth / img.naturalHeight);
    ...    }
    Should Be True    ${skew} > 0.97 and ${skew} < 1.03

Primary Buttons Use The Readable Label Color
    # White on #69be28 measures 2.33:1 and fails WCAG AA; navy measures 6.06:1.
    Navigate To    /
    ${color}=    Evaluate JavaScript    section#membership a.btn
    ...    (el) => getComputedStyle(el).color
    Should Be Equal    ${color}    rgb(0, 42, 92)

*** Keywords ***
Anchor Heading Should Be Below The Navbar
    [Arguments]    ${id}
    Navigate To    /\#${id}
    # The navbar shrinks over 0.3s on scroll; measuring mid-transition reads a taller bar.
    Sleep    0.6s
    ${clearance}=    Evaluate JavaScript    ${EMPTY}
    ...    () => {
    ...        const nav = document.querySelector('.navbar').getBoundingClientRect();
    ...        const heading = document.querySelector('#${id} h2').getBoundingClientRect();
    ...        return Math.round(heading.top - nav.bottom);
    ...    }
    Should Be True    ${clearance} >= 0
    ...    Heading for #${id} sits ${clearance}px behind the sticky navbar

Frame Count Should Exceed
    [Arguments]    ${count}
    Scroll To Element    \#mcm-sentinel
    ${now}=    Get Element Count    .mcm-frame
    Should Be True    ${now} > ${count}
