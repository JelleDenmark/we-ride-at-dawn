# PvP league migration — assumptions to double-check

NOT yet applied. File: `2026-07-30-add-pvp-league.sql`.

## ⚠️ This migration is a TAKEOVER of the pvp_* namespace (owner decision, 2026-07-30)

The retired **Rats_PvP** prototype shares this exact Supabase project
(`wvrllhiktnkvbpclmrpq`) and already created `pvp_boards` / `pvp_results` /
`pvp_rounds` + `submit_pvp_board(text,uuid,text,jsonb)`, all ROUND-keyed for
its 2-hourly format. WRAD's league is SEASON-keyed with a continuously-synced
board, so the schemas are incompatible — a first apply of the naive draft hit
`42P13: cannot change name of input parameter "p_round"`.

Owner chose to **retire the fork backend and take over pvp_***. The migration
now: (0) guarded-drops the prototype's pvp_* tables (guard = `pvp_boards` still
has a `round_id` column, so it's a no-op once WRAD's tables exist — safe to
re-run, won't drop WRAD's data), then (1–3) rebuilds them to WRAD's schema, and
drops-then-creates `submit_pvp_board` with the `p_season` signature.

**Out-of-band follow-ups (not SQL):**
- Disable `rats-cron.yml` in the **Rats_PvP** repo — it will error once these
  tables change shape.
- The deployed rats-pvp client will break (retired game — expected).
- The prototype's PvP data is discarded. That is the intent.

This note records where the draft had to infer something rather than read
it directly off an existing WRAD table, so it's easy to spot-check before
applying.

## Column types (high confidence — read directly off existing WRAD tables/code)

- `season_id text` — matches `scores`/`boss_trial_scores`. Confirmed the
  `dev-` prefix is applied client-side by `boardSeason()` in
  `packages/app/src/leaderboard.ts`; the DB column itself is just `text`,
  no schema-side handling needed.
- `device_id uuid` — matches `scores`/`boss_trial_scores` (`p_device uuid`
  in both existing RPCs). Confirmed the client generates it with
  `crypto.randomUUID()` in `deviceId()`, `packages/app/src/telemetry.ts`.
- `board jsonb` — the `Lineup` shape from `packages/core/src/data/units.ts`:
  `{ units: [{ defId, tier?, relicIds? }], teamRelicIds?, combatCap? }`.
  Confirmed by reading the type definitions directly, not inferred.
- Name default `'Warlord'`, `left(...,24)` truncation — copied verbatim
  from `submit_score`/`submit_boss_trial`. (The fork's `submit_pvp_board`
  used `'Rat'` as the default instead; WRAD's existing two RPCs both use
  `'Warlord'`, so I matched WRAD, not the fork. Worth confirming that's
  still the desired default for a PvP-specific name field.)

## Things I had to decide (please double-check)

1. **`pvp_results` column names diverge from the fork on purpose.** The
   fork's table used `score`/`margin`; your brief explicitly asked for
   `points`/`survivor_diff`, so I used those. Just flagging the rename is
   deliberate, not an oversight, in case you compare side-by-side with the
   fork's migration.

2. **`round_id` format is left undefined.** Both this migration and the
   fork's leave `round_id` as an opaque `text` primary key — nothing here
   enforces a shape like `${season_id}-2026-07-30`. Whatever seeds/advances
   rounds (a nightly-job script, not written yet) owns that convention. I
   added a `season_id` column on both `pvp_rounds` and `pvp_results` (the
   fork's version didn't have one on `pvp_rounds`) specifically so you can
   filter "this league's rounds/standings" without parsing `round_id` —
   worth confirming that's the right call vs. keeping `round_id`
   self-describing instead.

3. **`submit_pvp_board`'s "cheap sanity bounds"** are hand-picked, not
   pulled from a shared constant (SQL can't import
   `packages/core/src/sim.ts`):
   - `units` array length: 1–8 (mirrors `BOARD_CAP = 8`).
   - `teamRelicIds` array length: ≤ 8 (no real source constant — picked
     generously; there's no hard cap on team relics I could find).
   - `combatCap`: 0–20 (BOARD_CAP=8 + COMBAT_CAP_BONUS=6 = 14 is the
     current legitimate ceiling per the summon-cap rework; I gave a buffer
     to 20 so a future core-side bump doesn't need a same-day migration).
   These are deliberately loose — they reject only obviously-corrupted or
   nonsensical payloads, not anything a legitimate build could produce.
   If `BOARD_CAP`/`COMBAT_CAP_BONUS` change, revisit this bound.

4. **No FK from `pvp_results.round_id` to `pvp_rounds.round_id`.** No table
   in WRAD's existing schema uses foreign keys, so I didn't introduce the
   first one here either, even though this migration creates both tables
   together and a FK would be easy to add. Flag if you'd rather add it.

5. **`pvp_results` has no RPC** — only `pvp_boards` gets a client-facing
   `submit_pvp_board`. Results are written by the nightly job with the
   service-role key (bypasses RLS), same as the fork's `pvp_results`/
   `pvp_rounds` posture. Anon has read-only access via the public SELECT
   policy and no write path at all.

## Not addressed (explicitly out of scope per the brief)

- The nightly job itself (matchmaking, round-robin sim, scoring, Monday
  06:00 league reset, round seeding/advancing) — none of that exists yet,
  same as the fork's `advance-round.ts`/`run-round.ts` had to be written
  separately from its schema migrations.
- Full server-authoritative economy validation of submitted boards — only
  cheap shape/bounds checks, per the "cheap sanity bounds, not full
  server-authoritative economy" instruction.
