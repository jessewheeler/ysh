#!/usr/bin/env node
'use strict';

require('dotenv').config();

const migrate = require('../db/migrate');
const db = require('../db/database');
const nflSchedule = require('../services/nflSchedule');
const { runWithActor } = require('../db/audit-context');

const DRY_RUN = process.argv.includes('--dry-run');

const seasonArg = process.argv.find(a => a.startsWith('--season='));
const SEASON = seasonArg ? parseInt(seasonArg.slice('--season='.length), 10) : nflSchedule.currentSeason();

async function main() {
  if (!Number.isInteger(SEASON) || SEASON < 2000) {
    console.error(`Invalid --season value: ${seasonArg.slice('--season='.length)}`);
    process.exit(1);
  }
  if (DRY_RUN) console.log('=== DRY RUN — no events will be written ===\n');

  await migrate();

  const stats = await runWithActor(
    { id: null, email: 'script:sync-schedule' },
    () => nflSchedule.syncSchedule({ season: SEASON, dryRun: DRY_RUN })
  );

  console.log(`\n=== ${SEASON} Seahawks schedule ===`);
  console.log(`  Games found:  ${stats.total}`);
  console.log(`  Created:      ${stats.created}`);
  console.log(`  Updated:      ${stats.updated}`);
  console.log(`  Unchanged:    ${stats.unchanged}`);
  if (DRY_RUN) console.log('\n(dry run — nothing was changed)');
}

main()
  .catch(err => {
    console.error('Fatal:', err.message, err.stack);
    process.exit(1);
  })
  .finally(() => db.close());
