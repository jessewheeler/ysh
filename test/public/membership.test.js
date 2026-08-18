/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const membershipJs = fs.readFileSync(
  path.resolve(__dirname, '../../public/js/membership.js'),
  'utf8'
);

function setupDom({includeFamilySection = true, maxFamily = 6} = {}) {
  document.body.innerHTML = `
    <button class="membership-tab membership-tab-active" data-tab="new" aria-selected="true">Become a Member</button>
    <button class="membership-tab" data-tab="renew" aria-selected="false">Renew Membership</button>

    <div id="tab-new">
      <form class="membership-form">
        <label class="membership-type-card">
          <input type="radio" name="membership_type" value="individual" required>
          <span class="card-type-name">Individual</span>
        </label>
        <label class="membership-type-card">
          <input type="radio" name="membership_type" value="family" required>
          <span class="card-type-name">Family</span>
        </label>

        <input type="text" id="first_name" name="first_name">
        <input type="text" id="last_name" name="last_name">
        <input type="email" id="email" name="email">

        ${includeFamilySection ? `
          <fieldset id="family-members-section" data-max="${maxFamily}" hidden>
            <div id="family-members-container"></div>
            <p id="family-members-limit" hidden>That's the maximum.</p>
            <button type="button" id="add-family-member">+ Add family member</button>
          </fieldset>
        ` : ''}

        <button type="submit">Continue to Payment</button>
      </form>
    </div>

    <div id="tab-renew" hidden>
      <form><input type="email" id="renew_email" name="email"></form>
    </div>
  `;

  new Function(membershipJs)();
}

function chooseFamily() {
    const radio = document.querySelector('input[value="family"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
}

function addMembers(n) {
    for (let i = 0; i < n; i++) document.getElementById('add-family-member').click();
}

function fieldNames() {
    return [...document.querySelectorAll('#family-members-container input')].map(i => i.name);
}

describe('the whole form is available from the start', () => {
  beforeEach(() => setupDom());

    test('personal fields are present without choosing a plan first', () => {
        // The panel used to show two prices and 330px of blank white until you guessed
        // to click a card, with nothing saying a click was expected.
        ['first_name', 'last_name', 'email'].forEach(id => {
            expect(document.getElementById(id)).not.toBeNull();
        });
  });

    test('no plan is preselected, and the radios are required', () => {
        const radios = [...document.querySelectorAll('input[name="membership_type"]')];
        expect(radios.some(r => r.checked)).toBe(false);
        radios.forEach(r => expect(r.required).toBe(true));
  });
});

describe('tab switching', () => {
    beforeEach(() => setupDom());

    test('the renew panel is hidden until its tab is chosen', () => {
        expect(document.getElementById('tab-renew').hidden).toBe(true);
        document.querySelector('[data-tab="renew"]').click();
        expect(document.getElementById('tab-renew').hidden).toBe(false);
        expect(document.getElementById('tab-new').hidden).toBe(true);
  });

    test('aria-selected follows the active tab', () => {
        document.querySelector('[data-tab="renew"]').click();
        expect(document.querySelector('[data-tab="renew"]').getAttribute('aria-selected')).toBe('true');
        expect(document.querySelector('[data-tab="new"]').getAttribute('aria-selected')).toBe('false');
  });
});

describe('family members section', () => {
  beforeEach(() => setupDom());

    test('is hidden until the family plan is chosen', () => {
        expect(document.getElementById('family-members-section').hidden).toBe(true);
        chooseFamily();
        expect(document.getElementById('family-members-section').hidden).toBe(false);
    });

    test('hides again when switching back to individual', () => {
        chooseFamily();
        const individual = document.querySelector('input[value="individual"]');
        individual.checked = true;
        individual.dispatchEvent(new Event('change'));
        expect(document.getElementById('family-members-section').hidden).toBe(true);
    });

    test('adding a member appends a row with named fields', () => {
        chooseFamily();
        addMembers(1);
        expect(document.querySelectorAll('.family-member-row')).toHaveLength(1);
        expect(fieldNames()).toEqual([
            'family_members[0][first_name]',
            'family_members[0][last_name]',
            'family_members[0][email]',
        ]);
    });

    test('every label points at its own input', () => {
        // A bare label with no `for` does not focus its input when tapped.
        chooseFamily();
        addMembers(2);
        const labels = [...document.querySelectorAll('#family-members-container label')];
        expect(labels).toHaveLength(6);
        labels.forEach(label => {
            const target = document.getElementById(label.getAttribute('for'));
            expect(target).not.toBeNull();
            expect(target.tagName).toBe('INPUT');
        });
        const ids = labels.map(l => l.getAttribute('for'));
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('prefills the last name from the primary member', () => {
        document.getElementById('last_name').value = 'Wheeler';
        chooseFamily();
        addMembers(1);
        const lastName = document.querySelector('input[name="family_members[0][last_name]"]');
        expect(lastName.value).toBe('Wheeler');
    });

    test('only the email field is optional', () => {
        chooseFamily();
        addMembers(1);
        expect(document.querySelector('input[name="family_members[0][first_name]"]').required).toBe(true);
        expect(document.querySelector('input[name="family_members[0][last_name]"]').required).toBe(true);
        expect(document.querySelector('input[name="family_members[0][email]"]').required).toBe(false);
    });
});

describe('family member field indexes are never reused', () => {
    beforeEach(() => setupDom());

    test('removing a middle row does not make the next row collide with a live one', () => {
        // The old counter decremented on remove, so this sequence gave two live rows the
        // same index. Express parses the duplicate name into an array rather than a
        // string, and the route throws when it trims it — the signup is lost.
        chooseFamily();
        addMembers(3);
        document.querySelectorAll('.family-member-row')[1]
            .querySelector('.btn-remove').click();
        addMembers(1);

        const names = fieldNames();
        expect(new Set(names).size).toBe(names.length);
        expect(names.filter(n => n.includes('first_name'))).toEqual([
            'family_members[0][first_name]',
            'family_members[2][first_name]',
            'family_members[3][first_name]',
        ]);
  });

    test('visible numbering stays sequential after a removal', () => {
        chooseFamily();
        addMembers(3);
        document.querySelectorAll('.family-member-row')[1]
            .querySelector('.btn-remove').click();
        const legends = [...document.querySelectorAll('.family-member-legend')].map(l => l.textContent);
        expect(legends).toEqual(['Family member 1', 'Family member 2']);
    });
});

describe('the additional-member cap', () => {
    beforeEach(() => setupDom({maxFamily: 3}));

    test('stops at max_family_members minus the primary, without an alert', () => {
        const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {
        });
        chooseFamily();
        addMembers(5);
        expect(document.querySelectorAll('.family-member-row')).toHaveLength(2);
        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
  });

    test('swaps the add button for an explanation at the cap', () => {
        chooseFamily();
        addMembers(2);
        expect(document.getElementById('add-family-member').hidden).toBe(true);
        expect(document.getElementById('family-members-limit').hidden).toBe(false);
    });

    test('brings the add button back when a row is removed', () => {
        chooseFamily();
        addMembers(2);
        document.querySelector('.btn-remove').click();
        expect(document.getElementById('add-family-member').hidden).toBe(false);
        expect(document.getElementById('family-members-limit').hidden).toBe(true);
  });
});

describe('without family section in dom', () => {
    test('script does not throw when the family section is absent', () => {
    expect(() => setupDom({ includeFamilySection: false })).not.toThrow();
  });

    test('tabs still work without it', () => {
        setupDom({includeFamilySection: false});
        document.querySelector('[data-tab="renew"]').click();
        expect(document.getElementById('tab-renew').hidden).toBe(false);
    });
});
