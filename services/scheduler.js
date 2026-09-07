const cron = require('node-cron');
const logger = require('./logger');
const membershipExpiry = require('./membershipExpiry');
const { runWithActor } = require('../db/audit-context');

const DEFAULT_EXPIRY_CRON = '0 3 * * *';
const TIMEZONE = 'America/Denver';

/**
 * Register background jobs. Called from server.js#start(), which only runs under
 * `require.main === module` — every supertest suite does require('../../server'), so
 * registering at module scope would spawn live cron jobs inside Jest.
 *
 * Disabled unless EXPIRY_JOB_ENABLED is exactly 'true', matching the "blank = off"
 * convention the Sender and B2 integrations use.
 */
function start() {
  if (process.env.EXPIRY_JOB_ENABLED !== 'true') return [];

  const schedule = process.env.EXPIRY_JOB_CRON || DEFAULT_EXPIRY_CRON;
  if (!cron.validate(schedule)) {
    logger.error('Membership expiry job not scheduled — invalid cron expression', { schedule });
    return [];
  }

  const task = cron.schedule(schedule, async () => {
    // Nothing may escape: an unhandled rejection inside a cron tick takes down the
    // web process this job shares.
    try {
      await runWithActor(
        { id: null, email: 'cron:expire-memberships' },
        () => membershipExpiry.expireLapsedMemberships()
      );
    } catch (e) {
      logger.error('Membership expiry job threw', { error: e.message, stack: e.stack });
    }
  }, { timezone: TIMEZONE });

  logger.info('Membership expiry job scheduled', { schedule, timezone: TIMEZONE });
  return [task];
}

module.exports = { start, DEFAULT_EXPIRY_CRON };
