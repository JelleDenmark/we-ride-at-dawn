# We Ride at Dawn — Handoff Summary

_Last updated 2026-07-04. Companion docs: `plan.md` (full decisions/milestones), `we-ride-at-dawn-spec.md` (original spec). Deeper background lives in Claude Code memory._

## What it is
A grimy dark-fantasy **idle auto-battler**. Build a horde of rats; it auto-rides a gauntlet every hour and hauls back scrap by how deep it pushed. Spend scrap to grow the horde, or leave it running. Wrapped in an escalating 7-day expedition that resets weekly.

## Stack & ops
- **Monorepo (npm workspaces), TypeScript.** `packages/core` = pure deterministic game logic (PRNG, seed, gauntlet, sim, shop/economy, seasons) with **54 Vitest tests** + golden-log hashes. `packages/app` = Svelte 5 + PixiJS v8 (shop UI + replay). No game logic in `app`.
- **Repo:** GitHub `JelleDenmark/we-ride-at-dawn` (public).
- **Deploy:** two channels off one GitHub Pages site. `master` → **prod** at `…github.io/we-ride-at-dawn/`; `dev` branch → **`/dev/`**. Any push auto-deploys via Actions. Develop on `dev`, merge to `master` when approved.
- **⚠ GitHub Pages deploy step is flaky** ("Deployment failed, try again later" — infra, not our build). Fix: rerun the failed job, or `gh workflow run "Deploy to GitHub Pages" --ref <branch>` for a fresh run.
- **⚠ Deploy race — never push `dev` and `master` back-to-back.** The one workflow rebuilds the *whole* site (prod-from-`master` **and** dev-from-`dev`, each at its branch HEAD *at run time*) and deploys all of it, with `concurrency: cancel-in-progress`. If you push `dev` then merge+push `master` seconds later, the dev-triggered run builds prod from the *pre-merge* master and its deploy can land last — pinning prod to the old build while dev looks fine. (Bit us at the 0.5.0 go-live; prod stuck on 0.4.5 until a clean `gh run rerun` of the master run.) **Rule:** push one branch, let its deploy fully finish, then push the other — or just re-run the master deploy after merging to be safe.
- **User works from a phone — I (Claude) run all git/deploy/verification.** Don't ask them to run terminal commands.
- **Dev-only testing toolbar** (on `/dev/`): `⏩ +6h income`, `⏭ next day` (crosses week boundaries too), `+10 scrap`, `fresh build`, speed 1×/2×/4×, `skip`.
- **Analysis tools:** `npm run balance` (strategy depth report), `packages/core/scripts/economy.ts` (idle-creep sim).

## Current core loop (SHIPPED TO PROD)
- Horde rides **hourly** → **+1 scrap per depth** cleared. Income accrues live + offline (≤24h/visit). Depth/income update live as you build.
- **Hourly variance (dev-only, 2026-07-05):** each ride's waves reshuffle under the fixed daily theme (`generateGauntlet(date, day, hour)`, hour = absolute hour bucket; hourless calls byte-identical for golden logs). Shuffle-only — same budgets/quotas, ±1–2 waves depth swing. Income loop simulates each elapsed hour; **ride log** (last 24: time·depth·scrap·survivors, ★ on the best) shown in the idle panel. **Season best = completed rides only** (preview no longer counts); best ride's hour stored + sent as `rideHour` inside the lineup jsonb for P4 re-sim.
- **Interest:** paid **daily at dawn**, 5% of bank, **floored, capped at +5** (moved off hourly after a creep sim showed hourly interest was the snowball engine).
- **Costs ×2, starting scrap 24** (early affordability unchanged; idle scrap worth ~half in units).
- **7-day expedition:** difficulty steps each dawn (`difficultyForDay`), board cap grows 5→8, scrap carries across days, full reset after day 7.
- **3 promo infographics** hosted at `…/we-ride-at-dawn/promo/` (gameplay, minions/relics, economy) + gallery `index.html`.

## Key decisions
- **Hourly ride variance: shuffle-only, completed-rides-only scoring** *(2026-07-05)* — waves reshuffle per hour under the fixed daily theme (scout report stays truthful); no budget jitter (leaderboard stays mostly skill). Weekly best counts only rides that actually ran; the setting ride's hour rides along in the score payload for anti-cheat. Ride log keeps last 24. Deferred to later: tap-a-log-row to replay that ride (needs lineup stored per row).
- **Relics: one of each per carrier** *(2026-07-05)* — a rat carries each trinket once, the horde carries each team relic once; merges pool relics but dedupe. Chosen over single-slot/2-slot caps: kills degenerate Rusted-Nail stacking and the no-op duplicate Tail-Charm while keeping combos (Nail+Shard+Charm). Enforced in `core` `buyRelic`/`combineAll` with tests.
- **Genre:** pivoted from a daily-dawn puzzle to an **idle auto-battler** (dropped the "shared daily puzzle" + "starving economy" pillars — user's call).
- **Leaderboard score = deepest depth reached during the week** (headline).
- **Synchronized weeks:** Monday 06:00 CET → Sunday. Expedition day = ISO weekday; `seasonId` = that week's Monday. **Latecomers join cold** at the current day's difficulty (empty horde), equalized by Monday reset.
- **Leaderboard scope:** global weekly board first; friend groups later.
- **Player identity:** **require a name** — one-time prompt, themed default (e.g. "Gutter-Warlord"), renameable, keyed by the existing anonymous **device UUID** (upsert best-per-device). Names may collide harmlessly.
- **Anti-cheat:** deferred (P4). Server re-simulates submitted lineups with the same `core`.

## Leaderboard build — partitioned (in progress)
- **P1 — Synchronized weekly seasons (client-only): ✅ DONE on `dev`, verified.** Core: `weekdayFor`, `seasonIdFor`, `BuildState.seasonId`. Horde + season-best reset Monday; cold-join; season-best depth tracked & persisted (`saveSeasonBest`). Reset guard compares season dates so dev fast-forward isn't undone.
- **P2 — Supabase leaderboard backend: ✅ DONE, verified.** Project `wvrllhiktnkvbpclmrpq`. Table `public.scores` (season_id, device_id, name, depth, day, lineup, updated_at; PK (season_id, device_id)) with **public read** RLS. Writes only via `submit_score(p_season, p_device, p_name, p_depth, p_day, p_lineup)` RPC (security-definer, keeps each device's best depth, granted to `anon`). Verified: RPC → 204, board read → 200. Publishable key already in `packages/app/src/telemetry.ts` (`sb_publishable_6S2kGgYAI2gRLhfRxXBY3A_E_mIgpAi`), URL `https://wvrllhiktnkvbpclmrpq.supabase.co`.
- **P3 — Leaderboard UI: ✅ DONE on `dev`, verified.** New `packages/app/src/leaderboard.ts` (submit/fetch/rank + themed-name generator; reuses telemetry's `deviceId`). App wiring in `App.svelte`: (1) one-time **name-entry modal** (themed default like "Blight-Fang", renameable via a "rename" button; rename modal has a cancel, first-run doesn't) — name stored in `wrad:name` (not channel-namespaced: same warlord on prod+dev); (2) **auto-submit** season-best via `submit_score` on any improvement (signature-guarded so unchanged scores don't re-POST; also resubmits on rename to update the displayed name); (3) **ranked top-20 panel** (GET `/rest/v1/scores?season_id=eq.<id>&order=depth.desc,updated_at.asc&limit=20`) with the player's own row highlighted ("· you"), plus a "your rank #N" line (via `content-range` count of depth>mine) when they're outside the top 20. Board refreshes on mount, every 60s, on submit, and on the manual ↻. Verified end-to-end against live Supabase: submit → row appears, rename → row updates, board renders with highlight. `npm run build` clean.
  - **Channel isolation (resolved):** the `scores` table is shared, so dev builds now ride a **`dev-`-prefixed season** (`boardSeason()` in `leaderboard.ts`, keyed off `CHANNEL`). Dev submits/reads `dev-<monday>`, prod uses the bare `<monday>`; the panel still shows the real week date. Prod board stays pristine; no schema/RPC change needed. (Prod-side validation still lands in P4.)
- **P4 — Anti-cheat re-simulation: ⬜ LATER.** Supabase Edge Function re-runs `core` sim to validate submitted depth; reject mismatches.

## Pending / next steps
1. ~~P3 leaderboard UI~~ ✅ done on `dev`.
2. **Ship to prod: ✅ LIVE 2026-07-06.** Merged `dev` → `master`; the synchronized season `2026-07-06` started Monday 06:00 CET (client-side rollover). **Prod verified serving 0.5.0** (`index-DHZ62lrD.js`; markers "cleared the drains" / "watch the next ride"), dev serving 0.5.0-dev, launch board empty. Legacy prod players cold-reset into the sync week on first visit. "Wiped" de-emphasized: log rows show time·depth·scrap, only a full 12-wave clear gets a "⚑ cleared the drains!" badge (survivors matter nowhere else — leaderboard is depth-only). *(Go-live initially failed silently — see the deploy-race warning in Stack & ops; prod was stuck on 0.4.5 until a clean rerun of the master deploy.)*
3. **P4 anti-cheat** later.
4. **Minor — clean the board before real testers.** Anon key can't delete (read-only + RPC-insert-only), so remove via SQL / service role. **Prod** seasons still hold pre-isolation test rows: `00000000-…-0009` "Test-Warlord" depth 7 and `00000000-…-0001` "Probe-Warlord" depth 3 (season `2026-06-29`); plus a dev-era row on `2026-07-06` (device `dfea602b-…`, depth 8) written before the `dev-` prefix landed. Dev QA now lives harmlessly under `dev-2026-07-06`. Wipe the bare-season rows before launch: `delete from scores where season_id not like 'dev-%';` (or target the specific device ids).
5. **Open tuning knobs** (untested guesses): idle income rate, difficulty/board/scrap curves, whether "deepest depth" needs a tiebreak. Use `npm run balance` + real telemetry.
6. **Later:** friend groups; switch nothing else — sync weeks already support it.

## URLs
- Play (prod): https://jelledenmark.github.io/we-ride-at-dawn/
- Dev/testing: https://jelledenmark.github.io/we-ride-at-dawn/dev/
- Press kit: https://jelledenmark.github.io/we-ride-at-dawn/promo/
