#!/usr/bin/env node
'use strict';

require('dotenv').config();

const migrate = require('../db/migrate');
const db = require('../db/database');
const senderService = require('../services/sender');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (DRY_RUN) console.log('=== DRY RUN — no Sender writes will occur ===\n');

  if (!senderService.isConfigured()) {
    console.error('Sender is not configured. Set SENDER_API_TOKEN, SENDER_GROUP_CURRENT and SENDER_GROUP_LAPSED.');
    process.exit(1);
  }

  await migrate();

  const stats = await senderService.syncAllMembers({ dryRun: DRY_RUN });

  console.log('\n=== Summary ===');
  console.log(`  Unique emails:   ${stats.total}`);
  console.log(`  Synced:          ${stats.synced}`);
  console.log(`  Failed:          ${stats.failed}`);
  console.log(`  → Current group: ${stats.groups.current}`);
  console.log(`  → Lapsed group:  ${stats.groups.lapsed}`);
  console.log(`  → No group:      ${stats.groups.removed}`);
  if (DRY_RUN) console.log('\n(dry run — nothing was sent to Sender)');
}

main()
  .catch(err => {
    console.error('Fatal:', err.message, err.stack);
    process.exit(1);
  })
  .finally(() => db.close());
