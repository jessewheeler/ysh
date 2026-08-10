*** Settings ***
Library    Browser
Library    OperatingSystem
Library    ../libraries/ServerManager.py    ${PROJECT_ROOT}
Library    ../libraries/DatabaseManager.py    ${PROJECT_ROOT}
Library    ../libraries/XlsxInspector.py

*** Variables ***
${PROJECT_ROOT}    ${CURDIR}/../..
${BASE_URL}        ${EMPTY}
${ADMIN_EMAIL}     ${EMPTY}
${OTP_CODE}        ${EMPTY}
${DOWNLOAD_DIR}    ${CURDIR}/../results/downloads
${BROWSER_USER_AGENT}    Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
${REPORT_TEMPLATE}    ${PROJECT_ROOT}/assets/council-membership-report-template.xlsx

*** Keywords ***
Start Test Server
    ${url}=    Start Server
    Set Suite Variable    ${BASE_URL}    ${url}
    ${email}=    Get Admin Email
    Set Suite Variable    ${ADMIN_EMAIL}    ${email}
    ${otp}=    Get Otp Code
    Set Suite Variable    ${OTP_CODE}    ${otp}
    Connect To Database

Stop Test Server
    Close Browser    ALL
    Close Database
    Stop Server

Reset Test State
    Reset Database
    Close Browser
    Empty Directory Or Create It    ${DOWNLOAD_DIR}
    New Browser    chromium    headless=true
    # A realistic user agent matters: campaign visit tracking skips bot-looking agents, and
    # headless Chromium's default UA contains "HeadlessChrome", which that filter treats as a
    # bot. Overriding it here means these tests exercise the same path a real visitor does.
    New Context    acceptDownloads=True    userAgent=${BROWSER_USER_AGENT}
    New Page    ${BASE_URL}

Empty Directory Or Create It
    [Arguments]    ${path}
    Create Directory    ${path}
    Empty Directory    ${path}

Navigate To
    [Arguments]    ${path}
    Go To    ${BASE_URL}${path}

Page Should Contain Text
    [Arguments]    ${text}
    Get Text    body    contains    ${text}

Flash Success Should Be Visible
    [Arguments]    ${text}=${EMPTY}
    Wait For Elements State    .flash.flash-success    visible    timeout=10s
    IF    $text
        Get Text    .flash.flash-success    contains    ${text}
    END

Flash Error Should Be Visible
    [Arguments]    ${text}=${EMPTY}
    Wait For Elements State    .flash.flash-error    visible    timeout=10s
    IF    $text
        Get Text    .flash.flash-error    contains    ${text}
    END

Current URL Should Contain
    [Arguments]    ${expected}
    ${url}=    Get Url
    Should Contain    ${url}    ${expected}
