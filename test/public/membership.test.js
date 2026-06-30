/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const membershipJs = fs.readFileSync(
  path.resolve(__dirname, '../../public/js/membership.js'),
  'utf8'
);

function setupDom({ includeFamilySection = true, includeCaptcha = false } = {}) {
  document.body.innerHTML = `
    <form class="membership-form">
      <label class="membership-type-card">
        <input type="radio" name="membership_type" value="individual">
        <div class="card-check"></div>
        <div class="card-type-name">Individual</div>
      </label>
      <label class="membership-type-card">
        <input type="radio" name="membership_type" value="family">
        <div class="card-check"></div>
        <div class="card-type-name">Family</div>
      </label>

      <div id="membership-captcha-step" style="display: none;">
        ${includeCaptcha ? '<div class="h-captcha" data-sitekey="test-key"></div>' : ''}
      </div>

      <div id="membership-pii-section" style="display: none;">
        ${includeFamilySection ? `
          <div id="family-members-section" data-max="6" style="display: none;">
            <h3>Additional Family Members</h3>
            <div id="family-members-container"></div>
            <button type="button" id="add-family-member">+ Add Family Member</button>
          </div>
        ` : ''}

        <input type="text" id="first_name" name="first_name">
        <input type="text" id="last_name" name="last_name">
        <input type="email" id="email" name="email">
        <button type="submit">Continue to Payment</button>
      </div>
    </form>
  `;

  // eslint-disable-next-line no-new-func
  new Function(membershipJs)();
}

describe('membership type card picker', () => {
  beforeEach(() => setupDom());

  test('no card is selected by default', () => {
    const cards = document.querySelectorAll('.membership-type-card');
    cards.forEach(c => expect(c.classList.contains('selected')).toBe(false));
  });

  test('clicking individual card selects it', () => {
    const indCard = document.querySelector('.membership-type-card:has(input[value="individual"])');
    indCard.click();
    expect(indCard.classList.contains('selected')).toBe(true);
  });

  test('clicking family card selects it and deselects individual', () => {
    const indCard = document.querySelector('.membership-type-card:has(input[value="individual"])');
    const famCard = document.querySelector('.membership-type-card:has(input[value="family"])');
    indCard.click();
    famCard.click();
    expect(famCard.classList.contains('selected')).toBe(true);
    expect(indCard.classList.contains('selected')).toBe(false);
  });

  test('clicking family card checks the family radio', () => {
    const famCard = document.querySelector('.membership-type-card:has(input[value="family"])');
    famCard.click();
    expect(document.querySelector('input[value="family"]').checked).toBe(true);
  });
});

describe('captcha step — dev mode (no captcha widget)', () => {
  beforeEach(() => setupDom({ includeCaptcha: false }));

  test('captcha step stays hidden when a card is clicked', () => {
    document.querySelector('.membership-type-card').click();
    const captchaStep = document.getElementById('membership-captcha-step');
    expect(captchaStep.style.display).toBe('none');
  });

  test('PII section is revealed immediately when a card is clicked', () => {
    document.querySelector('.membership-type-card').click();
    const pii = document.getElementById('membership-pii-section');
    expect(pii.style.display).toBe('block');
  });

  test('clicking a second card does not hide the PII section', () => {
    const [indCard, famCard] = document.querySelectorAll('.membership-type-card');
    indCard.click();
    famCard.click();
    expect(document.getElementById('membership-pii-section').style.display).toBe('block');
  });
});

describe('captcha step — with captcha widget', () => {
  beforeEach(() => setupDom({ includeCaptcha: true }));

  test('captcha step is revealed when a card is clicked', () => {
    document.querySelector('.membership-type-card').click();
    const captchaStep = document.getElementById('membership-captcha-step');
    expect(captchaStep.style.display).toBe('block');
  });

  test('PII section stays hidden until captcha is completed', () => {
    document.querySelector('.membership-type-card').click();
    const pii = document.getElementById('membership-pii-section');
    expect(pii.style.display).toBe('none');
  });

  test('onMembershipCaptchaComplete reveals PII and hides captcha step', () => {
    document.querySelector('.membership-type-card').click();
    window.onMembershipCaptchaComplete();
    expect(document.getElementById('membership-pii-section').style.display).toBe('block');
    expect(document.getElementById('membership-captcha-step').style.display).toBe('none');
  });
});

describe('family members section', () => {
  beforeEach(() => setupDom());

  test('family section is hidden initially', () => {
    expect(document.getElementById('family-members-section').style.display).toBe('none');
  });

  test('clicking family card shows the family members section', () => {
    const famCard = document.querySelector('.membership-type-card:has(input[value="family"])');
    famCard.click();
    expect(document.getElementById('family-members-section').style.display).toBe('block');
  });

  test('clicking individual card after family hides the family members section', () => {
    const famCard = document.querySelector('.membership-type-card:has(input[value="family"])');
    const indCard = document.querySelector('.membership-type-card:has(input[value="individual"])');
    famCard.click();
    indCard.click();
    expect(document.getElementById('family-members-section').style.display).toBe('none');
  });

  test('add family member button appends a member row', () => {
    const famCard = document.querySelector('.membership-type-card:has(input[value="family"])');
    famCard.click();
    document.getElementById('add-family-member').click();
    const rows = document.querySelectorAll('.family-member-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('input[name*="first_name"]')).not.toBeNull();
  });
});

describe('without family section in dom', () => {
  test('script does not throw when family section is absent', () => {
    expect(() => setupDom({ includeFamilySection: false })).not.toThrow();
  });
});
