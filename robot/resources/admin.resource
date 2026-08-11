*** Settings ***
Resource    common.resource

*** Keywords ***
Login As Admin
    [Documentation]    Logs in via the email/OTP flow.
    ...    1. Submit email on login page
    ...    2. Set known OTP in DB (server's real OTP was emailed and we can't read it)
    ...    3. Enter OTP on verify page
    Navigate To    /admin/login
    Fill Text    input[name="email"]    ${ADMIN_EMAIL}
    Click    button.btn[type="submit"]
    Wait For Elements State    input[name="code"]    visible    timeout=10s
    Fill Text    input[name="code"]    ${OTP_CODE}
    Click    button.btn[type="submit"]
    Wait For Elements State    .stats-grid    visible    timeout=10s

Submit Admin Form
    Click    .form-actions button[type="submit"]

Download Via Click
    [Documentation]    Clicks a download control and returns the saved file path.
    ...    Browser downloads are not saved to disk unless the context asks for it, so this
    ...    promises the download before the click and then copies it somewhere stable.
    [Arguments]    ${selector}    ${filename}=report.xlsx
    ${promise}=    Promise To Wait For Download    saveAs=${DOWNLOAD_DIR}/${filename}
    Click    ${selector}
    ${download}=    Wait For    ${promise}
    RETURN    ${download}[saveAs]
