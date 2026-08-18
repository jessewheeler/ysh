const membersRepo = require('../db/repos/members');
const logger = require('./logger');

const API_BASE = 'https://api.sender.net/v2';
const REQUIRED_VARS = ['SENDER_API_TOKEN', 'SENDER_GROUP_CURRENT', 'SENDER_GROUP_LAPSED'];

// Sender rejects very large group payloads; chunk bulk add/remove calls.
const GROUP_CHUNK_SIZE = 500;

// Retry policy for 429 / 5xx (Sender's docs recommend exponential backoff).
const BASE_BACKOFF_MS = 1000;

// Two profiles. BACKGROUND is for the CLI backfill, where waiting out a rate-limit
// window is the right call. REQUEST is for anything inside an HTTP handler: a Stripe
// webhook that blocks for minutes gets re-delivered by Stripe, which re-runs payment
// completion and re-sends welcome/card emails — a duplicated signup is worse than a
// missed sync. A miss is only repaired by the next run of `scripts/sync-sender.js`,
// which nothing schedules yet, so it has to be run periodically by hand.
const BACKGROUND_RETRY = { maxAttempts: 5, maxBackoffMs: 60000 };
const REQUEST_RETRY = { maxAttempts: 2, maxBackoffMs: 1000 };

// When fewer than this many requests remain in the rate-limit window, wait it out.
const RATE_LIMIT_FLOOR = 2;

function isConfigured() {
  return REQUIRED_VARS.every((v) => process.env[v]);
}

function currentGroupId() {
  return process.env.SENDER_GROUP_CURRENT;
}

function lapsedGroupId() {
  return process.env.SENDER_GROUP_LAPSED;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt, maxBackoffMs) {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt - 1), maxBackoffMs);
}

// Sender returns `Retry-After` in seconds on 429; fall back to exponential backoff.
function retryAfterMs(res, attempt, maxBackoffMs) {
  const header = res.headers && res.headers.get ? res.headers.get('Retry-After') : null;
  const seconds = parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, maxBackoffMs);
  return backoffMs(attempt, maxBackoffMs);
}

/**
 * How long until the rate-limit window resets, in ms.
 *
 * Sender sends X-RateLimit-Reset as a bare integer, so Date.parse() on it is always
 * NaN — the header has to be read numerically. It is epoch seconds in practice, but
 * accept epoch ms and plain seconds-remaining too rather than silently mis-waiting.
 */
function rateLimitResetMs(header) {
  const value = parseInt(header, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value > 1e12) return value - Date.now();            // epoch milliseconds
  if (value > 1e9) return value * 1000 - Date.now();      // epoch seconds
  return value * 1000;                                     // seconds remaining
}

// Sender's rate limit is per account per minute. When the window is nearly spent,
// pause until X-RateLimit-Reset rather than burning a 429.
async function respectRateLimit(res, { maxBackoffMs }) {
  if (!res.headers || !res.headers.get) return;
  const remaining = parseInt(res.headers.get('X-RateLimit-Remaining'), 10);
  if (!Number.isFinite(remaining) || remaining > RATE_LIMIT_FLOOR) return;

  const resetMs = rateLimitResetMs(res.headers.get('X-RateLimit-Reset'));
  const waitMs = resetMs === null ? BASE_BACKOFF_MS : resetMs;
  if (waitMs > 0) {
    logger.info('Sender rate limit nearly exhausted, pausing', { remaining, waitMs });
    await sleep(Math.min(waitMs, maxBackoffMs));
  }
}

/**
 * Single Sender API call with retry on 429 and 5xx.
 * Resolves to { ok, status, body }; never throws on an HTTP error status, so callers
 * can branch on `status` (the create → update fallback needs this).
 */
async function senderRequest(method, path, body, retry = BACKGROUND_RETRY) {
  const { maxAttempts, maxBackoffMs } = retry;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${process.env.SENDER_API_TOKEN}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // Network-level failure — retry.
      lastError = err;
      if (attempt === maxAttempts) throw err;
      await sleep(backoffMs(attempt, maxBackoffMs));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxAttempts) {
        const parsed = await res.json().catch(() => ({}));
        return { ok: false, status: res.status, body: parsed };
      }
      const wait = res.status === 429
        ? retryAfterMs(res, attempt, maxBackoffMs)
        : backoffMs(attempt, maxBackoffMs);
      logger.warn('Sender request retrying', { method, path, status: res.status, attempt, wait });
      await sleep(wait);
      continue;
    }

    await respectRateLimit(res, retry);

    const parsed = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: parsed };
  }

  throw lastError || new Error('Sender request failed');
}

function errorMessage(result) {
  const body = result.body || {};
  if (body.message && typeof body.message === 'string') return body.message;
  if (body.errors) return JSON.stringify(body.errors);
  return `HTTP ${result.status}`;
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Which Sender group a member belongs in, or null if they belong in none
 * (pending members never paid; cancelled members opted out).
 *
 * Lapsed has to be *derived*, not read off `status`: nothing in the app ever writes
 * status='expired' (only an admin picking it by hand does), so a membership that simply
 * runs out keeps status='active' with a past expiry_date. This mirrors the expired
 * predicate the member list uses — see the status filter in db/repos/members.js.
 *
 * There is deliberately no "all members" group — Sender's subscriber list already
 * is that, so a campaign to everyone needs no group at all.
 */
function groupForMember(member, today = isoDate()) {
  if (member.status === 'pending' || member.status === 'cancelled') return null;
  if (member.is_lifetime) return currentGroupId();
  if (member.status === 'expired') return lapsedGroupId();
  if (member.expiry_date && member.expiry_date < today) return lapsedGroupId();
  return member.status === 'active' ? currentGroupId() : null;
}

function buildSubscriber(member) {
  return {
    email: normalizeEmail(member.email),
    firstname: member.first_name || '',
    lastname: member.last_name || '',
    fields: {
      '{$member_number}': member.member_number || '',
      '{$membership_expires}': member.expiry_date || '',
    },
    // Never fire Sender automations from a sync — especially not during a backfill.
    trigger_automation: false,
  };
}

/**
 * Create the subscriber, falling back to update when Sender says it already exists.
 * `groups` is deliberately never sent: on Sender it *replaces* group assignment, which
 * would wipe any group a human curated by hand. Groups are reconciled separately.
 */
async function upsertSubscriber(member, retry = BACKGROUND_RETRY) {
  const payload = buildSubscriber(member);
  const created = await senderRequest('POST', '/subscribers', payload, retry);
  if (created.ok) return created;

  // 409/422 both signal "this email is already a subscriber" depending on plan.
  if (created.status === 409 || created.status === 422) {
    const updated = await senderRequest(
      'PATCH',
      `/subscribers/${encodeURIComponent(payload.email)}`,
      payload,
      retry
    );
    if (updated.ok) return updated;
    throw new Error(errorMessage(updated));
  }

  throw new Error(errorMessage(created));
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function addToGroup(groupId, emails, retry = BACKGROUND_RETRY) {
  for (const batch of chunk(emails, GROUP_CHUNK_SIZE)) {
    const result = await senderRequest('POST', `/subscribers/groups/${groupId}`, { subscribers: batch }, retry);
    if (!result.ok) throw new Error(errorMessage(result));
  }
}

async function removeFromGroup(groupId, emails, retry = BACKGROUND_RETRY) {
  for (const batch of chunk(emails, GROUP_CHUNK_SIZE)) {
    const result = await senderRequest('DELETE', `/subscribers/groups/${groupId}`, { subscribers: batch }, retry);
    if (!result.ok) throw new Error(errorMessage(result));
  }
}

// Removing a subscriber from a group they were never in is the normal case, and Sender
// reports it as an error; never let that abandon the rest of a reconciliation.
async function removeFromGroupQuietly(groupId, emails, retry = BACKGROUND_RETRY) {
  if (!emails.length) return;
  try {
    await removeFromGroup(groupId, emails, retry);
  } catch (e) {
    logger.warn('Sender group removal failed', { groupId, count: emails.length, error: e.message });
  }
}

/**
 * Sync one member: upsert the subscriber, then put them in exactly the right group.
 * Removing from the other group is what makes a status change (active → expired) stick.
 *
 * The add runs before the removes, and a failed remove is logged rather than thrown:
 * removing a subscriber from a group they were never in is the common case, and if
 * Sender rejects it we still want the member to have landed in the right group.
 */
async function syncMember(memberId, retry = BACKGROUND_RETRY) {
  if (!isConfigured()) return { skipped: true };

  const member = await membersRepo.findById(memberId);
  if (!member) throw new Error(`Member ${memberId} not found`);
  if (!normalizeEmail(member.email)) throw new Error(`Member ${memberId} has no email`);

  await upsertSubscriber(member, retry);

  const email = normalizeEmail(member.email);
  const target = groupForMember(member);

  if (target) await addToGroup(target, [email], retry);

  for (const groupId of [currentGroupId(), lapsedGroupId()]) {
    if (groupId === target) continue;
    await removeFromGroupQuietly(groupId, [email], retry);
  }

  return { skipped: false, email, group: target };
}

/**
 * Wrapper for request handlers: logs and swallows everything, so a Sender outage can
 * never fail a paid signup or an admin save. Uses the short REQUEST_RETRY budget so a
 * slow Sender can't hold an HTTP response open long enough for the caller to time out.
 */
async function syncMemberSafe(memberId) {
  if (!isConfigured()) return;
  try {
    await syncMember(memberId, REQUEST_RETRY);
  } catch (e) {
    logger.error('Sender sync failed for member', { memberId, error: e.message });
  }
}

/**
 * Sync a set of members touched by one request (a family signup, say), collapsing
 * shared email addresses first. Family sub-members carry the primary's email, so
 * syncing them individually would overwrite the primary's name in Sender with a
 * sub-member's.
 */
async function syncMembersSafe(members) {
  if (!isConfigured()) return;

  let targets = [];
  try {
    targets = dedupeByEmail((members || []).filter(Boolean));
  } catch (e) {
    // Nothing here may escape: this runs inside the Stripe webhook, and a throw there
    // means Stripe re-delivers the event and the signup is processed twice.
    logger.error('Sender member dedupe failed', { error: e.message });
    return;
  }

  for (const member of targets) {
    await syncMemberSafe(member.id);
  }
}

/**
 * Reconcile one email address after the member behind it is gone or renamed.
 *
 * If any member still holds the address (a family primary whose sub-member was
 * deleted, say) it is re-synced from that member; otherwise the address is dropped
 * from both groups so a deleted member stops receiving club mail. The subscriber
 * itself is left in Sender — this integration never deletes subscribers.
 */
async function syncEmailSafe(email) {
  if (!isConfigured()) return;

  const normalized = normalizeEmail(email);
  if (!normalized) return;

  try {
    // members.email is stored as typed, so look up the raw address before the
    // lowercased one (the DB lookup is case-sensitive; Sender's keying is not).
    const holder = await membersRepo.findByEmail(email)
      || (email !== normalized ? await membersRepo.findByEmail(normalized) : null);
    if (holder) {
      await syncMember(holder.id, REQUEST_RETRY);
      return;
    }
    for (const groupId of [currentGroupId(), lapsedGroupId()]) {
      await removeFromGroupQuietly(groupId, [normalized], REQUEST_RETRY);
    }
  } catch (e) {
    logger.error('Sender sync failed for email', { email: normalized, error: e.message });
  }
}

/**
 * Collapse members to one record per email address.
 *
 * members.email is only unique among primaries (see the partial index in db/schema.js);
 * family sub-members routinely share the primary's address. Sender keys on email, so
 * without this the family row would overwrite the primary's name and status.
 */
function dedupeByEmail(members) {
  const byEmail = new Map();
  for (const member of members) {
    const email = normalizeEmail(member.email);
    if (!email) continue;

    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, member);
      continue;
    }
    // Primary wins over a sub-member sharing the address.
    const existingIsPrimary = existing.primary_member_id == null;
    const candidateIsPrimary = member.primary_member_id == null;
    if (candidateIsPrimary && !existingIsPrimary) byEmail.set(email, member);

    // Two unrelated primaries can still collide here: the DB's unique index on
    // members.email is case-sensitive, Sender's keying is not. One of them loses their
    // name and member number in Sender, so say which.
    if (candidateIsPrimary && existingIsPrimary) {
      logger.warn('Two primary members share one Sender address; keeping the first', {
        email, kept: existing.id, dropped: member.id,
      });
    }
  }
  return [...byEmail.values()];
}

/**
 * Full backfill. Phase A upserts every subscriber one at a time (Sender has no bulk
 * create); Phase B reconciles group membership in a handful of bulk calls.
 */
async function syncAllMembers({ dryRun = false } = {}) {
  if (!isConfigured()) {
    throw new Error(`Sender is not configured — set ${REQUIRED_VARS.join(', ')}`);
  }

  const members = dedupeByEmail(await membersRepo.listAll());
  const stats = {
    total: members.length,
    synced: 0,
    failed: 0,
    groups: { current: 0, lapsed: 0, removed: 0 },
  };

  const current = [];
  const lapsed = [];
  const ungrouped = [];
  const today = isoDate();

  for (const member of members) {
    const email = normalizeEmail(member.email);
    const target = groupForMember(member, today);

    if (dryRun) {
      stats.synced++;
    } else {
      // Phase A — one call per member, sequential so the rate limiter stays accurate.
      try {
        await upsertSubscriber(member);
        stats.synced++;
      } catch (e) {
        logger.error('Sender upsert failed for member', { memberId: member.id, error: e.message });
        stats.failed++;
        // Leave them out of the group batches entirely: Sender rejects a whole chunk
        // over one unknown subscriber, which would take the other 499 down with it.
        continue;
      }
    }

    if (target === currentGroupId()) current.push(email);
    else if (target === lapsedGroupId()) lapsed.push(email);
    else ungrouped.push(email);
  }

  stats.groups.current = current.length;
  stats.groups.lapsed = lapsed.length;
  stats.groups.removed = ungrouped.length;

  if (!dryRun) {
    // Phase B — bulk group reconciliation. Adds first, then removes, and a failed
    // remove is logged rather than thrown: most of these subscribers were never in the
    // group being removed from, which Sender reports as an error. Letting that reject
    // would abandon the rest of the reconciliation half-done.
    await addToGroup(currentGroupId(), current);
    await addToGroup(lapsedGroupId(), lapsed);
    await removeFromGroupQuietly(currentGroupId(), [...lapsed, ...ungrouped]);
    await removeFromGroupQuietly(lapsedGroupId(), [...current, ...ungrouped]);
  }

  logger.info('Sender full sync completed', stats);
  return stats;
}

module.exports = {
  isConfigured,
  groupForMember,
  buildSubscriber,
  dedupeByEmail,
  upsertSubscriber,
  syncMember,
  syncMemberSafe,
  syncMembersSafe,
  syncEmailSafe,
  syncAllMembers,
};
