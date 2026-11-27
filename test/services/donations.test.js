const {
  PRESET_CENTS,
  DEFAULT_CENTS,
  feeCoverCents,
  estimatedFeeCents,
  parseAmountToCents,
  validateDonation,
  feeSummary,
  validateFund,
} = require('../../services/donations');

const FUNDS = [
  { id: 1, name: 'General Fund' },
  { id: 2, name: 'Heart Wheels' },
];

const VALID = {
  donor_name: 'Jane Donor',
  donor_email: 'Jane@Example.com',
  fund_id: '2',
  amount_preset: '1200',
};

describe('amounts on offer', () => {
  test('the default is $12 and it is one of the presets', () => {
    expect(DEFAULT_CENTS).toBe(1200);
    expect(PRESET_CENTS).toEqual([1200, 2500, 5000, 10000]);
  });
});

describe('feeCoverCents', () => {
  test.each([
    [1200, 67],
    [2500, 106],
    [5000, 181],
    [10000, 330],
    [100, 34],
  ])('a %i cent gift needs %i cents added', (gift, cover) => {
    expect(feeCoverCents(gift)).toBe(cover);
  });

  test('after Stripe takes its fee from the grossed-up total, the chapter nets at least the gift', () => {
    for (const gift of [100, 999, 1200, 1234, 2500, 5000, 10000, 123456, 1000000]) {
      const total = gift + feeCoverCents(gift);
      expect(total - estimatedFeeCents(total)).toBeGreaterThanOrEqual(gift);
      // ...and never by more than a cent of rounding.
      expect(total - estimatedFeeCents(total) - gift).toBeLessThanOrEqual(1);
    }
  });
});

describe('parseAmountToCents', () => {
  test.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['$15.05', 1505],
    [' 7 ', 700],
    ['0.99', 99],
  ])('%s parses to %i cents', (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  test.each(['', 'abc', '12abc', '1e3', '-5', '12.345', '1,000', null, undefined])(
    '%s is not an amount',
    (input) => {
      expect(parseAmountToCents(input)).toBeNaN();
    }
  );
});

describe('validateDonation: named gift', () => {
  test('accepts a valid submission and normalizes the donor', () => {
    expect(validateDonation(VALID, FUNDS)).toEqual({
      giftCents: 1200,
      feeCoverCents: 0,
      fundId: 2,
      fundName: 'Heart Wheels',
      isAnonymous: false,
      donorName: 'Jane Donor',
      donorEmail: 'jane@example.com',
    });
  });

  test('rejects a missing name or email', () => {
    expect(validateDonation({ ...VALID, donor_name: ' ' }, FUNDS).error).toMatch(/required/i);
    expect(validateDonation({ ...VALID, donor_email: '' }, FUNDS).error).toMatch(/required/i);
  });

  test('rejects a malformed email', () => {
    expect(validateDonation({ ...VALID, donor_email: 'not-an-email' }, FUNDS).error).toMatch(/valid email/i);
  });

  test('rejects a name longer than 100 characters', () => {
    expect(validateDonation({ ...VALID, donor_name: 'x'.repeat(101) }, FUNDS).error).toMatch(/under 100/);
  });
});

describe('validateDonation: anonymous gift', () => {
  test('passes with no name or email', () => {
    const result = validateDonation({ fund_id: '1', amount_preset: '2500', anonymous: '1' }, FUNDS);
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ isAnonymous: true, donorName: null, donorEmail: null, giftCents: 2500 });
  });

  test('drops a name and email that were submitted anyway', () => {
    const result = validateDonation({ ...VALID, anonymous: 'on' }, FUNDS);
    expect(result.isAnonymous).toBe(true);
    expect(result.donorName).toBeNull();
    expect(result.donorEmail).toBeNull();
  });
});

describe('validateDonation: fund', () => {
  test('rejects a missing fund', () => {
    expect(validateDonation({ ...VALID, fund_id: undefined }, FUNDS).error).toMatch(/where your donation/i);
  });

  test('rejects a fund that is not on offer (unknown or retired)', () => {
    expect(validateDonation({ ...VALID, fund_id: '99' }, FUNDS).error).toMatch(/where your donation/i);
  });

  test('rejects everything when no fund is active', () => {
    expect(validateDonation(VALID, []).error).toMatch(/where your donation/i);
  });
});

describe('validateDonation: amount', () => {
  test('accepts each preset', () => {
    for (const cents of PRESET_CENTS) {
      expect(validateDonation({ ...VALID, amount_preset: String(cents) }, FUNDS).giftCents).toBe(cents);
    }
  });

  test('rejects a missing or made-up preset', () => {
    expect(validateDonation({ ...VALID, amount_preset: undefined }, FUNDS).error).toMatch(/valid donation amount/i);
    expect(validateDonation({ ...VALID, amount_preset: '999' }, FUNDS).error).toMatch(/valid donation amount/i);
    expect(validateDonation({ ...VALID, amount_preset: '1200abc' }, FUNDS).error).toMatch(/valid donation amount/i);
  });

  test('accepts an Other amount of $1 or more', () => {
    expect(validateDonation({ ...VALID, amount_preset: 'custom', amount_custom: '10' }, FUNDS).giftCents).toBe(1000);
    expect(validateDonation({ ...VALID, amount_preset: 'custom', amount_custom: '15.50' }, FUNDS).giftCents).toBe(1550);
    expect(validateDonation({ ...VALID, amount_preset: 'custom', amount_custom: '1' }, FUNDS).giftCents).toBe(100);
  });

  test('rejects an Other amount below $1, above $10,000 or not a number', () => {
    expect(validateDonation({ ...VALID, amount_preset: 'custom', amount_custom: '0.50' }, FUNDS).error).toMatch(/minimum/i);
    expect(validateDonation({ ...VALID, amount_preset: 'custom', amount_custom: '0' }, FUNDS).error).toMatch(/minimum/i);
    expect(validateDonation({ ...VALID, amount_preset: 'custom', amount_custom: '10000.01' }, FUNDS).error).toMatch(/contact us/i);
    expect(validateDonation({ ...VALID, amount_preset: 'custom', amount_custom: 'lots' }, FUNDS).error).toMatch(/in dollars/i);
    expect(validateDonation({ ...VALID, amount_preset: 'custom' }, FUNDS).error).toMatch(/in dollars/i);
  });
});

describe('validateDonation: fee cover', () => {
  test('is zero unless the donor opts in', () => {
    expect(validateDonation(VALID, FUNDS).feeCoverCents).toBe(0);
    expect(validateDonation({ ...VALID, cover_fee: '0' }, FUNDS).feeCoverCents).toBe(0);
  });

  test('is computed on the server when the donor opts in', () => {
    expect(validateDonation({ ...VALID, cover_fee: '1' }, FUNDS).feeCoverCents).toBe(67);
  });

  test('ignores any fee figure the browser sends', () => {
    const result = validateDonation({ ...VALID, cover_fee: '1', fee_cover_cents: '1', feeCoverCents: '1' }, FUNDS);
    expect(result.feeCoverCents).toBe(67);
  });
});

describe('feeSummary', () => {
  test('estimates fees per charge and nets off what donors covered', () => {
    // 1267 -> 37 + 30 = 67; 2500 -> 73 + 30 = 103 (rounded from 72.5).
    expect(feeSummary([1267, 2500], 67)).toEqual({ estimatedFeeCents: 170, absorbedCents: 103 });
  });

  test('never reports a negative amount absorbed', () => {
    expect(feeSummary([1267], 500)).toEqual({ estimatedFeeCents: 67, absorbedCents: 0 });
    expect(feeSummary([], 0)).toEqual({ estimatedFeeCents: 0, absorbedCents: 0 });
  });
});

describe('validateFund', () => {
  test('trims the name and defaults the sort order', () => {
    expect(validateFund({ name: '  Turkey Drive ' })).toEqual({ name: 'Turkey Drive', sort_order: 0 });
    expect(validateFund({ name: 'Turkey Drive', sort_order: '4' })).toEqual({ name: 'Turkey Drive', sort_order: 4 });
  });

  test('rejects a blank or overlong name and a bad sort order', () => {
    expect(validateFund({ name: '  ' }).error).toMatch(/required/i);
    expect(validateFund({ name: 'x'.repeat(81) }).error).toMatch(/under 80/);
    expect(validateFund({ name: 'Ok', sort_order: '-1' }).error).toMatch(/sort order/i);
    expect(validateFund({ name: 'Ok', sort_order: '1.5' }).error).toMatch(/sort order/i);
    expect(validateFund({ name: 'Ok', sort_order: 'abc' }).error).toMatch(/sort order/i);
  });
});
