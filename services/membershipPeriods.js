function parseDollarsToCents(dollars) {
    const n = parseFloat(dollars);
    if (isNaN(n)) return NaN;
    return Math.round(n * 100);
}

function validatePeriod({label, start_date, end_date, individual_dues, family_dues, electronic_surcharge}) {
    if (!label || !label.trim()) throw new Error('Label is required.');
    if (!start_date) throw new Error('Start date is required.');
    if (!end_date) throw new Error('End date is required.');
    if (end_date <= start_date) throw new Error('End date must be after start date.');

    const individual_dues_cents = parseDollarsToCents(individual_dues);
    if (isNaN(individual_dues_cents) || individual_dues_cents < 0) throw new Error('Individual dues must be a non-negative number.');

    const family_dues_cents = parseDollarsToCents(family_dues);
    if (isNaN(family_dues_cents) || family_dues_cents < 0) throw new Error('Family dues must be a non-negative number.');

    const surchargeStr = electronic_surcharge == null || electronic_surcharge === '' ? '0' : electronic_surcharge;
    const electronic_surcharge_cents = parseDollarsToCents(surchargeStr);
    if (isNaN(electronic_surcharge_cents) || electronic_surcharge_cents < 0) throw new Error('Electronic surcharge must be a non-negative number.');

    return {
        label: label.trim(),
        start_date,
        end_date,
        individual_dues_cents,
        family_dues_cents,
        electronic_surcharge_cents
    };
}

function duesForType(period, membershipType) {
    return membershipType === 'family' ? period.family_dues_cents : period.individual_dues_cents;
}

function surchargeFor(period, paymentMethod) {
    return paymentMethod === 'stripe' ? period.electronic_surcharge_cents : 0;
}

function centsToDollars(cents) {
    return (cents / 100).toFixed(2);
}

module.exports = {validatePeriod, duesForType, surchargeFor, centsToDollars};
