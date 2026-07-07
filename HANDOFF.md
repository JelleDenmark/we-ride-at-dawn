# We Ride at Dawn — Handoff Summary

_Last updated **2026-07-07**. **Prod is live on v0.6.0.** Companion docs: **`ROADMAP.md`** (future ideas backlog — read this for what's next), `plan.md` (full decision/milestone history), `we-ride-at-dawn-spec.md` (original spec), `PATCH-0.6.0.md` (the 0.6.0 patch rundown). Deeper background + operational gotchas live in Claude Code memory._

## What it is
A grimy dark-fantasy **idle auto-battler**. Build a horde of rats; it auto-rides a gauntlet every hour and hauls back scrap by how deep it pushed. Spend scrap to grow the horde, or leave it running. Wrapped in a **synchronized 7-day expedition** that resets weekly (Monday 06:00 CET); a global leaderboard ranks by **deepest wave reached that week**.

## Stack & ops
- **Monorepo (npm workspaces), TypeScript.** `packages/core` = pure deterministic game logic (PRNG, seed, gauntlet, sim, shop/economy, seasons) with **65 Vitest tests** + golden-log hashes. `packages/app` = Svelte 5 + PixiJS v8 (shop UI + battle replay). **No game logic lives in `app`.**
- **Repo:** GitHub `JelleDenmark/we-ride-at-dawn` (public). Develop on `dev`, ship by fast-forwarding `master`.
- **Deploy:** two channels off one GitHub Pages site. `master` → **prod** at `…github.io/we-ride-at-dawn/`; `dev` branch → **`/dev/`**. Any push auto-deploys via Actions. Version string lives in `packages/app/src/telemetry.ts` (`APP_VERSION`); `-dev` suffix is added for the dev channel via `VITE_CHANNEL`.
- **⚠ Deploy race — never push `dev` and `master` back-to-back.** The one workflow rebuilds the *whole* site (prod-from-`master` **and** dev-from-`dev`, each at its branch HEAD *at run time*) with `concurrency: cancel-in-progress`. Push one branch, **watch its deploy fully finish (`gh run watch`)**, then push the other. After any prod deploy, **verify the served bundle hash + version yourself** — a green check alone is not proof. (Bit us at 0.5.0 go-live; prod stuck on 0.4.5 until a clean rerun.)
- **⚠ GitHub Pages deploy step is flaky** ("Deployment failed, try again later" = infra, not our build). Fix: `gh run rerun <id> --failed`, or an empty commit.
- **⚠ Supabase RPC arity gotcha** (bit us on the 0.6.0 kills migration — see Leaderboard backend below and the `supabase-rpc-arity-gotcha` memory).
- **User works from a phone — I (Claude) run all git/deploy/verification/SQL.** Don't ask them to run terminal commands. (When a SQL migration needs the Supabase dashboard, hand them the exact statements to paste.)
- **Dev-only testing toolbar** (on `/dev/`): `⏩ +6h income`, `⏭ next day` (crosses week boundaries), `+10 scrap`, `fresh build`, theme readout, speed 1×/2×/4×, `skip`.
- **Analysis tools:** `npm run balance` (strategy depth report), `npm run balance:depth` (per-expedition-day achievable-depth curve + relic on/off deltas), `packages/core/scripts/economy.ts` (idle-creep sim).

## Live game — the 0.6.0 core loop
- Horde rides **hourly** → **+1 scrap per depth** cleared (`SCRAP_PER_DEPTH = 1`). Income accrues live + offline (≤24h per visit, `OFFLINE_RIDE_CAP`). Depth/income update live as you build.
- **Hourly variance (shuffle-only):** each ride reshuffles wave composition under the fixed **daily theme** (`generateGauntlet(date, day, hour)`; hourless calls stay byte-identical for golden logs). Same budgets/archetype quotas, ~±1–2 wave swing; the scout report stays truthful all day.
- **Ride log** (last 24 rides: time · depth · **N felled** · scrap, ★ on the season-best row, ⚑ badge on a full clear). Shown in the idle panel.
- **Season best = completed rides only** (the "watch the next ride" preview does not count). The best ride's hour is stored and sent as `rideHour` inside the lineup jsonb for future anti-cheat re-sim.
- **"Rats felled this week"** (`seasonKills`): cumulative enemies defeated across completed rides, climbs all week, resets Monday. Shown in the idle panel + per ride-log row + leaderboard rows. It's the **leaderboard tiebreak** behind depth.
- **7-day expedition:** board cap grows **5→8** across the week, scrap carries across days, full reset after day 7 / at the Monday season boundary.
- **Replay** ("▶ watch the next ride"): a live preview of the current build. **All players** now get **1×/2×/4× speed** controls + a **"⏭ to final wave"** button (fast-forwards to the last wave, then plays it at normal speed) — previously dev-only.
- **3 promo infographics** at `…/we-ride-at-dawn/promo/` (gameplay, minions/relics, economy) + gallery.

## Combat & balance model (0.6.0 — the big rework this release)
- **Front-clash sim:** the frontmost horde unit trades simultaneous damage with the frontmost enemy; **overkill past a kill is discarded** (unless a cleave relic carries it). No back-row targeting; AoE only via specific relics/abilities.
- **Depth ceiling raised 12 → 45** (`WAVE_COUNT`). It's an aspirational horizon — strong play reaches ~10–16, nobody's near 45.
- **Difficulty scales by WAVE DEPTH, not by day.** Enemy stats scale on wave index `w` at instantiation in `sim.ts`: health `×(1 + 0.35·w + 0.012·w²)`, attack `×(1 + 0.08·w)` — so deep foes are **HP sponges** and attack finally matters. **Day-scaling was removed** (`difficultyForDay` returns **1**); the wave-budget quadratic was cut `0.15 → 0.05`. Per-day achievable depth is **monotonic ~4 (day 1) → ~12 (day 7), peaking day 7** — you go deeper because your roster grew, not because early days were easier. This was a deliberate fix so there's **no "peak mid-week and coast"** incentive (the leaderboard metric is max depth over the whole week).
- **Gore-Cleaver relic** (unit, cost 5, `cleaveOverkill`): a killing blow carries its overkill to the next foe (single target, no chaining). It's the lever that makes attack scale against the HP-sponge curve — but it's **back-loaded** (weak early, ~17× Rusted Nail's depth delta but still modest in absolute terms, ~+0.25 waves at day 7). Making attack *punchier* (an execute / on-kill relic) is a roadmap item.
- **New tanky enemy:** Sluice-Bulwark (atk 2 / hp 16, armored). No SVG art yet (falls back to a rect in replay).
- **Relics — one of each per carrier:** a rat carries each trinket once, the horde each team relic once; merges pool trinkets but dedupe. Kills degenerate Rusted-Nail stacking and no-op duplicate Tail-Charm while keeping combos.
- **Poison note:** poison is flat-per-tick and depth-independent, so it scales *relatively* better as foes get tankier — a one-off sim showed it did **not** dominate attack builds, but it hasn't had a broad roster sweep (watch it).

## Economy & shop
- **Costs are ~2× a baseline; starting scrap 24** (`DAILY_SCRAP`). Cheapest units cost 2–6, so a fresh player can recruit ~4–6 rats immediately (a first-run hint now says so).
- **Interest:** paid **daily at dawn**, 5% of bank, floored, **capped at +5** (`INTEREST_RATE 0.05`, `INTEREST_CAP 5`). **⚠ Likely near-vestigial now** that depth 10+ (≈10+ scrap/hour) is easy — flagged to re-examine next sim run (see `wrad-interest-tuning` memory + ROADMAP economy notes).
- **Shop:** 4 unit slots + 2 relic slots (`rollOfferings`, deterministic per date/roll). **Reroll costs 1 scrap**; **freeze** holds a stall **through a reroll only** (it resets every dawn — the copy now honestly says "keeps a stall when you reroll", not "for later").
- **Owned team relics are excluded from the shop** (0.6.0 fix): a team relic can only be held once, so `rollOfferings` filters owned ones and buying one clears any sibling stall — no more dead unbuyable Filth-Totem slot. Unit relics still reappear (a second copy can go on another rat).
- **Board cap** grows 5→8 across the week (`BOARD_CAP = 8` hard max, incl. summons). **Summons stop when the board is full** — so a second summoner (e.g. two Rat-Pipers) can be starved once the board caps out; there's now a clarity hint on summoner cards ("summons pause when your warren is full (8)"). A proper summon-build rework is a roadmap item.

## Leaderboard & Supabase backend
- **Project `wvrllhiktnkvbpclmrpq`**, URL `https://wvrllhiktnkvbpclmrpq.supabase.co`. Publishable key in `packages/app/src/telemetry.ts` (`sb_publishable_6S2kGgYAI2gRLhfRxXBY3A_E_mIgpAi`).
- **Table `public.scores`** — `(season_id, device_id, name, depth, day, lineup jsonb, kills bigint, updated_at)`, PK `(season_id, device_id)`, **public-read** RLS. Writes only via the `submit_score` RPC.
- **RPC `submit_score(p_season, p_device, p_name, p_depth, p_day, p_lineup, p_kills default 0)`** — security-definer upsert: keeps best depth (`greatest`), keeps `greatest(kills)` (monotonic season total), sanitizes name (`left(coalesce(nullif(p_name,''),'Warlord'),24)`), clamps `greatest(p_depth,0)`. Granted to `anon`.
- **⚠ RPC arity bug (fixed 2026-07-07):** the kills migration added `p_kills` (6→7 args), and `CREATE OR REPLACE` with a new arity **creates a second overload** instead of replacing. 6-arg (pre-0.6.0) callers then matched both → PostgREST `300 PGRST203` → **prod submits failed silently, freezing the board 2026-07-06→07**. Fixed by dropping the old 6-arg function (`drop function if exists public.submit_score(text, uuid, text, integer, integer, jsonb);`). Migration file corrected; both 6- and 7-arg calls verified → 204. **Lesson (memory `supabase-rpc-arity-gotcha`): after any RPC signature change, drop the old signature and verify a 204 for every deployed client's arg shape.**
- **Client (`packages/app/src/leaderboard.ts`):** `submitScore` sends `p_kills`; `fetchTop` orders `depth.desc,kills.desc,updated_at.asc`; `fetchRank` counts riders strictly deeper **or** tied-depth-more-kills (`or=(depth.gt.X,and(depth.eq.X,kills.gt.Y))`). Board refreshes on mount, every 60s, on submit, and via the ↻ button.
- **Channel isolation:** the table is shared, so dev writes/reads a **`dev-`-prefixed season** (`boardSeason()` keyed on `CHANNEL`); prod uses the bare `<monday>`. Prod board stays clean.
- **Player identity:** one-time themed name (e.g. "Gutter-Warlord"), renameable, keyed by the anonymous **device UUID** (from telemetry). Names may collide harmlessly. Portable identity (magic-link/recovery code) is a roadmap prerequisite for friend groups/streaks.

## Deploy state (as of 2026-07-07)
- **Prod: v0.6.0**, verified serving `index-RbDxdpOe.js` (byte-identical to a local prod-channel build) with version marker `0.6.0`.
- **Dev: v0.6.0-dev.**
- `master` = the full 0.6.0 batch (`8da39d3`). `origin/dev` trails local `dev` by a doc-only commit (the migration-record fix) — safe to sync when convenient.
- **This week's board is mixed-curve:** 0.6.0 shipped mid-week (2026-07-07), so pre-existing depth-4/5 scores (old 12-wave curve) sit beside new depth-scaled rides; it self-normalizes as players ride and **fully resets clean next Monday**. (For future balance changes, prefer shipping at the Monday reset.)

## What's next
**See `ROADMAP.md` for the full forward backlog** — an overnight 5-agent Opus design panel across: new archetypes & minions (incl. a poison-immune `warded` line), relics/combat-systems/meta-progression (Gore-Cleaver shipped; execute/on-kill next, all-time board, damage-type RPS), seasons & weekly anomalies (`anomalyFor(seasonId)` with a depth-neutral/distorting fairness firewall), easter eggs & lore (Rat King, 45-clear payoff, world bible), and retention/social/growth (**share card + celebrated PB**, PWA install + push, onboarding, friend groups). It leads with a synthesized **Now / Next / Later** priority view.

**Immediate open items (tuning + gaps):**
1. **Interest** — likely negligible now; re-test next sim (`wrad-interest-tuning` memory).
2. **Attack punchiness** — Gore-Cleaver is back-loaded; consider an execute/on-kill relic so attack feels impactful earlier.
3. **Poison** — passed a single check, not a broad sweep; watch for dominance.
4. **Summon-build rework** — board cap starves a 2nd summoner; clarity hint shipped, real fix pending.
5. **P4 anti-cheat (deferred):** a Supabase Edge Function re-runs `core` to validate submitted depth against `(seasonId, day, rideHour, lineup)`. Note: the cumulative `kills` total can't be re-simulated from one ride — validate depth per ride, and consider bounding per-submission kill jumps.
6. **Friend groups** — global board ships first; sync weeks already support it (gate behind portable identity).
7. **Housekeeping:** two throwaway diagnostic rows may linger under season `diag-overload-2026-07-07` (`delete from scores where season_id = 'diag-overload-2026-07-07';`).

## URLs
- Play (prod): https://jelledenmark.github.io/we-ride-at-dawn/
- Dev/testing: https://jelledenmark.github.io/we-ride-at-dawn/dev/
- Press kit: https://jelledenmark.github.io/we-ride-at-dawn/promo/
