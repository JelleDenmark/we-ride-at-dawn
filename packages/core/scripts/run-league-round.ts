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
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run pvp:round -- --dry   # preview
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run pvp:round            # for real
 *
 * The service-role key is required to WRITE (pvp_rounds / pvp_results have no
 * anon write policy) and, since device_id was hidden, to READ the boards too —
 * anon no longer has select on `pvp_boards`. So the key is needed for both
 * modes; `--dry` still writes nothing. In CI it comes from the
 * SUPABASE_SERVICE_ROLE_KEY repo secret.
 *
 * A real (non-dry, non-preview) round on the public season also posts the
 * standings to the #wrad Discord channel (issue #162, lib/discord-post.ts) —
 * needs a DISCORD_BOT_TOKEN repo secret; without it that post is skipped, same
 * degrade-not-fail shape as the missing service-role key above.
 */
import { currentRideDate } from '../src/seed';
import { seasonIdFor, weekdayFor } from '../src/shop';
import { winPointsForDay } from '../src/pvp';
import { roundAlreadyClosed, runNightlyRound } from './lib/pvp-league';
import { postPvpResults } from './lib/discord-post';

const DRY = process.argv.slice(2).some((a) => a === '--dry' || a === 'dry');

async function runSeason(
  seasonId: string,
  rideDate: string,
  now: Date,
  key: string | undefined,
  notifyDiscord: boolean,
  readKey: string | undefined
) {
  const roundId = `${seasonId}#${rideDate}`;
  console.log(`\n=== round ${roundId}${DRY ? '  (DRY RUN)' : ''} ===`);

  // Idempotency guard: a backup schedule trigger or a stray re-dispatch can
  // land after this round already closed. Only the first trigger to close a
  // round should score/post — re-running would re-fetch (possibly drifted)
  // boards and double-post to Discord. --dry still previews regardless, since
  // it can't write or post either way.
  if (!DRY && (await roundAlreadyClosed(roundId))) {
    console.log('Already scored and closed by an earlier trigger — skipping.');
    return;
  }

  const outcome = await runNightlyRound(seasonId, roundId, now, key, readKey);
  console.log(`Fetched boards, ${outcome.dropped.length} dropped as illegal.`);
  for (const d of outcome.dropped) console.log(`  - ${d.name} (${d.device_id})`);

  if (outcome.skipped) {
    console.log(`Only ${outcome.scored} legal board(s) — need 2 to score. Nothing written.`);
    return;
  }

  const winPoints = winPointsForDay(weekdayFor(rideDate));
  console.log(`Standings (points: win ${winPoints} / draw 1 / loss 0; survivor_diff breaks ties):`);
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
  // Two keys, one secret. `readKey` fetches boards (anon lost select on
  // pvp_boards when device_id was hidden); `key` authorises the WRITES and is
  // withheld on --dry, which is what still makes a dry run a preview.
  const readKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = DRY ? undefined : readKey;
  const now = new Date();
  const rideDate = currentRideDate(now);
  const baseSeason = seasonIdFor(rideDate);
  // Score both channels of the CURRENT week in one run: prod (`<monday>`) and
  // dev (`dev-<monday>`, the boardSeason() prefix). Each is isolated by its own
  // season_id, so this one job serves both without any channel config, and it
  // never re-scores stale past-week seasons (only this week's two candidates).
  const seasons = [baseSeason, `dev-${baseSeason}`];

  if (!readKey) {
    console.log(
      'No SUPABASE_SERVICE_ROLE_KEY set — boards are no longer anon-readable, so the fetch will fail.'
    );
  }
  for (const seasonId of seasons) {
    await runSeason(seasonId, rideDate, now, key, seasonId === baseSeason, readKey);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
