const db = require('../database');

/**
 * "Needs attention" signals — members who look like they tried to join or renew and
 * didn't finish. See docs/needs-attention-signals.md for what each signal actually
 * proves (they are proxies, not facts) and why some tempting ones were left out.
 *
 * Every signal is a self-contained boolean SQL predicate correlated on `members.id`,
 * so the same text can be OR-ed together for filtering and evaluated individually for
 * per-row attribution. Nothing here may reference an outer alias other than `members`.
 *
 * Members who are cancelled or currently paid up are excluded before any signal is
 * considered — see eligibilityGate, which is where the definition of "paid up" lives and
 * why it is not `status = 'active'`.
 */

// Dates are computed in JS and bound as parameters, never inlined as date('now'):
// created_at/expiry_date are TEXT columns and comparing them to a SQL date breaks on
// PostgreSQL (text vs date). This is what caused the PR #69 revert. Deliberately a
// local copy rather than an import from ./members, which requires this module.
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Matches the datetime('now') format used by the created_at defaults: 'YYYY-MM-DD HH:MM:SS'.
function sqlTimestamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Resolves the raw context into the bound values the predicates need.
 */
function resolve(ctx = {}) {
  const {
    currentPeriodId = null,
    minReminders = 2,
    staleHours = 24,
    lookbackDays = 180,
  } = ctx;
  return {
    currentPeriodId,
    minReminders,
    // Everything is bounded by a lookback window so the list is an outreach queue and
    // not the club's entire history of failed signups.
    windowStart: `${isoDate(-lookbackDays)} 00:00:00`,
    // A payment younger than this is someone still filling in their card details.
    staleCutoff: sqlTimestamp(new Date(Date.now() - staleHours * 60 * 60 * 1000)),
    today: isoDate(),
    // renewal_token_expires_at is written by services/renewal.js as a full ISO string
    // (with T and Z), unlike the created_at columns — so it needs this format, not
    // sqlTimestamp. Matches members.findByRenewalToken.
    nowIso: new Date().toISOString(),
  };
}

const ATTENTION_SIGNALS = [
  {
    key: 'repeated_reminders',
    label: 'Reminded repeatedly, never renewed',
    short: 'Reminded, not renewed',
    requiresPeriod: true,
    build: (c) => ({
      sql: `(members.primary_member_id IS NULL AND members.is_lifetime = 0
        AND (SELECT COUNT(*) FROM emails_log e
             WHERE e.member_id = members.id AND e.email_type = 'renewal_reminder'
               AND e.created_at >= ?) >= ?
        AND NOT EXISTS (SELECT 1 FROM membership_years my
                        WHERE my.member_id = members.id AND my.membership_period_id = ?))`,
      params: [c.windowStart, c.minReminders, c.currentPeriodId],
    }),
  },
  {
    key: 'payment_failed',
    label: 'Stripe reported a failed payment',
    short: 'Payment failed',
    requiresPeriod: false,
    build: (c) => ({
      // No period gate: a failed payment is worth chasing even before a season opens.
      sql: `(EXISTS (SELECT 1 FROM payments p
                     WHERE p.member_id = members.id AND p.status = 'failed'
                       AND p.created_at >= ?)
        AND NOT EXISTS (SELECT 1 FROM payments p2
                        WHERE p2.member_id = members.id AND p2.status = 'completed'
                          AND p2.created_at >= ?))`,
      params: [c.windowStart, c.windowStart],
    }),
  },
  {
    key: 'stale_pending_payment',
    label: 'Started checkout but never completed it',
    short: 'Checkout not finished',
    requiresPeriod: false,
    build: (c) => ({
      sql: `(EXISTS (SELECT 1 FROM payments p
                     WHERE p.member_id = members.id AND p.status = 'pending'
                       AND p.created_at >= ? AND p.created_at <= ?)
        AND NOT EXISTS (SELECT 1 FROM payments p2
                        WHERE p2.member_id = members.id AND p2.status = 'completed'
                          AND p2.created_at >= ?))`,
      params: [c.windowStart, c.staleCutoff, c.windowStart],
    }),
  },
  {
    key: 'pending_no_payment',
    label: 'Signed up but never reached checkout',
    short: 'Never reached checkout',
    requiresPeriod: false,
    build: (c) => ({
      // The signup route creates the member before calling Stripe, so a thrown
      // createCheckoutSession leaves a pending member with no payment rows at all.
      sql: `(members.status = 'pending' AND members.created_at <= ?
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.member_id = members.id))`,
      params: [c.staleCutoff],
    }),
  },
  {
    key: 'duplicate_pending',
    label: 'Duplicate pending signup for this email',
    short: 'Duplicate signup',
    requiresPeriod: false,
    build: () => ({
      sql: `(members.status = 'pending' AND members.primary_member_id IS NULL
        AND EXISTS (SELECT 1 FROM members m2
                    WHERE m2.id <> members.id AND m2.primary_member_id IS NULL
                      AND LOWER(m2.email) = LOWER(members.email)))`,
      params: [],
    }),
  },
  {
    key: 'email_send_failed',
    label: 'An email failed and nothing has reached this address since',
    short: 'Email send failed',
    requiresPeriod: false,
    build: (c) => ({
      // Matches on to_email as well as member_id because otp and contact rows are
      // Two guards, both learned from production data:
      //
      // 1. The to_email fallback exists because otp and contact rows carry a null
      //    member_id, but family sub-members share the primary's address, so an
      //    unattributed failure would badge the whole family for one send. Restricting
      //    the fallback to primaries flags the one person you would actually call. A
      //    sub-member whose OWN send failed still matches on e.member_id.
      //
      // 2. A later successful send to the same address proves we can still reach them,
      //    so the failure is stale. Without this, one account-level MailerSend outage
      //    (or a trial quota limit) badges people for the entire lookback window even
      //    though every send since has worked. Mirrors how payment_failed clears itself
      //    once a payment completes.
      sql: `EXISTS (SELECT 1 FROM emails_log e
                    WHERE e.status = 'failed' AND e.created_at >= ?
                      AND (e.member_id = members.id
                           OR (e.member_id IS NULL
                               AND members.primary_member_id IS NULL
                               AND LOWER(e.to_email) = LOWER(members.email)))
                      AND NOT EXISTS (SELECT 1 FROM emails_log s
                                      WHERE s.status = 'sent'
                                        AND s.created_at > e.created_at
                                        AND LOWER(s.to_email) = LOWER(e.to_email)))`,
      params: [c.windowStart],
    }),
  },
  {
    key: 'renewal_never_started',
    label: 'Lapsed with an unused renewal link',
    short: 'Renewal never started',
    requiresPeriod: true,
    build: (c) => ({
      // Gated on expiry_date being in the past, and on FEWER than minReminders
      // reminders, so this is the complement of repeated_reminders rather than a
      // second badge on the same people. Without the expiry gate this would fire for
      // everyone who ever got one reminder, because generateRenewalToken re-extends
      // renewal_token_expires_at on every send.
      sql: `(members.primary_member_id IS NULL AND members.is_lifetime = 0
        AND members.renewal_token IS NOT NULL AND members.renewal_token_expires_at > ?
        AND members.expiry_date IS NOT NULL AND members.expiry_date < ?
        AND (SELECT COUNT(*) FROM emails_log e
             WHERE e.member_id = members.id AND e.email_type = 'renewal_reminder'
               AND e.created_at >= ?) < ?
        AND NOT EXISTS (SELECT 1 FROM membership_years my
                        WHERE my.member_id = members.id AND my.membership_period_id = ?))`,
      params: [c.nowIso, c.today, c.windowStart, c.minReminders, c.currentPeriodId],
    }),
  },
];

const SIGNAL_KEYS = ATTENTION_SIGNALS.map(s => s.key);

const SIGNAL_LABELS = ATTENTION_SIGNALS.map(({ key, label, short }) => ({ key, label, short }));

// Period-dependent signals go dark rather than throwing when no season is open,
// matching how the recently-renewed view degrades.
const NEVER = { sql: '1 = 0', params: [] };

function predicateFor(signal, c) {
  if (signal.requiresPeriod && !c.currentPeriodId) return NEVER;
  return signal.build(c);
}

/**
 * Who is eligible to be flagged at all: not cancelled, and not already paid up for the
 * current season.
 *
 * "Paid up" is enrollment in the current membership period — a membership_years row,
 * which is written only by a successful payment webhook and is the authoritative record
 * of "completed this season". Lifetime members are paid up by definition.
 *
 * Two definitions were tried and rejected:
 *
 * - `status != 'active'`. Nothing in this codebase ever writes status = 'expired' (there
 *   is no expiry job), so a lapsed member still carries status = 'active'. This would
 *   exclude the very people the renewal signals exist to find.
 * - The derived good-standing test used by the `active` viewClause, which treats a NULL
 *   expiry_date as current. Most of the membership has a NULL expiry_date because it
 *   predates expiry tracking, so this dropped ~106 of 172 active members who genuinely
 *   had not renewed.
 *
 * With no current period nobody can be enrolled, so this degrades to excluding only
 * cancelled members rather than silently emptying the list.
 */
function eligibilityGate(c) {
  const clauses = ["members.status != 'cancelled'", 'members.is_lifetime = 0'];
  const params = [];
  if (c.currentPeriodId) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM membership_years my
                              WHERE my.member_id = members.id AND my.membership_period_id = ?)`);
    params.push(c.currentPeriodId);
  }
  return { sql: `(${clauses.join(' AND ')})`, params };
}

/**
 * Predicate for the needs-attention view. Pass ctx.signal to narrow to one signal
 * instead of the full OR group.
 */
function attentionClause(ctx = {}) {
  const c = resolve(ctx);
  const selected = ctx.signal
    ? ATTENTION_SIGNALS.filter(s => s.key === ctx.signal)
    : ATTENTION_SIGNALS;

  // An unknown signal key must not silently widen to "everyone".
  if (!selected.length) return NEVER;

  const gate = eligibilityGate(c);
  const parts = selected.map(s => predicateFor(s, c));
  // Param order follows the SQL text: the gate's placeholder precedes the OR group's.
  return {
    sql: `(${gate.sql} AND (${parts.map(p => p.sql).join(' OR ')}))`,
    params: [...gate.params, ...parts.flatMap(p => p.params)],
  };
}

// SQLite caps a statement at 999 bound parameters, and the CSV export runs unlimited.
const ID_CHUNK_SIZE = 400;

/**
 * Per-member attribution: which signals fired for each of these ids.
 *
 * A second pass rather than extra columns on members.search(), because search() shares
 * one param array between its COUNT and its SELECT — select-list params would desync
 * the count. Reusing the same predicate text for both passes is what guarantees a
 * badge can never disagree with the filter that produced the row.
 *
 * Returns Map<id, [{key, label, short}]>.
 */
async function signalsForIds(ids, ctx = {}) {
  const result = new Map();
  if (!ids || !ids.length) return result;

  const c = resolve(ctx);
  const parts = ATTENTION_SIGNALS.map(s => ({ signal: s, ...predicateFor(s, c) }));
  // CASE ... THEN 1 ELSE 0 rather than a bare EXISTS: EXISTS returns a PostgreSQL
  // boolean but a SQLite integer, and that difference would leak into the CSV.
  const columns = parts.map(p => `CASE WHEN ${p.sql} THEN 1 ELSE 0 END AS s_${p.signal.key}`);
  const predicateParams = parts.flatMap(p => p.params);

  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + ID_CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await db.all(
      `SELECT id, ${columns.join(', ')} FROM members WHERE id IN (${placeholders})`,
      ...predicateParams,
      ...chunk
    );
    for (const row of rows) {
      result.set(
        row.id,
        ATTENTION_SIGNALS
          .filter(s => Number(row[`s_${s.key}`]) === 1)
          .map(({ key, label, short }) => ({ key, label, short }))
      );
    }
  }

  return result;
}

module.exports = {
  ATTENTION_SIGNALS,
  SIGNAL_KEYS,
  SIGNAL_LABELS,
  attentionClause,
  signalsForIds,
};
