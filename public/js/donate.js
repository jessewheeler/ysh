// Donate form (issue #126). Shows the "Other" amount box, keeps the fee-cover label and the
// total current, and hides the name and email fields for an anonymous gift.
//
// Everything here is a convenience. The server recomputes the fee and decides what is
// required; with this script blocked the form still submits and validates.
(function () {
  var form = document.getElementById('donate-form');
  if (!form) return;

  var radios = form.querySelectorAll('input[name="amount_preset"]');
  var customGroup = document.getElementById('custom-amount-group');
  var customInput = document.getElementById('amount_custom');
  var coverFee = document.getElementById('cover_fee');
  var anonymous = document.getElementById('anonymous');
  var donorFields = document.getElementById('donor-fields');
  var feeAmount = document.getElementById('fee-amount');
  var total = document.getElementById('donate-total');

  var feePercent = parseFloat(form.dataset.feePercent);
  var feeFixedCents = parseInt(form.dataset.feeFixedCents, 10);

  function money(cents) {
    return '$' + (cents / 100).toFixed(2);
  }

  function selectedPreset() {
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) return radios[i].value;
    }
    return '';
  }

  // Same sum as services/donations.js#feeCoverCents.
  function feeCoverCents(giftCents) {
    return Math.ceil((giftCents + feeFixedCents) / (1 - feePercent)) - giftCents;
  }

  function giftCents() {
    var preset = selectedPreset();
    if (preset !== 'custom') return parseInt(preset, 10) || 0;
    var dollars = parseFloat(customInput.value);
    return dollars > 0 ? Math.round(dollars * 100) : 0;
  }

  function update() {
    var isCustom = selectedPreset() === 'custom';
    customGroup.hidden = !isCustom;
    customInput.required = isCustom;

    var isAnonymous = anonymous.checked;
    donorFields.hidden = isAnonymous;
    donorFields.querySelectorAll('input').forEach(function (input) {
      input.required = !isAnonymous;
      input.disabled = isAnonymous;
    });

    var gift = giftCents();
    var fee = gift > 0 ? feeCoverCents(gift) : 0;
    feeAmount.textContent = gift > 0 ? money(fee) : 'a little';
    // An empty "Other" box has no total yet; "$0.00" would read as a real charge.
    total.textContent = gift > 0 ? money(gift + (coverFee.checked ? fee : 0)) : '—';
  }

  form.addEventListener('change', update);
  customInput.addEventListener('input', update);
  update();
})();
