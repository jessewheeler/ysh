const campaignsRepo = require('../db/repos/campaigns');
const campaignVisitsRepo = require('../db/repos/campaignVisits');
const logger = require('../services/logger');

// Crawlers and link-preview fetchers arrive without cookies, so the per-session dedup below
// can't suppress them — each fetch would mint a fresh session plus a visit row. Filtering on
// User-Agent keeps both tables honest. Not security, just hygiene.
const BOT_UA = /bot|crawl|spider|preview|facebookexternalhit|slurp|curl|wget|headless|monitor|pingdom/i;

const REFERRER_MAX = 200;

/**
 * Reduces a Referer header to origin + pathname. The query string is noise (and where the
 * bytes hide), and a full referrer can carry another site's tracking params we don't want.
 */
function normalizeReferrer(raw) {
  if (!raw) return null;
  let value;
  try {
    const url = new URL(raw);
    value = `${url.origin}${url.pathname}`;
  } catch (_e) {
    value = String(raw).split('?')[0];
  }
  return value.slice(0, REFERRER_MAX) || null;
}

function firstValue(value) {
  // Express 5 gives an array when a param is repeated (?utm_campaign=a&utm_campaign=b).
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate.trim() : null;
}

/**
 * Resolves ?utm_campaign= on inbound page views into a first-touch session attribution plus a
 * visit row. First-touch means the campaign that introduced someone sticks even if they later
 * arrive through a different link; the later visit is still counted against its own campaign.
 *
 * Never throws and never blocks the response — tracking is not worth a broken page load.
 */
async function captureCampaign(req, res, next) {
  try {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/admin') || req.path.startsWith('/stripe')) return next();

    const code = firstValue(req.query.utm_campaign);
    if (!code) return next();

    if (BOT_UA.test(req.get('User-Agent') || '')) return next();

    const campaign = await campaignsRepo.findByUtmCampaign(code.toLowerCase());
    if (!campaign) return next();

    if (!req.session) return next();

    // One visit per session per campaign, so refreshes and back-button navigation don't inflate.
    const seen = Array.isArray(req.session.campaign_seen) ? req.session.campaign_seen : [];
    if (!seen.includes(campaign.id)) {
      await campaignVisitsRepo.record({
        campaignId: campaign.id,
        landingPath: req.path,
        referrer: normalizeReferrer(req.get('Referer')),
        utmSource: firstValue(req.query.utm_source),
        utmMedium: firstValue(req.query.utm_medium),
        utmContent: firstValue(req.query.utm_content),
      });
      req.session.campaign_seen = [...seen, campaign.id];
    }

    if (!req.session.campaign_id) {
      req.session.campaign_id = campaign.id;
    }
  } catch (err) {
    const log = req.logger || logger;
    log.warn('Campaign attribution failed', {error: err.message});
  }
  next();
}

module.exports = {captureCampaign, normalizeReferrer, BOT_UA};
