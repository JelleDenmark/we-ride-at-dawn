# Agent Kickoff — We Ride at Dawn

> ⚠ **STALE — read `CONTEXT.md` and `docs/adr/` first.** This snapshot is from 2026-07-06 (v0.5.0) and describes mechanics later replaced — e.g. "hourly ride variance" below no longer exists; the Gauntlet is now season-seeded and byte-identical all week (see ADR-0001). Kept for historical narrative only. For current terminology use `CONTEXT.md`; for current state check `git log`, open GitHub issues, and the most recent `docs/handoff-*.md`.

_Generated 2026-07-06 to brief a fresh agent picking up this project. Read this first, then `handoff.md` (living project state, more detail) and `plan.md` (full decision history) if you need deeper context._

## What this project is

**We Ride at Dawn** — a grimy dark-fantasy idle auto-battler. Build a horde of rats; it auto-rides a gauntlet every hour and hauls back scrap by how deep it pushed. Wrapped in a synchronized 7-day expedition that resets weekly (Monday 06:00 CET). Public repo: `JelleDenmark/we-ride-at-dawn`, working dir `C:\Users\jespe\WRAD`.

**Stack:** TypeScript monorepo (npm workspaces). `packages/core` = pure deterministic game logic (PRNG, seed, gauntlet, sim, shop/economy, seasons), Vitest tests + golden-log hashes. `packages/app` = Svelte 5 + PixiJS v8 (shop UI + battle replay). No game logic lives in `app`.

**User context:** works from a phone — cannot run terminal commands. You run all git/deploy/verification and report back in plain language.

## Current state: LIVE IN PRODUCTION (as of 2026-07-06)

Version **0.5.0** is live on prod, the new synchronized season (`2026-07-06`) started automatically at Monday 06:00 CET, and the leaderboard is clean and ready for real players.

- **Deploy:** two channels off one GitHub Pages site. `master` → prod at `…github.io/we-ride-at-dawn/`; `dev` branch → `…github.io/we-ride-at-dawn/dev/`. Any push auto-deploys via GitHub Actions.
- Verified serving: prod `index-DHZ62lrD.js` / 0.5.0 with the new copy ("watch the next ride", "cleared the drains"); dev `index-CG31zzae.js` / 0.5.0-dev.
- Launch-season board (`2026-07-06`) confirmed empty in Supabase.

### ⚠️ Two operational gotchas you need to know before touching deploy

1. **GitHub Pages deploy step is flaky** — "Deployment failed, try again later" is infra, not your build. Fix: `gh run rerun <id> --failed`, or a fresh push/empty commit if reruns keep failing.
2. **Never push `dev` and `master` back-to-back.** The single workflow rebuilds the *whole* site (prod-from-`master` AND dev-from-`dev`, each at branch HEAD *at run time*) with `concurrency: cancel-in-progress`. Pushing both close together can let the `dev`-triggered run deploy a *pre-merge* prod build last, silently pinning prod to stale code even though the Action reports success. This actually happened during this go-live — prod sat on 0.4.5 until a clean re-run of the master deploy caught it. **Rule: push one branch, wait for its deploy to fully finish (`gh run watch`), then push the other.** After any prod deploy, verify the live bundle hash/version yourself — don't trust a green checkmark alone.

## What shipped this session (chronological)

1. **P3 — Leaderboard UI** (`packages/app/src/leaderboard.ts`, wired into `App.svelte`): one-time themed name entry (renameable), auto-submit season-best via Supabase RPC `submit_score`, ranked top-20 panel with "you" highlight + rank line.
2. **Dev/prod board isolation:** dev builds write to `dev-<season>` so testing never pollutes the real leaderboard (`boardSeason()` helper keyed on `CHANNEL`).
3. **UI clarity pass:** fixed a false "buying will merge three into one" warning, taught the merge rule on unit cards, added relic scope tags, de-jargoned copy, clearer wave-count phrasing.
4. **Relic rule — one of each per carrier:** a rat can hold each trinket once, the horde each team relic once (kills infinite Rusted-Nail stacking and the silent duplicate-Tail-Charm no-op). Enforced in `core` (`buyRelic`/`combineAll`) with tests.
5. **Replay clarity:** reframed "watch the ride" as **"watch the next ride"** with a caption explaining it's a live preview of the horde's current build, not a replay of something past. Fixed a real bug where a backgrounded browser tab could freeze the replay via throttled timers.
6. **Hourly ride variance + ride log:** `generateGauntlet(date, day, hour)` reshuffles wave composition per hour under a **fixed daily theme** (shuffle-only — same budgets/archetype quotas, ~±1–2 wave swing, scout report stays truthful all day). Income loop now simulates each elapsed hour individually. New **ride log** (last 24 rides: time·depth·scrap) shown in the idle panel. **Season-best now only counts completed rides** (the live preview no longer counts) — closes a "credit for a ride that never happened" gap and sets up P4 anti-cheat (best ride's hour is stored and sent in the score payload).
7. **"Wiped" de-emphasis:** removed the near-universal "☠ wiped" tag from ride-log rows (riding to the last rat is normal, not a failure); only a full 12-wave clear now gets a gold "⚑ cleared the drains!" badge.
8. **Go-live:** merged `dev` → `master`, bumped to 0.5.0, caught and fixed the deploy-race bug above, verified prod is genuinely serving the new build and the launch board is clean.

All core-package changes are covered by Vitest tests (61 passing as of this session); `npm run build` is clean on `packages/app`.

## What's next (in priority order)

1. **P4 — Anti-cheat re-simulation** (deferred, not started). A Supabase Edge Function should re-run `core`'s deterministic sim against the submitted `(seasonId, day, rideHour, lineup)` and reject/flag scores that don't match the claimed depth. The score payload already carries `rideHour` for this.
2. **Tap-a-log-row-to-replay** (deferred from the ride-log work). Would need each ride-log entry to store its lineup snapshot, not just the outcome.
3. **Open tuning knobs** (untested guesses, flagged repeatedly, never resolved): idle income rate, difficulty/board-cap/scrap curves, whether "deepest depth" needs a tiebreak for the leaderboard. Use `npm run balance` (in `packages/core`) plus real telemetry once players are active.
4. **Friend groups** for the leaderboard (global board ships first; sync weeks already support this without further changes).
5. **Watch the real leaderboard** now that it's live — is anyone playing, are scores coming in sanely, does Rusted Nail (now capped at one copy) still dominate over Glass Shard in practice?

## Key reference points

- Full decision log and milestone history: `plan.md`
- Original design spec: `we-ride-at-dawn-spec.md`
- Living project state (keep this updated as you work): `handoff.md`
- Supabase project: `wvrllhiktnkvbpclmrpq` — table `public.scores` (season_id, device_id, name, depth, day, lineup jsonb, updated_at), public-read RLS, writes only via the `submit_score` RPC.
- URLs: prod `https://jelledenmark.github.io/we-ride-at-dawn/`, dev `https://jelledenmark.github.io/we-ride-at-dawn/dev/`, press kit `https://jelledenmark.github.io/we-ride-at-dawn/promo/`.

## How to start

Read `handoff.md` for the fullest current picture, confirm current `git status`/branch, and check in with the user about which of the "what's next" items to tackle — they typically direct priority interactively rather than expecting a fixed roadmap to be executed unprompted.
