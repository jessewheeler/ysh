(function () {
    const container = document.getElementById('family-members-container');
    const addBtn = document.getElementById('add-family-member');
    const primaryLastName = document.getElementById('last_name');

    if (!container) return; // Not a family membership

    const maxFamilyMembers = parseInt(container.dataset.max, 10) || 6;

    function reindex() {
        container.querySelectorAll('.family-member-row').forEach(function (row, i) {
            row.querySelectorAll('input').forEach(function (input) {
                const name = input.getAttribute('name');
                if (name) input.setAttribute('name', name.replace(/family_members\[\d+\]/, 'family_members[' + i + ']'));
            });
        });
        updateAddButton();
    }

    function rowCount() {
        return container.querySelectorAll('.family-member-row').length;
    }

    function updateAddButton() {
        if (addBtn) addBtn.style.display = rowCount() >= maxFamilyMembers - 1 ? 'none' : 'inline-block';
    }

    container.querySelectorAll('.remove-family-member').forEach(function (btn) {
        btn.addEventListener('click', function () {
            btn.closest('.family-member-row').remove();
            reindex();
        });
    });

    if (addBtn) {
        addBtn.addEventListener('click', function () {
            if (rowCount() >= maxFamilyMembers - 1) return;
            const i = rowCount();
            const lastName = primaryLastName ? primaryLastName.value : '';
            const row = document.createElement('div');
            row.className = 'family-member-row';
            row.style.cssText = 'border:1px solid #ddd; padding:1rem; margin-bottom:1rem; border-radius:4px; position:relative;';
            row.innerHTML =
                '<button type="button" class="remove-family-member" style="position:absolute; top:0.5rem; right:0.5rem; background:#dc3545; color:white; border:none; border-radius:3px; padding:0.25rem 0.5rem; cursor:pointer;">Remove</button>' +
                '<div class="form-group"><label>First Name</label><input type="text" name="family_members[' + i + '][first_name]" required></div>' +
                '<div class="form-group"><label>Last Name</label><input type="text" name="family_members[' + i + '][last_name]" value="' + lastName.replace(/"/g, '&quot;') + '" required></div>' +
                '<div class="form-group"><label>Email (optional)</label><input type="email" name="family_members[' + i + '][email]"></div>';
            row.querySelector('.remove-family-member').addEventListener('click', function () {
                row.remove();
                reindex();
            });
            container.appendChild(row);
            updateAddButton();
        });
    }
})();
