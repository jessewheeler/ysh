const cron = require('node-cron');
const logger = require('./logger');
const membershipExpiry = require('./membershipExpiry');
const nflSchedule = require('./nflSchedule');
const { runWithActor } = require('../db/audit-context');

const DEFAULT_EXPIRY_CRON = '0 3 * * *';
// Mondays at 4 AM: after the weekend's games, when the league announces flex changes.
const DEFAULT_SCHEDULE_SYNC_CRON = '0 4 * * 1';
const TIMEZONE = 'America/Denver';

/**
 * Schedule one in-process job. Nothing may escape the tick: an unhandled rejection inside
 * a cron callback takes down the web process the job shares.
 */
function scheduleJob({ name, schedule, actorEmail, run }) {
  if (!cron.validate(schedule)) {
    logger.error(`${name} not scheduled — invalid cron expression`, { schedule });
    return null;
  }
  const task = cron.schedule(schedule, async () => {
    try {
      await runWithActor({ id: null, email: actorEmail }, run);
    } catch (e) {
      logger.error(`${name} threw`, { error: e.message, stack: e.stack });
    }
  }, { timezone: TIMEZONE });
  logger.info(`${name} scheduled`, { schedule, timezone: TIMEZONE });
  return task;
}

/**
 * Register background jobs. Called from server.js#start(), which only runs under
 * `require.main === module` — every supertest suite does require('../../server'), so
 * registering at module scope would spawn live cron jobs inside Jest.
 *
 * Each job is disabled unless its *_ENABLED variable is exactly 'true', matching the
 * "blank = off" convention the Sender and B2 integrations use.
 */
function start() {
  const tasks = [];

  if (process.env.EXPIRY_JOB_ENABLED === 'true') {
    tasks.push(scheduleJob({
      name: 'Membership expiry job',
      schedule: process.env.EXPIRY_JOB_CRON || DEFAULT_EXPIRY_CRON,
      actorEmail: 'cron:expire-memberships',
      run: () => membershipExpiry.expireLapsedMemberships(),
    }));
  }

  if (process.env.SCHEDULE_SYNC_ENABLED === 'true') {
    tasks.push(scheduleJob({
      name: 'Seahawks schedule sync',
      schedule: process.env.SCHEDULE_SYNC_CRON || DEFAULT_SCHEDULE_SYNC_CRON,
      actorEmail: 'cron:sync-schedule',
      run: () => nflSchedule.syncSchedule(),
    }));
  }

  return tasks.filter(Boolean);
}

module.exports = { start, DEFAULT_EXPIRY_CRON, DEFAULT_SCHEDULE_SYNC_CRON };
