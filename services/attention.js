const settingsRepo = require('../db/repos/settings');
const periodsRepo = require('../db/repos/membershipPeriods');
const { SIGNAL_KEYS, SIGNAL_LABELS } = require('../db/repos/memberAttention');

const DEFAULTS = {
  attention_reminder_count: 2,
  attention_pending_payment_hours: 24,
  attention_lookback_days: 180,
};

function toInt(value, fallback) {
  const n = parseInt(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolves the tunables and current period the needs-attention predicates need.
 *
 * Lives in the service layer so the repo stays settings-free and unit-testable with
 * plain numbers, the same split services/renewal.js uses for
 * renewal_reminder_days_before.
 */
async function buildContext() {
  const [period, reminderCount, staleHours, lookbackDays] = await Promise.all([
    periodsRepo.getCurrent(),
    settingsRepo.get('attention_reminder_count'),
    settingsRepo.get('attention_pending_payment_hours'),
    settingsRepo.get('attention_lookback_days'),
  ]);

  return {
    currentPeriodId: period ? period.id : null,
    minReminders: toInt(reminderCount, DEFAULTS.attention_reminder_count),
    staleHours: toInt(staleHours, DEFAULTS.attention_pending_payment_hours),
    lookbackDays: toInt(lookbackDays, DEFAULTS.attention_lookback_days),
  };
}

module.exports = {
  DEFAULTS,
  SIGNAL_KEYS,
  SIGNAL_LABELS,
  buildContext,
};
