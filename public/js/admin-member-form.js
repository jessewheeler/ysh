(function () {
    const familySection = document.getElementById('family-members-section');
    const familyContainer = document.getElementById('family-members-container');
    const addBtn = document.getElementById('add-family-member');
    const radios = document.querySelectorAll('input[name="membership_type"]');
    const primaryLastName = document.getElementById('last_name');

    let familyMemberCount = 0;

    radios.forEach(function (radio) {
        radio.addEventListener('change', function () {
            familySection.style.display = radio.value === 'family' ? 'block' : 'none';
        });
    });

    addBtn.addEventListener('click', function () {
        const index = familyMemberCount;
        const currentLastName = primaryLastName.value || '';
        const row = document.createElement('div');
        row.className = 'family-member-row';
        row.style.cssText = 'border: 1px solid #ddd; padding: 1rem; margin-bottom: 1rem; border-radius: 4px; position: relative;';
        row.innerHTML =
            '<button type="button" class="remove-family-member" style="position: absolute; top: 0.5rem; right: 0.5rem; background: #dc3545; color: white; border: none; border-radius: 3px; padding: 0.25rem 0.5rem; cursor: pointer;">Remove</button>' +
            '<div class="form-grid">' +
            '<div class="form-group"><label>First Name</label><input type="text" name="family_members[' + index + '][first_name]" required></div>' +
            '<div class="form-group"><label>Last Name</label><input type="text" name="family_members[' + index + '][last_name]" value="' + currentLastName.replace(/"/g, '&quot;') + '" required></div>' +
            '<div class="form-group"><label>Email (optional)</label><input type="email" name="family_members[' + index + '][email]"></div>' +
            '</div>';

        row.querySelector('.remove-family-member').addEventListener('click', function () {
            row.remove();
            familyMemberCount--;
        });

        familyContainer.appendChild(row);
        familyMemberCount++;
    });
})();
