const eventsRepo = require('../db/repos/events');
const eventsService = require('./events');
const logger = require('./logger');

// ESPN's public site API. Unofficial and unauthenticated, so every failure here is logged
// and swallowed by callers — manual event creation always works without it.
const SCHEDULE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/sea/schedule';
const TEAM_ABBR = 'SEA';
const FETCH_TIMEOUT_MS = 10000;
// seasontype: 2 = regular season, 3 = postseason. Preseason (1) is not a watch party.
const SEASON_TYPES = [2, 3];
const EASTERN_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** The NFL season a date belongs to: January–February games belong to the previous year. */
function currentSeason(now = new Date()) {
  return now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

/**
 * Map one ESPN schedule event to our event fields, or null when it isn't a Seahawks game
 * we can place. ESPN sets timeValid=false while a kickoff is TBD (late-season flex games);
 * the date is still its best guess, so keep the date and leave kickoff_at empty.
 */
function mapEspnEvent(ev) {
  const comp = ev && ev.competitions && ev.competitions[0];
  if (!ev || !ev.id || !ev.date || !comp || !Array.isArray(comp.competitors)) return null;
  const us = comp.competitors.find(c => c.team && c.team.abbreviation === TEAM_ABBR);
  const them = comp.competitors.find(c => c !== us);
  if (!us || !them) return null;

  const opponent = (them.team && them.team.displayName) || null;
  const homeAway = us.homeAway === 'home' || us.homeAway === 'away' ? us.homeAway : null;
  const timeValid = ev.timeValid !== false && comp.timeValid !== false;
  // "Week 3", or for postseason games "Divisional Round", "Super Bowl".
  const label = ev.week && ev.week.text;
  const matchup = opponent ? `${homeAway === 'away' ? 'at' : 'vs'} ${opponent}` : ev.name;

  return {
    external_id: String(ev.id),
    name: label ? `${label}: ${matchup}` : matchup,
    // A TBD placeholder is midnight Eastern (05:00Z), which is still the previous day in
    // Denver, so read the placeholder's date where ESPN wrote it.
    event_date: timeValid ? eventsService.localDate(ev.date) : EASTERN_DATE_FMT.format(new Date(ev.date)),
    kickoff_at: timeValid ? new Date(ev.date).toISOString() : null,
    opponent,
    home_away: homeAway,
  };
}

async function fetchSeasonType(season, seasonType) {
  const url = `${SCHEDULE_URL}?season=${encodeURIComponent(season)}&seasontype=${seasonType}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ESPN schedule request failed: HTTP ${res.status}`);
  const body = await res.json();
  return Array.isArray(body.events) ? body.events : [];
}

/** Every Seahawks regular and postseason game ESPN lists for a season, mapped. */
async function fetchSeahawksSchedule(season = currentSeason()) {
  const games = [];
  for (const type of SEASON_TYPES) {
    for (const ev of await fetchSeasonType(season, type)) {
      const mapped = mapEspnEvent(ev);
      if (mapped) games.push(mapped);
    }
  }
  return games;
}

/**
 * Create a watch-party event for every game we don't have yet, matched on the ESPN id.
 *
 * For a game we already have, only the date and kickoff are refreshed — flex scheduling
 * moves them, and staff need the right day at the door. Name, location, notes and the
 * cancelled flag belong to the admins once the event exists, so a sync never overwrites them.
 *
 * Returns {created, updated, unchanged, total}. Throws when ESPN can't be reached.
 */
async function syncSchedule({ season = currentSeason(), dryRun = false } = {}) {
  const games = await fetchSeahawksSchedule(season);
  const stats = { created: 0, updated: 0, unchanged: 0, total: games.length };

  for (const game of games) {
    const existing = await eventsRepo.findByExternalId(game.external_id);
    if (!existing) {
      stats.created++;
      if (!dryRun) await eventsService.createEvent({ ...game, source: 'espn' });
      continue;
    }
    const changes = {};
    if (existing.event_date !== game.event_date) changes.event_date = game.event_date;
    const oldKickoff = existing.kickoff_at ? new Date(existing.kickoff_at).toISOString() : null;
    if (oldKickoff !== game.kickoff_at) changes.kickoff_at = game.kickoff_at;
    if (Object.keys(changes).length) {
      stats.updated++;
      if (!dryRun) await eventsRepo.update(existing.id, changes);
    } else {
      stats.unchanged++;
    }
  }

  logger.info('Seahawks schedule sync completed', { season, dryRun, ...stats });
  return stats;
}

module.exports = { currentSeason, mapEspnEvent, fetchSeahawksSchedule, syncSchedule };
