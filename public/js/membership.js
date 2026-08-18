(function () {
  // ── Tab switching ──────────────────────────────────────────────────────────
  const tabBtns = document.querySelectorAll('.membership-tab');
    const panels = {
        new: document.getElementById('tab-new'),
        renew: document.getElementById('tab-renew'),
    };

  function switchTab(name) {
      tabBtns.forEach(btn => {
          const active = btn.dataset.tab === name;
          btn.classList.toggle('membership-tab-active', active);
          btn.setAttribute('aria-selected', String(active));
      });
      Object.keys(panels).forEach(key => {
          if (panels[key]) panels[key].hidden = key !== name;
      });
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

    // ── Family members ─────────────────────────────────────────────────────────
  const familySection = document.getElementById('family-members-section');
  if (!familySection) return;

    const container = document.getElementById('family-members-container');
  const addBtn = document.getElementById('add-family-member');
    const limitNote = document.getElementById('family-members-limit');
  const radios = document.querySelectorAll('input[name="membership_type"]');
  const primaryLastName = document.getElementById('last_name');
    const maxAdditional = (parseInt(familySection.dataset.max, 10) || 6) - 1;

    // Field names are indexed, and the index must never be reused: a counter that
    // decremented on remove could hand the same index to two live rows (add three,
    // remove the middle, add another), and Express then parses that name into an array
    // instead of a string, which throws when the route trims it. This only ever counts
    // up; the server compacts the gaps a removal leaves behind.
    let nextIndex = 0;

    function rowCount() {
        return container.querySelectorAll('.family-member-row').length;
    }

    function syncAddButton() {
        const atLimit = rowCount() >= maxAdditional;
        addBtn.hidden = atLimit;
        if (limitNote) limitNote.hidden = !atLimit;
    }

    function field(rowId, index, name, label, type, value) {
        const group = document.createElement('div');
        group.className = 'form-group';

        const id = rowId + '-' + name;
        const labelEl = document.createElement('label');
        // A bare label with no `for` doesn't focus its input when tapped — a real
        // annoyance on a phone, where the label is the easiest thing to hit.
        labelEl.setAttribute('for', id);
        labelEl.textContent = label;

        const input = document.createElement('input');
        input.type = type;
        input.id = id;
        input.name = 'family_members[' + index + '][' + name + ']';
        if (value) input.value = value;
        if (type !== 'email') input.required = true;

        group.append(labelEl, input);
        return group;
    }

    function addRow() {
        if (rowCount() >= maxAdditional) return;

        const index = nextIndex++;
        const rowId = 'family-member-' + index;

    const row = document.createElement('div');
    row.className = 'family-member-row';
        row.id = rowId;

        const head = document.createElement('div');
        head.className = 'family-member-head';

        const legend = document.createElement('span');
        legend.className = 'family-member-legend';

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-remove';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
      row.remove();
            renumber();
            syncAddButton();
            addBtn.focus();
    });

        head.append(legend, remove);
        row.appendChild(head);
        row.appendChild(field(rowId, index, 'first_name', 'First Name', 'text'));
        row.appendChild(field(rowId, index, 'last_name', 'Last Name', 'text',
            primaryLastName ? primaryLastName.value : ''));
        row.appendChild(field(rowId, index, 'email', 'Email (optional)', 'email'));

        container.appendChild(row);
        renumber();
        syncAddButton();

        const firstInput = row.querySelector('input');
        if (firstInput) firstInput.focus();
    }

    // Visible numbering counts positions, not field indexes, so removing the second of
    // three rows leaves "Family member 1" and "Family member 2" rather than a gap.
    function renumber() {
        container.querySelectorAll('.family-member-row').forEach((row, i) => {
            const legend = row.querySelector('.family-member-legend');
            if (legend) legend.textContent = 'Family member ' + (i + 1);
        });
  }

    addBtn.addEventListener('click', addRow);

    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            familySection.hidden = radio.value !== 'family';
        });
    });

    syncAddButton();
})();
