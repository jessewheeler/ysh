// Confirm dialogs for delete actions
document.addEventListener('DOMContentLoaded', function () {
    // Sidebar toggle
    var sidebarToggle = document.querySelector('.admin-sidebar-toggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function () {
            document.querySelector('.admin-wrapper').classList.toggle('sidebar-open');
        });
    }

    // Auto-inject CSRF tokens into all POST forms using the meta tag
    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
    document.querySelectorAll('form[method="POST"], form[method="post"]').forEach(function (form) {
        if (!form.querySelector('input[name="_csrf"]')) {
            var input = document.createElement('input');
            input.type = 'hidden';
            input.name = '_csrf';
            input.value = csrfToken;
            form.prepend(input);
        }
    });


  document.querySelectorAll('[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!confirm(form.dataset.confirm)) {
        e.preventDefault();
      }
    });
  });

  // Submit a filter form as soon as its control changes. This lives here rather than in an
  // inline onchange attribute because helmet sends `script-src-attr 'none'`, which blocks
  // inline event handlers outright — an onchange there never fires at all.
  document.querySelectorAll('[data-auto-submit]').forEach(function (control) {
    control.addEventListener('change', function () {
      if (control.form) control.form.submit();
    });
  });

  // Copy a field's value to the clipboard. Lives here rather than in an inline onclick for the
  // same reason as data-auto-submit: `script-src-attr 'none'` blocks inline handlers silently.
  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var field = document.querySelector(button.dataset.copy);
      if (!field) return;
      var original = button.textContent;
      var done = function (text) {
        button.textContent = text;
        setTimeout(function () { button.textContent = original; }, 2000);
      };
      // navigator.clipboard needs a secure context, which plain-HTTP local dev is not.
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(field.value).then(function () { done('Copied!'); },
          function () { done('Press Ctrl+C'); field.select(); });
      } else {
        field.select();
        done(document.execCommand('copy') ? 'Copied!' : 'Press Ctrl+C');
      }
    });
  });

  // Image preview on file input change
  document.querySelectorAll('input[type="file"][accept="image/*"]').forEach(function (input) {
    input.addEventListener('change', function () {
      var preview = input.parentElement.querySelector('.image-preview img');
      if (!preview && input.files && input.files[0]) {
        var img = document.createElement('img');
        img.style.maxHeight = '120px';
        img.style.marginTop = '0.5rem';
        img.style.display = 'block';
        var reader = new FileReader();
        reader.onload = function (e) {
          img.src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
        input.parentElement.appendChild(img);
      } else if (preview && input.files && input.files[0]) {
        reader = new FileReader();
        reader.onload = function (e) {
          preview.src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
      }
    });
  });

  // Draft autosave for forms with data-draft attribute
  var DRAFT_TTL = 24 * 60 * 60 * 1000; // 24 hours

  function getDraftKey(form) {
    return 'draft:' + form.action;
  }

  function isSkippedInput(el) {
    if (!el.name) return true;
    if (el.type === 'hidden' || el.type === 'file') return true;
    return el.name === '_csrf';
  }

  function collectFields(form) {
    var fields = {};
    var elements = form.elements;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (isSkippedInput(el)) continue;
      if (el.type === 'checkbox') {
        fields[el.name] = el.checked;
      } else {
        fields[el.name] = el.value;
      }
    }
    return fields;
  }

  function saveDraft(form) {
    try {
      var key = getDraftKey(form);
      var data = { ts: Date.now(), fields: collectFields(form) };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (_e) {
      // localStorage unavailable (private browsing) — silently degrade
    }
  }

  function loadDraft(form) {
    try {
      var key = getDraftKey(form);
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (Date.now() - data.ts > DRAFT_TTL) {
        localStorage.removeItem(key);
        return null;
      }
      return data;
    } catch (_e) {
      return null;
    }
  }

  function restoreFields(form, fields) {
    var elements = form.elements;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (isSkippedInput(el)) continue;
      if (!(el.name in fields)) continue;
      if (el.type === 'checkbox') {
        el.checked = !!fields[el.name];
      } else {
        el.value = fields[el.name];
      }
    }
  }

  function showDraftBanner(form, ts, key) {
    var time = new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    var banner = document.createElement('div');
    banner.className = 'draft-restored-banner';
    banner.innerHTML = 'Draft restored from ' + time +
      ' <button type="button" class="draft-discard-btn">Discard draft</button>';
    form.insertBefore(banner, form.firstChild);
    banner.querySelector('.draft-discard-btn').addEventListener('click', function () {
      try { localStorage.removeItem(key); } catch (_e) { /* ignore */ }
      form.reset();
      banner.remove();
    });
  }

  function initDraftSave(form) {
    var timer = null;

    function debouncedSave() {
      clearTimeout(timer);
      timer = setTimeout(function () { saveDraft(form); }, 500);
    }

    form.addEventListener('input', debouncedSave);
    form.addEventListener('change', debouncedSave);

    form.addEventListener('submit', function () {
      clearTimeout(timer);
      try { localStorage.removeItem(getDraftKey(form)); } catch (_e) { /* ignore */ }
    });

    var draft = loadDraft(form);
    if (draft) {
      restoreFields(form, draft.fields);
      showDraftBanner(form, draft.ts, getDraftKey(form));
    }
  }

  document.querySelectorAll('form[data-draft]').forEach(initDraftSave);

  // Modal dialogs. A button with data-dialog-open="#id" opens that <dialog> as a modal;
  // anything with data-dialog-close inside it closes it; clicking the backdrop closes it
  // too (Escape is native). data-dialog-open-on-load reopens a dialog after a redirect, so
  // a refused submit lands back in the form it came from. All here, not inline, because
  // the CSP blocks inline handlers outright.
  document.querySelectorAll('[data-dialog-open]').forEach(function (button) {
    button.addEventListener('click', function () {
      var dialog = document.querySelector(button.dataset.dialogOpen);
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
    });
  });
  document.querySelectorAll('dialog.modal').forEach(function (dialog) {
    dialog.querySelectorAll('[data-dialog-close]').forEach(function (button) {
      button.addEventListener('click', function () { dialog.close(); });
    });
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) dialog.close();
    });
    if (dialog.dataset.dialogOpenOnLoad && typeof dialog.showModal === 'function') dialog.showModal();
  });

  // Spinner + disable on forms with data-spinner. A form may also carry data-confirm; that
  // listener runs first and only calls preventDefault() when the admin cancels, so check
  // for it here — otherwise a cancelled dialog left the button disabled with nowhere to go.
  document.querySelectorAll('form[data-spinner]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (e.defaultPrevented) return;
      var btn = form.querySelector('button[type="submit"]');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.innerHTML = '<span class="btn-spinner"></span> ' + form.dataset.spinner;
    });
  });

  // Game-day check-in: a row's ticket count only applies while its person is ticked
  // present, and never for someone not enrolled (data-enrolled="0"). The server enforces
  // both regardless; this just keeps the form honest about what will be saved.
  document.querySelectorAll('tr[data-checkin-row]').forEach(function (row) {
    var present = row.querySelector('input[type="checkbox"]');
    var tickets = row.querySelector('input.ticket-input');
    if (!present || !tickets) return;
    var sync = function () {
      tickets.disabled = !present.checked || tickets.dataset.enrolled !== '1';
    };
    present.addEventListener('change', sync);
    sync();
  });

  // Archive suggestions on the Add Family Member form. Typing a last name looks up archived
  // family members (issue #107); choosing one fills the names and sets the hidden
  // archived_member_id, so the route brings that person back rather than creating a new
  // record. Editing either name afterwards clears the choice — the names no longer describe
  // the person picked.
  document.querySelectorAll('input[data-archive-lookup]').forEach(function (lastName) {
    var target = document.querySelector(lastName.dataset.archiveTarget);
    var firstName = document.querySelector(lastName.dataset.archiveFirstName);
    var list = document.querySelector(lastName.dataset.archiveList);
    if (!target || !list) return;
    var timer = null;
    var seq = 0;

    var clearChoice = function () { target.value = ''; };
    var hide = function () { list.hidden = true; list.innerHTML = ''; };

    var render = function (rows) {
      list.innerHTML = '';
      if (!rows.length) { list.hidden = true; return; }
      rows.forEach(function (row) {
        var li = document.createElement('li');
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'archive-suggestion';
        var details = [];
        if (row.join_date) details.push('joined ' + String(row.join_date).slice(0, 4));
        if (row.member_numbers && row.member_numbers.length) details.push(row.member_numbers[row.member_numbers.length - 1]);
        button.textContent = row.first_name + ' ' + row.last_name + (details.length ? ' — ' + details.join(', ') : '');
        button.addEventListener('click', function () {
          if (firstName) firstName.value = row.first_name;
          lastName.value = row.last_name;
          target.value = String(row.id);
          hide();
        });
        li.appendChild(button);
        list.appendChild(li);
      });
      var note = document.createElement('li');
      note.className = 'archive-suggestions-note';
      note.textContent = 'From the archive — pick one to restore them, or keep typing to add someone new.';
      list.appendChild(note);
      list.hidden = false;
    };

    lastName.addEventListener('input', function () {
      clearChoice();
      clearTimeout(timer);
      var term = lastName.value.trim();
      if (term.length < 2) { hide(); return; }
      timer = setTimeout(function () {
        var mine = ++seq;
        fetch(lastName.dataset.archiveLookup + '?last_name=' + encodeURIComponent(term), {
          headers: {Accept: 'application/json'},
          credentials: 'same-origin'
        })
          .then(function (r) { return r.ok ? r.json() : []; })
          .then(function (rows) { if (mine === seq) render(rows); })
          .catch(function () { hide(); });
      }, 250);
    });
    if (firstName) firstName.addEventListener('input', clearChoice);
  });

  // Auto-submit forms when a select with data-autosubmit changes
  document.querySelectorAll('select[data-autosubmit]').forEach(function (select) {
    select.addEventListener('change', function () {
      select.form.submit();
    });
  });

  // Column labels for the mobile card layout. Below 768px admin.css turns every row of a
  // list table into a card and renders these as td::before, because a 5-to-9 column table
  // on a phone otherwise overflows the document and scrolls the whole page sideways.
  //
  // Done here rather than as data-label in the templates: there are eighteen of these
  // tables, and the heading is already in the thead. Runs at every width — the attribute is
  // inert until the media query applies, so there is no resize listener and no reflow.
  document.querySelectorAll('table.admin-table:not(.admin-table--scroll):not(.admin-table--kv)').forEach(function (table) {
    var labels = Array.prototype.map.call(table.querySelectorAll(':scope > thead > tr > th'), function (th) {
      // members/list.pug's sortTh appends ' \u25b2' / ' \u25bc' to the active column.
      return th.textContent.replace(/[\u25b2\u25bc]/g, '').trim();
    });
    if (!labels.length) return;

    table.querySelectorAll(':scope > tbody > tr').forEach(function (row) {
      Array.prototype.forEach.call(row.children, function (cell, i) {
        if (cell.colSpan > 1) return;   // the colspan empty-state rows have no column
        if (labels[i]) cell.setAttribute('data-label', labels[i]);
      });
    });
  });
});
