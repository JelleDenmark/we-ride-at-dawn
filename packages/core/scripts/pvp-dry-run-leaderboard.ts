/**
 * PvP dry run against the REAL depth leaderboard — not the (still-empty)
 * `pvp_boards` sync table `run-league-round.ts` reads. This pulls each
 * player's already-submitted `scores.lineup` for the current week (the same
 * hordes that reached the depth leaderboard under the old ranked-depth game)
 * and round-robins them through the actual PvP engine (`scoreRound`, the
 * exact function the nightly job uses), so we can see how those REAL boards
 * fare unit-vs-unit before anyone has manually synced a PvP board yet.
 *
 * This is throwaway analysis, not a shipped tool: `scores` rows are read-only
 * snapshots of what each player last submitted, not their current bench/relic
 * state, so this is a one-time gut check, not something the league itself
 * should ever run.
 *
 * Run:
 *   npm run pvp:dry-run                     # this week's prod leaderboard
 *   npm run pvp:dry-run -- --season 2026-07-27
 */
import { legalEntrants, scoreRound, type LeagueEntrant } from '../src/pvp';
import { currentRideDate } from '../src/seed';
import { seasonIdFor } from '../src/shop';
import type { Lineup } from '../src/data/units';

const SUPABASE_URL = 'https://wvrllhiktnkvbpclmrpq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6S2kGgYAI2gRLhfRxXBY3A_E_mIgpAi';

interface ScoreRow {
  name: string;
  device_id: string;
  depth: number;
  day: number;
  kills: number;
  lineup: Lineup;
}

function argSeason(): string | undefined {
  const i = process.argv.indexOf('--season');
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function fetchLeaderboard(seasonId: string): Promise<ScoreRow[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/scores?season_id=eq.${encodeURIComponent(seasonId)}` +
    `&order=depth.desc&select=name,device_id,depth,day,kills,lineup`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`scores fetch failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as ScoreRow[];
}

async function main() {
  const seasonId = argSeason() ?? seasonIdFor(currentRideDate(new Date()));
  console.log(`\n=== PvP dry run vs the depth leaderboard: season ${seasonId} ===`);

  const rows = await fetchLeaderboard(seasonId);
  if (rows.length === 0) {
    console.log('No scores rows for this season.');
    return;
  }
  console.log(`${rows.length} riders on the board.`);

  const nameById = new Map(rows.map((r) => [r.device_id, r.name]));
  const allEntrants: LeagueEntrant[] = rows.map((r) => ({ id: r.device_id, board: r.lineup }));
  const entrants = legalEntrants(allEntrants);
  const dropped = allEntrants.filter((e) => !entrants.some((l) => l.id === e.id));
  for (const d of dropped) console.log(`  DROPPED (illegal board): ${nameById.get(d.id)}`);

  if (entrants.length < 2) {
    console.log(`Only ${entrants.length} legal board(s) — need 2 to score.`);
    return;
  }

  const standings = scoreRound(entrants);
  console.log(`\nStandings (win 3 / draw 1 / loss 0; survivor_diff = health-margin tiebreak):`);
  standings.forEach((s, i) => {
    const sd = (s.survivorDiff >= 0 ? '+' : '') + s.survivorDiff;
    const name = (nameById.get(s.id) ?? s.id).slice(0, 20);
    console.log(
      `  ${String(i + 1).padEnd(3)}${name.padEnd(22)}pts=${String(s.points).padEnd(4)}` +
        `${s.wins}-${s.losses}-${s.draws}`.padEnd(8) + ` diff=${sd}`
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
