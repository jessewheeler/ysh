#!/usr/bin/env node
'use strict';

require('dotenv').config();

const migrate = require('../db/migrate');
const db = require('../db/database');
const membersRepo = require('../db/repos/members');
const paymentsRepo = require('../db/repos/payments');
const periodsRepo = require('../db/repos/membershipPeriods');
const membershipYearsRepo = require('../db/repos/membershipYears');
const { runWithActor } = require('../db/audit-context');

const DRY_RUN = process.argv.includes('--dry-run');

async function enrollMember(memberId, email, period, paymentId, label, stats) {
  const alreadyEnrolled = await membershipYearsRepo.isEnrolled(memberId, period.id);
  if (alreadyEnrolled) {
    console.log(`  EXISTS member ${memberId} (${email}) → period ${period.id} (${period.label})${label}`);
    stats.alreadyEnrolled++;
    return false;
  }
  console.log(`  ENROLL member ${memberId} (${email}) → period ${period.id} (${period.label})${label}${paymentId ? ` via payment ${paymentId}` : ''}`);
  if (!DRY_RUN) {
    await membershipYearsRepo.enroll(memberId, period.id, paymentId);
  }
  stats.enrolled++;
  return true;
}

async function main() {
  if (DRY_RUN) console.log('=== DRY RUN — no writes will occur ===\n');

  await migrate();

  const stats = { enrolled: 0, alreadyEnrolled: 0, skipped: 0 };

  const allPeriods = await periodsRepo.list();
  if (allPeriods.length === 0) {
    console.warn('No membership_periods found — nothing to enroll into. Create at least one period first.');
    return;
  }

  const allMembers = await membersRepo.listAll();
  const primaries = allMembers.filter(m => m.primary_member_id == null);

  console.log(`Processing ${primaries.length} primary members against ${allPeriods.length} period(s)...\n`);

  await runWithActor({ id: null, email: 'script:backfill-membership-years' }, async () => {
    for (const member of primaries) {
      const payments = (await paymentsRepo.findByMemberId(member.id))
        .filter(p => p.status === 'completed')
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)); // oldest first

      const enrolledPeriodIds = new Set();

      // Strategy 1: membership_year integer → period (reliable for CSV-imported data where
      // payment created_at reflects import timestamp rather than actual payment date).
      // When this fires, skip strategy 2 — payment dates are unreliable for this member.
      let usedMembershipYear = false;
      if (member.membership_year) {
        const period = allPeriods.find(
          p => parseInt(p.start_date.slice(0, 4)) === member.membership_year
        );
        if (period) {
          const payment = payments[0] || null;
          await enrollMember(member.id, member.email, period, payment ? payment.id : null, '', stats);
          enrolledPeriodIds.add(period.id);
          usedMembershipYear = true;
        }
      }

      // Strategy 2: remaining payments → date-based period match (used only when
      // membership_year didn't match, e.g. future Stripe payments with real timestamps)
      if (!usedMembershipYear) {
        for (const payment of payments) {
          const paymentDate = new Date(payment.created_at).toISOString().slice(0, 10);
          const period = await periodsRepo.getCurrent(paymentDate);
          if (!period || enrolledPeriodIds.has(period.id)) continue;
          await enrollMember(member.id, member.email, period, payment.id, ' [payment date]', stats);
          enrolledPeriodIds.add(period.id);
        }
      }

      // Strategy 3: expiry_date range fallback (no payments at all)
      if (enrolledPeriodIds.size === 0 && member.expiry_date) {
        const expiryDate = new Date(member.expiry_date).toISOString().slice(0, 10);
        const period = allPeriods.find(
          p => p.start_date <= expiryDate && expiryDate <= p.end_date
        );
        if (!period) {
          console.warn(`  SKIP  member ${member.id} (${member.email}) — expiry ${expiryDate} falls outside all period windows`);
          stats.skipped++;
        } else {
          await enrollMember(member.id, member.email, period, null, ' [expiry fallback, no payment]', stats);
          enrolledPeriodIds.add(period.id);
        }
      } else if (enrolledPeriodIds.size === 0) {
        console.log(`  SKIP  member ${member.id} (${member.email}) — no completed payments and no expiry_date`);
        stats.skipped++;
      }

      // Mirror enrollments to family sub-members
      const familyMembers = await membersRepo.findFamilyMembers(member.id);
      if (familyMembers.length > 0 && enrolledPeriodIds.size > 0) {
        const primaryEnrollments = await membershipYearsRepo.findByMember(member.id);
        for (const enrollment of primaryEnrollments) {
          if (!enrolledPeriodIds.has(enrollment.membership_period_id)) continue;
          for (const fm of familyMembers) {
            const fmAlready = await membershipYearsRepo.isEnrolled(fm.id, enrollment.membership_period_id);
            if (fmAlready) {
              stats.alreadyEnrolled++;
            } else {
              console.log(`    ENROLL family ${fm.id} (${fm.email}) → period ${enrollment.membership_period_id}`);
              if (!DRY_RUN) {
                await membershipYearsRepo.enroll(fm.id, enrollment.membership_period_id, enrollment.payment_id);
              }
              stats.enrolled++;
            }
          }
        }
      }
    }
  });

  console.log('\n=== Summary ===');
  console.log(`  Enrolled:        ${stats.enrolled}`);
  console.log(`  Already existed: ${stats.alreadyEnrolled}`);
  console.log(`  Skipped:         ${stats.skipped}`);
  if (DRY_RUN) console.log('\n(dry run — no changes written)');
}

main()
  .catch(err => {
    console.error('Fatal:', err.message, err.stack);
    process.exit(1);
  })
  .finally(() => db.close());
