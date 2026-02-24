(function () {
    const familySection = document.getElementById('family-members-section');
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
        const currentLastName = primaryLastName.value || '';
        const row = document.createElement('div');
        row.className = 'family-member-row';
        row.style.cssText = 'border: 1px solid #ddd; padding: 1rem; margin-bottom: 1rem; border-radius: 4px; position: relative;';
        row.innerHTML =
            '<button type="button" class="remove-family-member" style="position: absolute; top: 0.5rem; right: 0.5rem; background: #dc3545; color: white; border: none; border-radius: 3px; padding: 0.25rem 0.5rem; cursor: pointer;">Remove</button>' +
            '<div class="form-group"><label>First Name</label><input type="text" name="family_members[' + index + '][first_name]" required></div>' +
            '<div class="form-group"><label>Last Name</label><input type="text" name="family_members[' + index + '][last_name]" value="' + currentLastName.replace(/"/g, '&quot;') + '" required></div>' +
            '<div class="form-group"><label>Email (optional - children can use primary member\'s email)</label><input type="email" name="family_members[' + index + '][email]"></div>';

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
