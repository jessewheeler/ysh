(function () {
    const radios = document.querySelectorAll('input[name="amount_preset"]');
    const group = document.getElementById('custom-amount-group');
    const customInput = document.getElementById('amount_custom');
    if (!radios.length || !group || !customInput) return;

    radios.forEach(function (r) {
        r.addEventListener('change', function () {
            if (this.value === 'custom') {
                group.style.display = '';
                customInput.required = true;
            } else {
                group.style.display = 'none';
                customInput.required = false;
            }
        });
    });
})();
