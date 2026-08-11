const QRCode = require('qrcode');

const UTM_CODE_PATTERN = /^[a-z0-9._-]+$/;
const DEFAULT_TARGET_PATH = '/membership';
const MIN_QR_SIZE = 200;
const MAX_QR_SIZE = 2000;
const DEFAULT_QR_SIZE = 600;

/** Blank-safe trim: '' and whitespace-only become null so optional columns stay NULL. */
function optional(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Validates and normalizes a campaign form submission. Throws with a message meant for the
 * admin's flash area — same contract as validatePeriod in services/membershipPeriods.js.
 */
function validateCampaign(body = {}) {
  const name = optional(body.name);
  if (!name) throw new Error('Campaign name is required.');

  const rawCode = optional(body.utm_campaign);
  if (!rawCode) throw new Error('Campaign code (utm_campaign) is required.');
  const utm_campaign = rawCode.toLowerCase();
  if (!UTM_CODE_PATTERN.test(utm_campaign)) {
    throw new Error('Campaign code may only contain lowercase letters, numbers, dots, dashes and underscores.');
  }

  const target_path = optional(body.target_path) || DEFAULT_TARGET_PATH;
  if (!target_path.startsWith('/')) {
    throw new Error('Target path must start with "/" — for example /membership.');
  }
  // Reject protocol-relative and absolute URLs: the link must stay on this site, and a
  // generated QR code pointing off-site would be handed out in print before anyone noticed.
  if (target_path.startsWith('//') || /^\/[a-z][a-z0-9+.-]*:/i.test(target_path)) {
    throw new Error('Target path must be a path on this site, not a full URL.');
  }

  return {
    name,
    utm_campaign,
    utm_source: optional(body.utm_source),
    utm_medium: optional(body.utm_medium),
    utm_content: optional(body.utm_content),
    target_path,
    notes: optional(body.notes),
  };
}

/** The base URL for generated links — same resolution the renewal links use. */
function resolveBaseUrl() {
  return process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

/**
 * Builds the public, UTM-tagged link for a campaign. Only non-empty UTM params are appended,
 * and any query string already on target_path is preserved.
 */
function buildUrl(campaign, baseUrl = resolveBaseUrl()) {
  const url = new URL(campaign.target_path || DEFAULT_TARGET_PATH, baseUrl);
  const params = [
    ['utm_source', campaign.utm_source],
    ['utm_medium', campaign.utm_medium],
    ['utm_campaign', campaign.utm_campaign],
    ['utm_content', campaign.utm_content],
  ];
  for (const [key, value] of params) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/** Clamps a caller-supplied QR pixel size into a sane range. */
function clampSize(raw) {
  const size = parseInt(raw, 10);
  if (!Number.isFinite(size)) return DEFAULT_QR_SIZE;
  return Math.min(MAX_QR_SIZE, Math.max(MIN_QR_SIZE, size));
}

async function qrPng(url, {size = DEFAULT_QR_SIZE} = {}) {
  return QRCode.toBuffer(url, {
    type: 'png',
    width: clampSize(size),
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}

async function qrSvg(url) {
  return QRCode.toString(url, {type: 'svg', margin: 2, errorCorrectionLevel: 'M'});
}

function qrFilename(campaign, ext) {
  return `ysh-qr-${campaign.utm_campaign}.${ext}`;
}

/** Signups per visit, as a display string. Visits of 0 render as '—' rather than a fake 0%. */
function conversionRate({visit_count, signup_count}) {
  const visits = Number(visit_count) || 0;
  if (visits === 0) return '—';
  return `${Math.round((Number(signup_count) || 0) / visits * 100)}%`;
}

module.exports = {
  validateCampaign,
  buildUrl,
  resolveBaseUrl,
  qrPng,
  qrSvg,
  qrFilename,
  clampSize,
  conversionRate,
  DEFAULT_TARGET_PATH,
  DEFAULT_QR_SIZE,
  MIN_QR_SIZE,
  MAX_QR_SIZE,
};
