#!/usr/bin/env node
'use strict';

/**
 * Repairs members whose offline (cash/check) dues payment never moved them onto the
 * membership period they paid for.
 *
 * The admin offline-payment route used to gate every period side effect on the member not
 * already being `active`, so a renewal paid by a still-active member recorded the payment
 * and nothing else: no membership_years enrollment, no new expiry_date, no membership_year
 * bump, and no cascade to their family. This finds those members and puts them right,
 * using the same services/activation.js the fixed routes now use so the two cannot drift.
 *
 * Usage:
 *   node scripts/repair-offline-renewals.js                  # dry run, current period
 *   node scripts/repair-offline-renewals.js --apply
 *   node scripts/repair-offline-renewals.js --period-id=3 --apply
 *   node scripts/repair-offline-renewals.js --all-periods --apply
 *   node scripts/repair-offline-renewals.js --member-id=42 --apply
 *
 * Delivery is off unless asked for, so a bulk repair of past renewals never mails anybody
 * a months-old welcome:
 *   --cards     regenerate the PDF/PNG membership cards; sends no email
 *   --emails    send the welcome (with whatever cards exist) and the receipt
 *   --deliver   both, matching what a Stripe payment does
 *
 * A payment only counts when it is dated inside the period's window. Members who renewed
 * early — paid before the period opened, which the renewal reminders actively encourage —
 * are reported as NOPAY rather than silently passed over; widen the window with
 * --early-days=N (e.g. --early-days=90) to sweep them in.
 *
 * Dry run is the default — deliberately the inverse of backfill-membership-years.js,
 * because this is expected to be pointed at production.
 */

require('dotenv').config();

const migrate = require('../db/migrate');
const db = require('../db/database');
const membersRepo = require('../db/repos/members');
const paymentsRepo = require('../db/repos/payments');
const periodsRepo = require('../db/repos/membershipPeriods');
const membershipYearsRepo = require('../db/repos/membershipYears');
const activation = require('../services/activation');
const { runWithActor } = require('../db/audit-context');

/** Turns the command line into the options `run` takes, so tests can call it directly. */
function parseArgs(argv) {
  const has = flag => argv.includes(flag);
  const valueOf = name => {
    const hit = argv.find(a => a.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1) : null;
  };
  const deliver = has('--deliver');
  return {
    apply: has('--apply'),
    allPeriods: has('--all-periods'),
    periodId: valueOf('--period-id'),
    memberId: valueOf('--member-id'),
    cards: deliver || has('--cards'),
    emails: deliver || has('--emails'),
    earlyDays: parseInt(valueOf('--early-days'), 10) || 0,
  };
}

/** Both period bounds and payment timestamps are YYYY-MM-DD-prefixed strings. */
const dayOf = value => String(value || '').slice(0, 10);
const startYearOf = period => parseInt(String(period.start_date).slice(0, 4), 10);

/** YYYY-MM-DD shifted by whole days, via UTC so no local timezone rolls the date over. */
function shiftDays(date, days) {
  const d = new Date(`${dayOf(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The payment that put this member in the period: completed, not Stripe (the webhook
 * handles those correctly), and dated inside the period's window.
 */
async function offlinePaymentFor(memberId, period, earlyDays = 0) {
  const payments = await paymentsRepo.findByMemberId(memberId);
  const opensAt = shiftDays(period.start_date, -earlyDays);
  const inWindow = payments.filter(p =>
    p.status === 'completed'
    && (p.payment_method || 'stripe') !== 'stripe'
    && dayOf(p.created_at) >= opensAt
    && dayOf(p.created_at) <= period.end_date
  );
  // Oldest first, so the enrollment links to the payment that actually opened the period.
  inWindow.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return inWindow[0] || null;
}

const stats0 = () => ({ repaired: 0, alreadyCorrect: 0, skipped: 0, noPayment: 0, membersTouched: 0 });

/** What is wrong with this row for this period, as human-readable field diffs. */
async function problemsWith(member, period) {
  const problems = [];
  if (member.status !== 'active') problems.push(`status ${member.status} → active`);
  if (member.membership_year !== startYearOf(period)) {
    problems.push(`membership_year ${member.membership_year} → ${startYearOf(period)}`);
  }
  if (dayOf(member.expiry_date) !== period.end_date) {
    problems.push(`expiry_date ${member.expiry_date || 'none'} → ${period.end_date}`);
  }
  if (!(await membershipYearsRepo.isEnrolled(member.id, period.id))) {
    problems.push('no membership_years enrollment');
  }
  return problems;
}

/**
 * True when the member is already enrolled in a period that opened later than this one.
 * Repairing them would roll a newer membership backwards, so they are left alone.
 */
async function hasNewerEnrollment(memberId, period) {
  const enrollments = await membershipYearsRepo.findByMember(memberId);
  for (const enrollment of enrollments) {
    if (enrollment.membership_period_id === period.id) continue;
    const other = await periodsRepo.get(enrollment.membership_period_id);
    if (other && other.start_date > period.start_date) return true;
  }
  return false;
}

async function repairPeriod(period, members, stats, opts) {
  console.log(`\n=== Period ${period.id} — ${period.label || 'unlabelled'} (${period.start_date} → ${period.end_date}) ===`);

  for (const member of members) {
    const family = member.membership_type === 'family'
      ? await membersRepo.findFamilyMembers(member.id)
      : [];

    const diffs = [];
    for (const row of [member, ...family]) {
      const problems = await problemsWith(row, period);
      if (problems.length) {
        diffs.push(`      ${row.id === member.id ? 'primary' : 'family '} ${row.id} (${row.email}): ${problems.join('; ')}`);
      }
    }

    const payment = await offlinePaymentFor(member.id, period, opts.earlyDays);

    if (diffs.length === 0) {
      if (payment) stats.alreadyCorrect++;
      continue;
    }

    if (!payment) {
      // Out of scope for an automatic repair — but worth naming, because an early renewal
      // paid before the period opened looks exactly like this. --early-days widens the window.
      console.log(`  NOPAY  member ${member.id} (${member.email}) — needs repair but has no offline payment dated in the window`);
      stats.noPayment++;
      continue;
    }

    if (await hasNewerEnrollment(member.id, period)) {
      console.log(`  SKIP   member ${member.id} (${member.email}) — already enrolled in a later period`);
      stats.skipped++;
      continue;
    }

    console.log(`  REPAIR member ${member.id} (${member.email}) via ${payment.payment_method} payment ${payment.id} of $${(payment.amount_cents / 100).toFixed(2)} on ${dayOf(payment.created_at)}`);
    diffs.forEach(line => console.log(line));

    if (opts.apply) {
      const { primary, members: group } = await activation.activateForPeriod({
        memberId: member.id,
        period,
        paymentId: payment.id,
      });
      if (opts.cards || opts.emails) {
        await activation.deliverActivation({
          primary,
          members: group,
          receipt: opts.emails ? { amount_total: payment.amount_cents } : null,
          generateCards: opts.cards,
          sendEmails: opts.emails,
        });
      }
    }

    stats.repaired++;
    stats.membersTouched += 1 + family.length;
  }
}

async function run(options = {}) {
  const opts = {
    apply: false, allPeriods: false, periodId: null, memberId: null,
    cards: false, emails: false, earlyDays: 0, migrate: true, ...options,
  };

  if (!opts.apply) console.log('=== DRY RUN — no writes will occur. Re-run with --apply to commit. ===');
  if (opts.apply && (opts.cards || opts.emails)) {
    console.log(`=== Delivery ON: ${opts.cards ? 'cards' : ''}${opts.cards && opts.emails ? ' + ' : ''}${opts.emails ? 'emails' : ''} ===`);
  }

  if (opts.migrate) await migrate();

  let periods;
  if (opts.allPeriods) {
    // Oldest first: each pass's newer-enrollment guard then leaves every member sitting on
    // the latest period they actually paid for.
    periods = (await periodsRepo.list()).slice().sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  } else if (opts.periodId) {
    const period = await periodsRepo.get(parseInt(opts.periodId, 10));
    if (!period) {
      console.error(`No membership period with id ${opts.periodId}.`);
      process.exitCode = 1;
      return stats0();
    }
    periods = [period];
  } else {
    const current = await periodsRepo.getCurrent();
    if (!current) {
      console.warn('No membership period is currently open. Pass --period-id=N or --all-periods.');
      return stats0();
    }
    periods = [current];
  }

  let members;
  if (opts.memberId) {
    const member = await membersRepo.findById(parseInt(opts.memberId, 10));
    if (!member) {
      console.error(`No member with id ${opts.memberId}.`);
      process.exitCode = 1;
      return stats0();
    }
    // A payment against a sub-member is a payment for the household; work from the primary.
    const primary = member.primary_member_id
      ? await membersRepo.findById(member.primary_member_id)
      : member;
    members = [primary];
  } else {
    members = (await membersRepo.listAll()).filter(m => m.primary_member_id == null);
  }

  const stats = stats0();

  await runWithActor({ id: null, email: 'script:repair-offline-renewals' }, async () => {
    for (const period of periods) {
      await repairPeriod(period, members, stats, opts);
    }
  });

  console.log('\n=== Summary ===');
  console.log(`  Households repaired: ${stats.repaired}`);
  console.log(`  Member rows touched: ${stats.membersTouched}`);
  console.log(`  Already correct:     ${stats.alreadyCorrect}`);
  console.log(`  Skipped (newer):     ${stats.skipped}`);
  console.log(`  No matching payment: ${stats.noPayment}`);
  if (!opts.apply) console.log('\n(dry run — no changes written; re-run with --apply)');

  return stats;
}

module.exports = { run, parseArgs };

if (require.main === module) {
  run(parseArgs(process.argv.slice(2)))
    .catch(err => {
      console.error('Fatal:', err.message, err.stack);
      process.exit(1);
    })
    .finally(() => db.close());
}
