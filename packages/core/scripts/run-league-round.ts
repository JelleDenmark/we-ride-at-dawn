/**
 * Nightly PvP league round runner — the cron entry point
 * (.github/workflows/wrad-pvp-cron.yml) and the phone-friendly manual trigger
 * (that workflow's workflow_dispatch button, which doubles as the dev trigger).
 *
 * Scores whatever boards are currently synced for TODAY's season into one
 * round (id `${season}#${rideDate}`), writes the standings, and marks the
 * round closed. Season and ride-date come from the same core helpers the
 * client uses (`seasonIdFor`/`currentRideDate`), so the job scores exactly the
 * league week and day a player sees — including the 06:00 Copenhagen rollover.
 *
 * Run:
 *   npm run pvp:round -- --dry        # preview: fetch + score, write nothing
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run pvp:round   # for real (needs the key)
 *
 * The service-role key is required to WRITE (pvp_rounds / pvp_results have no
 * anon write policy). In CI it comes from the SUPABASE_SERVICE_ROLE_KEY repo
 * secret; without it (or with --dry) the run is a read-only preview.
 *
 * A real (non-dry, non-preview) round on the public season also posts the
 * standings to the #wrad Discord channel (issue #162, lib/discord-post.ts) —
 * needs a DISCORD_BOT_TOKEN repo secret; without it that post is skipped, same
 * degrade-not-fail shape as the missing service-role key above.
 */
import { currentRideDate } from '../src/seed';
import { seasonIdFor } from '../src/shop';
import { runNightlyRound } from './lib/pvp-league';
import { postPvpResults } from './lib/discord-post';

const DRY = process.argv.slice(2).some((a) => a === '--dry' || a === 'dry');

async function runSeason(
  seasonId: string,
  rideDate: string,
  now: Date,
  key: string | undefined,
  notifyDiscord: boolean
) {
  const roundId = `${seasonId}#${rideDate}`;
  console.log(`\n=== round ${roundId}${DRY ? '  (DRY RUN)' : ''} ===`);

  const outcome = await runNightlyRound(seasonId, roundId, now, key);
  console.log(`Fetched boards, ${outcome.dropped.length} dropped as illegal.`);
  for (const d of outcome.dropped) console.log(`  - ${d.name} (${d.device_id})`);

  if (outcome.skipped) {
    console.log(`Only ${outcome.scored} legal board(s) — need 2 to score. Nothing written.`);
    return;
  }

  console.log(`Standings (points: win 3 / draw 1 / loss 0; survivor_diff breaks ties):`);
  outcome.resultRows.forEach((r, i) => {
    const sd = (r.survivor_diff >= 0 ? '+' : '') + r.survivor_diff;
    console.log(
      `  ${String(i + 1).padEnd(3)}${r.name.slice(0, 20).padEnd(22)}` +
        `${String(r.points).padEnd(5)}${`${r.wins}-${r.losses}-${r.draws}`.padEnd(8)}${sd}`
    );
  });
  console.log(key ? `Wrote ${outcome.resultRows.length} rows to pvp_results.` : '(preview — nothing written.)');

  // Only the real prod round (a written, non-preview round on the public
  // season, not the dev-<week> channel this same job also scores) goes to
  // the public #wrad channel — a dev-channel or dry-run post would spam
  // players with test standings.
  if (key && notifyDiscord) await postPvpResults(rideDate, outcome.resultRows);
}

async function main() {
  const key = DRY ? undefined : process.env.SUPABASE_SERVICE_ROLE_KEY;
  const now = new Date();
  const rideDate = currentRideDate(now);
  const baseSeason = seasonIdFor(rideDate);
  // Score both channels of the CURRENT week in one run: prod (`<monday>`) and
  // dev (`dev-<monday>`, the boardSeason() prefix). Each is isolated by its own
  // season_id, so this one job serves both without any channel config, and it
  // never re-scores stale past-week seasons (only this week's two candidates).
  const seasons = [baseSeason, `dev-${baseSeason}`];

  if (!DRY && !key) {
    console.log('No SUPABASE_SERVICE_ROLE_KEY set — running as a read-only preview.');
  }
  for (const seasonId of seasons) {
    await runSeason(seasonId, rideDate, now, key, seasonId === baseSeason);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
