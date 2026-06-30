(function () {
  // ── Tab switching ──────────────────────────────────────────────────────────
  const tabBtns = document.querySelectorAll('.membership-tab');
  const tabNew = document.getElementById('tab-new');
  const tabRenew = document.getElementById('tab-renew');

  function switchTab(name) {
    tabBtns.forEach(b => b.classList.toggle('membership-tab-active', b.dataset.tab === name));
    if (tabNew) tabNew.style.display = name === 'new' ? 'block' : 'none';
    if (tabRenew) tabRenew.style.display = name === 'renew' ? 'block' : 'none';

    if (name === 'renew') {
      const captchaStep = document.getElementById('renewal-captcha-step');
      const emailSection = document.getElementById('renewal-email-section');
      const hasCaptcha = captchaStep && captchaStep.querySelector('.h-captcha');
      if (captchaStep && captchaStep.style.display === 'none') {
        if (hasCaptcha) {
          reveal(captchaStep);
        } else {
          if (emailSection) reveal(emailSection);
        }
      }
    }
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ── Shared reveal helper ───────────────────────────────────────────────────
  function reveal(el) {
    el.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('membership-reveal')));
  }

  // ── New Member tab — card picker ──────────────────────────────────────────
  const typeCards = document.querySelectorAll('.membership-type-card');
  const captchaStep = document.getElementById('membership-captcha-step');
  const piiSection = document.getElementById('membership-pii-section');
  const hasCaptcha = captchaStep && captchaStep.querySelector('.h-captcha');

  typeCards.forEach(card => {
    card.addEventListener('click', () => {
      typeCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
      }

      if (captchaStep && captchaStep.style.display === 'none') {
        if (hasCaptcha) {
          reveal(captchaStep);
        } else {
          if (piiSection) reveal(piiSection);
        }
      }
    });
  });

  // hCaptcha callbacks
  window.onMembershipCaptchaComplete = function () {
    if (captchaStep) captchaStep.style.display = 'none';
    if (piiSection) reveal(piiSection);
  };

  window.onRenewalCaptchaComplete = function () {
    const renewalCaptchaStep = document.getElementById('renewal-captcha-step');
    const renewalEmailSection = document.getElementById('renewal-email-section');
    if (renewalCaptchaStep) renewalCaptchaStep.style.display = 'none';
    if (renewalEmailSection) reveal(renewalEmailSection);
  };

  // ── Family members section ─────────────────────────────────────────────────
  const familySection = document.getElementById('family-members-section');
  if (!familySection) return;

  const familyContainer = document.getElementById('family-members-container');
  const addBtn = document.getElementById('add-family-member');
  const radios = document.querySelectorAll('input[name="membership_type"]');
  const primaryLastName = document.getElementById('last_name');
  const maxFamilyMembers = parseInt(familySection.dataset.max, 10) || 6;

  let familyMemberCount = 0;

  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      familySection.style.display = radio.value === 'family' ? 'block' : 'none';
    });
  });

  addBtn.addEventListener('click', () => {
    if (familyMemberCount >= maxFamilyMembers - 1) {
      alert('Maximum ' + (maxFamilyMembers - 1) + ' additional family members allowed.');
      return;
    }

    const index = familyMemberCount;
    const currentLastName = primaryLastName ? primaryLastName.value : '';
    const row = document.createElement('div');
    row.className = 'family-member-row';
    row.style.cssText = 'border: 1px solid #ddd; padding: 1rem; margin-bottom: 1rem; border-radius: 4px; position: relative;';
    row.innerHTML =
      '<button type="button" class="remove-family-member" style="position: absolute; top: 0.5rem; right: 0.5rem; background: #dc3545; color: white; border: none; border-radius: 3px; padding: 0.25rem 0.5rem; cursor: pointer;">Remove</button>' +
      '<div class="form-group"><label>First Name</label><input type="text" name="family_members[' + index + '][first_name]" required></div>' +
      '<div class="form-group"><label>Last Name</label><input type="text" name="family_members[' + index + '][last_name]" value="' + currentLastName.replace(/"/g, '&quot;') + '" required></div>' +
      '<div class="form-group"><label>Email (optional)</label><input type="email" name="family_members[' + index + '][email]"></div>';

    row.querySelector('.remove-family-member').addEventListener('click', () => {
      row.remove();
      familyMemberCount--;
      updateAddButtonVisibility();
    });

    familyContainer.appendChild(row);
    familyMemberCount++;
    updateAddButtonVisibility();
  });

  function updateAddButtonVisibility() {
    addBtn.style.display = familyMemberCount >= maxFamilyMembers - 1 ? 'none' : 'inline-block';
  }
})();
