#!/usr/bin/env node
'use strict';

require('dotenv').config();

const migrate = require('../db/migrate');
const db = require('../db/database');
const membershipExpiry = require('../services/membershipExpiry');
const { runWithActor } = require('../db/audit-context');

const DRY_RUN = process.argv.includes('--dry-run');

const maxArg = process.argv.find(a => a.startsWith('--max='));
const MAX = maxArg ? parseInt(maxArg.slice('--max='.length), 10) : undefined;

async function main() {
  if (DRY_RUN) console.log('=== DRY RUN — no members will be expired ===\n');

  if (maxArg && (!Number.isInteger(MAX) || MAX < 0)) {
    console.error(`Invalid --max value: ${maxArg.slice('--max='.length)}`);
    process.exit(1);
  }

  await migrate();

  const opts = { dryRun: DRY_RUN };
  if (MAX !== undefined) opts.maxExpirations = MAX;

  const stats = await runWithActor(
    { id: null, email: 'script:expire-memberships' },
    () => membershipExpiry.expireLapsedMemberships(opts)
  );

  console.log('\n=== Summary ===');
  console.log(`  Lapsed found:  ${stats.total}`);
  console.log(`  Expired:       ${stats.expired}`);
  console.log(`  Failed:        ${stats.failed}`);

  if (stats.skipped === 'no-open-period') {
    console.log('\nNo membership period is currently open — nothing was changed.');
    console.log('Create the current season under Admin > Membership Periods first.');
  } else if (stats.skipped === 'over-ceiling') {
    console.log(`\nAborted: ${stats.total} candidates exceeds the safety ceiling.`);
    console.log(`Review the list with --dry-run, then re-run with --max=${stats.total}.`);
  } else if (DRY_RUN) {
    console.log('\n(dry run — nothing was changed)');
  }
}

main()
  .catch(err => {
    console.error('Fatal:', err.message, err.stack);
    process.exit(1);
  })
  .finally(() => db.close());
