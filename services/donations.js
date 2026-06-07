// Donation form validation, shared by the POST /donate route and its tests so the
// two never drift apart.

const PRESET_AMOUNTS = new Set([500, 1000, 2500, 5000, 10000]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validates a donate form submission. Returns { amountCents } on success or
// { error } with a user-facing message on failure.
function validateDonation({donor_name, donor_email, amount_preset, amount_custom} = {}) {
    if (!donor_name || !donor_email) {
        return {error: 'Name and email are required.'};
    }
    if (!EMAIL_RE.test(String(donor_email).trim())) {
        return {error: 'Please enter a valid email address.'};
    }

    if (amount_preset === 'custom') {
        const parsed = Math.round(parseFloat(amount_custom) * 100);
        if (!parsed || parsed < 100) {
            return {error: 'Minimum donation is $1.00.'};
        }
        return {amountCents: parsed};
    }

    const preset = parseInt(amount_preset);
    if (!PRESET_AMOUNTS.has(preset)) {
        return {error: 'Please select a valid donation amount.'};
    }
    return {amountCents: preset};
}

module.exports = {validateDonation, PRESET_AMOUNTS};
