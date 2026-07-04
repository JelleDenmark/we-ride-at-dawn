# We Ride at Dawn — Handoff Summary

_Last updated 2026-07-04. Companion docs: `plan.md` (full decisions/milestones), `we-ride-at-dawn-spec.md` (original spec). Deeper background lives in Claude Code memory._

## What it is
A grimy dark-fantasy **idle auto-battler**. Build a horde of rats; it auto-rides a gauntlet every hour and hauls back scrap by how deep it pushed. Spend scrap to grow the horde, or leave it running. Wrapped in an escalating 7-day expedition that resets weekly.

## Stack & ops
- **Monorepo (npm workspaces), TypeScript.** `packages/core` = pure deterministic game logic (PRNG, seed, gauntlet, sim, shop/economy, seasons) with **54 Vitest tests** + golden-log hashes. `packages/app` = Svelte 5 + PixiJS v8 (shop UI + replay). No game logic in `app`.
- **Repo:** GitHub `JelleDenmark/we-ride-at-dawn` (public).
- **Deploy:** two channels off one GitHub Pages site. `master` → **prod** at `…github.io/we-ride-at-dawn/`; `dev` branch → **`/dev/`**. Any push auto-deploys via Actions. Develop on `dev`, merge to `master` when approved.
- **⚠ GitHub Pages deploy step is flaky** ("Deployment failed, try again later" — infra, not our build). Fix: rerun the failed job, or `gh workflow run "Deploy to GitHub Pages" --ref <branch>` for a fresh run.
- **User works from a phone — I (Claude) run all git/deploy/verification.** Don't ask them to run terminal commands.
- **Dev-only testing toolbar** (on `/dev/`): `⏩ +6h income`, `⏭ next day` (crosses week boundaries too), `+10 scrap`, `fresh build`, speed 1×/2×/4×, `skip`.
- **Analysis tools:** `npm run balance` (strategy depth report), `packages/core/scripts/economy.ts` (idle-creep sim).

## Current core loop (SHIPPED TO PROD)
- Horde rides **hourly** → **+1 scrap per depth** cleared. Income accrues live + offline (≤24h/visit). Depth/income update live as you build.
- **Interest:** paid **daily at dawn**, 5% of bank, **floored, capped at +5** (moved off hourly after a creep sim showed hourly interest was the snowball engine).
- **Costs ×2, starting scrap 24** (early affordability unchanged; idle scrap worth ~half in units).
- **7-day expedition:** difficulty steps each dawn (`difficultyForDay`), board cap grows 5→8, scrap carries across days, full reset after day 7.
- **3 promo infographics** hosted at `…/we-ride-at-dawn/promo/` (gameplay, minions/relics, economy) + gallery `index.html`.

## Key decisions
- **Genre:** pivoted from a daily-dawn puzzle to an **idle auto-battler** (dropped the "shared daily puzzle" + "starving economy" pillars — user's call).
- **Leaderboard score = deepest depth reached during the week** (headline).
- **Synchronized weeks:** Monday 06:00 CET → Sunday. Expedition day = ISO weekday; `seasonId` = that week's Monday. **Latecomers join cold** at the current day's difficulty (empty horde), equalized by Monday reset.
- **Leaderboard scope:** global weekly board first; friend groups later.
- **Player identity:** **require a name** — one-time prompt, themed default (e.g. "Gutter-Warlord"), renameable, keyed by the existing anonymous **device UUID** (upsert best-per-device). Names may collide harmlessly.
- **Anti-cheat:** deferred (P4). Server re-simulates submitted lineups with the same `core`.

## Leaderboard build — partitioned (in progress)
- **P1 — Synchronized weekly seasons (client-only): ✅ DONE on `dev`, verified.** Core: `weekdayFor`, `seasonIdFor`, `BuildState.seasonId`. Horde + season-best reset Monday; cold-join; season-best depth tracked & persisted (`saveSeasonBest`). Reset guard compares season dates so dev fast-forward isn't undone.
- **P2 — Supabase leaderboard backend: ✅ DONE, verified.** Project `wvrllhiktnkvbpclmrpq`. Table `public.scores` (season_id, device_id, name, depth, day, lineup, updated_at; PK (season_id, device_id)) with **public read** RLS. Writes only via `submit_score(p_season, p_device, p_name, p_depth, p_day, p_lineup)` RPC (security-definer, keeps each device's best depth, granted to `anon`). Verified: RPC → 204, board read → 200. Publishable key already in `packages/app/src/telemetry.ts` (`sb_publishable_6S2kGgYAI2gRLhfRxXBY3A_E_mIgpAi`), URL `https://wvrllhiktnkvbpclmrpq.supabase.co`.
- **P3 — Leaderboard UI: ⬜ NEXT.** Build on `dev`: (1) one-time **name entry** (themed default, renameable), (2) auto-submit season-best via `submit_score` on improvement/each dawn, (3) **ranked top-N panel** (GET `/rest/v1/scores?season_id=eq.<id>&order=depth.desc&limit=N`) with the player's own rank highlighted. Client already has URL + publishable key.
- **P4 — Anti-cheat re-simulation: ⬜ LATER.** Supabase Edge Function re-runs `core` sim to validate submitted depth; reject mismatches.

## Pending / next steps
1. **P3 leaderboard UI** (next partition) — name prompt + submit + board panel, on `dev`.
2. **Ship to prod:** P1 (sync weeks) is **dev-only**; hold prod until P3 so synchronized weeks land together with the leaderboard.
3. **P4 anti-cheat** later.
4. **Minor:** a test row exists in `scores` (device `00000000-0000-4000-8000-000000000009`, "Test-Warlord", depth 7, season `2026-06-29`) — delete via SQL if you want a clean board before testers arrive.
5. **Open tuning knobs** (untested guesses): idle income rate, difficulty/board/scrap curves, whether "deepest depth" needs a tiebreak. Use `npm run balance` + real telemetry.
6. **Later:** friend groups; switch nothing else — sync weeks already support it.

## URLs
- Play (prod): https://jelledenmark.github.io/we-ride-at-dawn/
- Dev/testing: https://jelledenmark.github.io/we-ride-at-dawn/dev/
- Press kit: https://jelledenmark.github.io/we-ride-at-dawn/promo/
