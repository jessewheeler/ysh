(function () {
    const container = document.getElementById('family-members-container');
    const addBtn = document.getElementById('add-family-member');
    const primaryLastName = document.getElementById('last_name');

    if (!container) return; // Not a family membership

    const maxFamilyMembers = parseInt(container.dataset.max, 10) || 6;

    // Ids only need to be unique and paired with their label; the field names are what
    // reindex() keeps in order. Counting up from the rows already on the page avoids
    // colliding with the ones Pug rendered.
    let nextRowId = container.querySelectorAll('.family-member-row').length;

    function reindex() {
        container.querySelectorAll('.family-member-row').forEach(function (row, i) {
            row.querySelectorAll('input').forEach(function (input) {
                const name = input.getAttribute('name');
                if (name) input.setAttribute('name', name.replace(/family_members\[\d+\]/, 'family_members[' + i + ']'));
            });
        });
        renumber();
        updateAddButton();
    }

    function renumber() {
        container.querySelectorAll('.family-member-legend').forEach(function (legend, i) {
            legend.textContent = 'Family member ' + (i + 1);
        });
    }

    function rowCount() {
        return container.querySelectorAll('.family-member-row').length;
    }

    function updateAddButton() {
        if (addBtn) addBtn.hidden = rowCount() >= maxFamilyMembers - 1;
    }

    function field(rowId, index, name, labelText, type, value) {
        const group = document.createElement('div');
        group.className = 'form-group';

        const id = 'renew-family-' + rowId + '-' + name;
        const label = document.createElement('label');
        // Without `for`, tapping the label does nothing — worst on a phone.
        label.setAttribute('for', id);
        label.textContent = labelText;

        const input = document.createElement('input');
        input.type = type;
        input.id = id;
        input.name = 'family_members[' + index + '][' + name + ']';
        if (value) input.value = value;
        if (type !== 'email') input.required = true;

        group.append(label, input);
        return group;
    }

    function wireRemove(btn) {
        btn.addEventListener('click', function () {
            const row = btn.closest('.family-member-row');
            if (row) row.remove();
            reindex();
            if (addBtn) addBtn.focus();
        });
    }

    container.querySelectorAll('.remove-family-member').forEach(wireRemove);

    if (addBtn) {
        addBtn.addEventListener('click', function () {
            if (rowCount() >= maxFamilyMembers - 1) return;

            const index = rowCount();
            const rowId = nextRowId++;

            const row = document.createElement('div');
            row.className = 'family-member-row';

            const head = document.createElement('div');
            head.className = 'family-member-head';

            const legend = document.createElement('span');
            legend.className = 'family-member-legend';

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn-remove remove-family-member';
            remove.textContent = 'Remove';
            wireRemove(remove);

            head.append(legend, remove);
            row.appendChild(head);
            row.appendChild(field(rowId, index, 'first_name', 'First Name', 'text'));
            row.appendChild(field(rowId, index, 'last_name', 'Last Name', 'text',
                primaryLastName ? primaryLastName.value : ''));
            row.appendChild(field(rowId, index, 'email', 'Email (optional)', 'email'));

            container.appendChild(row);
            renumber();
            updateAddButton();

            const firstInput = row.querySelector('input');
            if (firstInput) firstInput.focus();
        });
    }

    renumber();
    updateAddButton();
})();
