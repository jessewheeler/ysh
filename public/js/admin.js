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
    if (el.name === '_csrf') return true;
    return false;
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
});
