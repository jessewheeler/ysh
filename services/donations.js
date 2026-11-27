// Donation rules (issue #126): the amounts on offer, the opt-in fee cover, and validation of
// the public donate form. Shared by POST /donate, the admin summary and the tests so they
// cannot drift apart.

const PRESET_CENTS = [1200, 2500, 5000, 10000];
const DEFAULT_CENTS = 1200;
const MIN_CENTS = 100;
const MAX_CENTS = 1000000;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;

// Stripe's standard US card rate. Used to quote the donor a fee cover and to estimate what
// the chapter absorbs; the real fee on a given card can differ slightly.
const FEE_PERCENT = 0.029;
const FEE_FIXED_CENTS = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOLLARS_RE = /^\$?\s*(\d{1,7})(\.\d{1,2})?$/;

// What a donor adds so the chapter nets the full gift after Stripe's fee. The fee is taken
// on the grossed-up total, hence the division; rounded up so the chapter is never a cent short.
function feeCoverCents(giftCents) {
  const total = Math.ceil((giftCents + FEE_FIXED_CENTS) / (1 - FEE_PERCENT));
  return total - giftCents;
}

// Stripe's fee on one charge, at the standard rate.
function estimatedFeeCents(amountCents) {
  return Math.round(amountCents * FEE_PERCENT) + FEE_FIXED_CENTS;
}

// Strict dollars-to-cents for the "Other" box: digits with at most two decimals. parseFloat
// would accept "12abc" and "1e3".
function parseAmountToCents(input) {
  const match = DOLLARS_RE.exec(String(input == null ? '' : input).trim());
  if (!match) return NaN;
  return parseInt(match[1], 10) * 100 + (match[2] ? parseInt(match[2].slice(1).padEnd(2, '0'), 10) : 0);
}

function isChecked(value) {
  return value === 'on' || value === '1' || value === 'true' || value === true;
}

function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// Validates a donate form submission against the funds currently on offer. Returns
// { error } with a user-facing message, or the normalized donation. The fee cover is
// always recomputed here; nothing the browser says about it is trusted.
function validateDonation(body, activeFunds) {
  const { donor_name, donor_email, amount_preset, amount_custom, fund_id, cover_fee, anonymous } = body || {};
  const isAnonymous = isChecked(anonymous);

  let donorName = null;
  let donorEmail = null;
  if (!isAnonymous) {
    donorName = String(donor_name || '').trim();
    donorEmail = String(donor_email || '').trim().toLowerCase();
    if (!donorName || !donorEmail) {
      return { error: 'Name and email are required, or choose to give anonymously.' };
    }
    if (donorName.length > MAX_NAME_LENGTH) {
      return { error: `Please keep your name under ${MAX_NAME_LENGTH} characters.` };
    }
    if (donorEmail.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(donorEmail)) {
      return { error: 'Please enter a valid email address.' };
    }
  }

  const fund = (activeFunds || []).find(f => String(f.id) === String(fund_id));
  if (!fund) {
    return { error: 'Please choose where your donation should go.' };
  }

  let giftCents;
  if (amount_preset === 'custom') {
    giftCents = parseAmountToCents(amount_custom);
    if (isNaN(giftCents)) {
      return { error: 'Please enter a donation amount in dollars, like 12 or 12.50.' };
    }
  } else {
    giftCents = parseInt(amount_preset, 10);
    if (!PRESET_CENTS.includes(giftCents) || String(giftCents) !== String(amount_preset)) {
      return { error: 'Please select a valid donation amount.' };
    }
  }
  if (giftCents < MIN_CENTS) {
    return { error: `Minimum donation is ${formatCents(MIN_CENTS)}.` };
  }
  if (giftCents > MAX_CENTS) {
    return { error: `For a gift over ${formatCents(MAX_CENTS)}, please contact us directly.` };
  }

  return {
    giftCents,
    feeCoverCents: isChecked(cover_fee) ? feeCoverCents(giftCents) : 0,
    fundId: fund.id,
    fundName: fund.name,
    isAnonymous,
    donorName,
    donorEmail,
  };
}

// Numbers for the admin Donations page. Fees are estimated per charge because of the flat
// 30 cents; "absorbed" is what is left for the chapter after donors' fee covers.
function feeSummary(completedAmounts, feeCoverTotalCents) {
  const estimatedFees = completedAmounts.reduce((sum, cents) => sum + estimatedFeeCents(cents), 0);
  return {
    estimatedFeeCents: estimatedFees,
    absorbedCents: Math.max(0, estimatedFees - feeCoverTotalCents),
  };
}

function validateFund({ name, sort_order } = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { error: 'Fund name is required.' };
  if (trimmed.length > 80) return { error: 'Please keep the fund name under 80 characters.' };
  const order = sort_order === undefined || sort_order === '' ? 0 : Number(sort_order);
  if (!Number.isInteger(order) || order < 0 || order > 9999) {
    return { error: 'Sort order must be a whole number between 0 and 9999.' };
  }
  return { name: trimmed, sort_order: order };
}

module.exports = {
  PRESET_CENTS,
  DEFAULT_CENTS,
  MIN_CENTS,
  MAX_CENTS,
  FEE_PERCENT,
  FEE_FIXED_CENTS,
  feeCoverCents,
  estimatedFeeCents,
  parseAmountToCents,
  validateDonation,
  feeSummary,
  validateFund,
  formatCents,
};
