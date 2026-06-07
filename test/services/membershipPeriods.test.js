const svc = require('../../services/membershipPeriods');

describe('validatePeriod', () => {
    const valid = {
        label: '2026-27 Season',
        start_date: '2026-04-01',
        end_date: '2027-07-31',
        individual_dues: '16.00',
        family_dues: '26.00',
        electronic_surcharge: '1.50',
    };

    test('accepts valid input and converts dollars to cents', () => {
        const result = svc.validatePeriod(valid);
        expect(result.individual_dues_cents).toBe(1600);
        expect(result.family_dues_cents).toBe(2600);
        expect(result.electronic_surcharge_cents).toBe(150);
        expect(result.label).toBe('2026-27 Season');
        expect(result.start_date).toBe('2026-04-01');
        expect(result.end_date).toBe('2027-07-31');
    });

    test('defaults electronic_surcharge to 0 if blank', () => {
        const result = svc.validatePeriod({...valid, electronic_surcharge: ''});
        expect(result.electronic_surcharge_cents).toBe(0);
    });

    test('throws when label is missing', () => {
        expect(() => svc.validatePeriod({...valid, label: ''})).toThrow(/label/i);
    });

    test('throws when start_date is missing', () => {
        expect(() => svc.validatePeriod({...valid, start_date: ''})).toThrow(/start/i);
    });

    test('throws when end_date is missing', () => {
        expect(() => svc.validatePeriod({...valid, end_date: ''})).toThrow(/end/i);
    });

    test('throws when end_date is not after start_date', () => {
        expect(() => svc.validatePeriod({...valid, end_date: '2026-01-01'})).toThrow(/end.*after/i);
    });

    test('throws when individual_dues is negative', () => {
        expect(() => svc.validatePeriod({...valid, individual_dues: '-1'})).toThrow(/individual/i);
    });

    test('throws when family_dues is negative', () => {
        expect(() => svc.validatePeriod({...valid, family_dues: '-5'})).toThrow(/family/i);
    });

    test('throws when electronic_surcharge is negative', () => {
        expect(() => svc.validatePeriod({...valid, electronic_surcharge: '-0.50'})).toThrow(/surcharge/i);
    });

    test('throws when individual_dues is not a number', () => {
        expect(() => svc.validatePeriod({...valid, individual_dues: 'abc'})).toThrow(/individual/i);
    });
});

describe('duesForType', () => {
    const period = {individual_dues_cents: 1600, family_dues_cents: 2600};

    test('returns individual cents for individual type', () => {
        expect(svc.duesForType(period, 'individual')).toBe(1600);
    });

    test('returns family cents for family type', () => {
        expect(svc.duesForType(period, 'family')).toBe(2600);
    });
});

describe('surchargeFor', () => {
    const period = {electronic_surcharge_cents: 150};

    test('returns surcharge for stripe payments', () => {
        expect(svc.surchargeFor(period, 'stripe')).toBe(150);
    });

    test('returns 0 for cash payments', () => {
        expect(svc.surchargeFor(period, 'cash')).toBe(0);
    });

    test('returns 0 for check payments', () => {
        expect(svc.surchargeFor(period, 'check')).toBe(0);
    });
});

describe('centsToDollars', () => {
    test('converts cents to dollar string', () => {
        expect(svc.centsToDollars(1600)).toBe('16.00');
        expect(svc.centsToDollars(2650)).toBe('26.50');
        expect(svc.centsToDollars(0)).toBe('0.00');
        expect(svc.centsToDollars(150)).toBe('1.50');
    });
});
