# verify-scores — the P4 anti-cheat re-simulation (issue #81)

Replays each submitted season-best ride with the real `@wrad/core`
`simulate()` and shadow-flags rows whose claimed depth doesn't reproduce.
The sim is deterministic from `(rideDate, day, lineup, timeOfDay)`; the
client now snapshots exactly that tuple at the moment a best is set
(`BestRideSnapshot` in `persistence.ts`) and submits it, so the stored row
*is* the replayable claim. The `submit_score` RPC only overwrites
`day`/`lineup` when the new depth beats the stored one, so the stored tuple
always belongs to the best-setting submission.

## Enforcement posture: shadow-flag first (deliberate)

`verified` (added by `supabase/migrations/2026-07-20-add-score-verification.sql`)
is written but **nothing reads it yet** — flagged rows still show on the
board. Reasons:

- Zero risk to legit players while the false-positive rate is unproven.
  One season of flag data tells us whether the snapshot pipeline is airtight
  before any player-visible consequence exists.
- The upgrade cohort: rows submitted by pre-snapshot clients have no
  `rideDate` and **cannot** be verified. They stay `null` (skipped), never
  flagged. Enforcing now would either exempt them (cheaters just omit the
  snapshot — useless) or purge them (nukes every un-upgraded legit player).
  Enforcement only makes sense once the no-snapshot cohort has aged out —
  earliest at a season boundary, when everyone restarts at depth 0.

Flipping to enforcement later (owner's call, not before season data):
filter `verified=eq.false` in `fetchTop`/`fetchRank`, or tighten the RPC.
Client API doesn't change either way.

## timeOfDay: derived, bounded, accepted

The server derives `timeOfDay` from the claimed `rideHour` (noon Copenhagen
cutoff, mirroring `timeOfDayAt` in App.svelte) and ignores any client-sent
`timeOfDay` string. `rideHour` itself is client-claimed but structurally
bounded: it must land within ±1 day of `rideDate`, which must map exactly to
the claimed `day` of the claimed season. Within those bounds, "lying" about
rideHour can only select beforeNoon vs afterNoon — the same choice a player
makes legitimately by riding in the morning vs the evening. One flat team
buff either way; bounded and accepted, exactly as #81 anticipated.

## Verification rule

`resimulated depth >= claimed depth` (not `===`): underselling a ride is
not cheating, and `>=` can never flag a player whose claim is conservative.
Structural impossibilities (day/date mismatch, depth > WAVE_COUNT, malformed
date, sim crash on hostile lineup input) flag immediately without simming.

## Operating it

```
# one-time: add the shared secret
supabase secrets set VERIFY_SCORES_SECRET=<random>

# regenerate the Deno bundle after ANY core change, commit the output
node scripts/bundle-core-for-deno.mjs

# deploy (secret-guarded, so JWT verification is off)
supabase functions deploy verify-scores --no-verify-jwt

# sweep a season (season_id exactly as stored, dev- prefix included)
curl -X POST "$SUPABASE_URL/functions/v1/verify-scores" \
  -H "Authorization: Bearer $VERIFY_SCORES_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"season":"dev-2026-07-20"}'
```

Response: `{ season, checked, verified, flagged, skipped_legacy, flaggedDevices }`.
Rows are fetched `verified=is.null` only, so re-runs are incremental — and
stay sound because the migration also updates `submit_score` (same-arity
body change, no overload risk) to reset `verified` to null whenever a
submission beats the stored best: a new depth is a new claim, and the next
sweep re-checks it.

## Order of operations for going live (NOT done on this branch)

1. Apply the migration (SQL editor, live project).
2. Deploy the function + set the secret.
3. Ship the client (snapshot submissions) — dev channel first; verify a
   dev-season sweep returns `verified` for real dev scores end-to-end.
4. Let the season run; review `flagged`/`skipped_legacy` counts before any
   talk of enforcement.
