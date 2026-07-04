# We Ride at Dawn — Build Plan

Companion to [we-ride-at-dawn-spec.md](we-ride-at-dawn-spec.md). Records the decisions made in planning (2026-07-03) and the concrete structure and milestones. The spec describes the game; this file describes how we build it.

---

## 1. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Platform** | Browser game / PWA | Core loop needs no server or device features; sharing via URL is the growth loop (Wordle model); instant deploys suit heavy balance tuning; Capacitor wrap remains possible later. |
| **Language** | TypeScript everywhere | `core` runs in browser, in Vitest, and later unchanged in Node for server-side anti-cheat re-simulation. |
| **UI framework** | Svelte (+ Vite) | Minimal boilerplate, small bundles, good fit for a lightweight game shell. |
| **Replay rendering** | PixiJS canvas | The shop is plain reactive UI; only the replay needs a game canvas. No full game engine. |
| **Dawn reveal** | Ride into the unknown | You build day N against a **scout report** (archetype-level hints about tomorrow's gauntlet); at dawn the locked horde meets a gauntlet nobody has seen. Real morning discovery; the game is "build robust under scouted uncertainty," not "solve a known puzzle." Scout report detail level is a design lever to develop during tuning. |
| **Test Ride** | Pinned — post-MVP (2026-07-03) | When it lands, it rehearses against **practice gauntlets** sampled from the scout report's archetype constraints (different seeds), never the real one — no info leak by construction. MVP ships without it: you read the scout report, build, and wait for dawn. |
| **Wave health** | Damage carries over between waves | Attrition fits the starving-horde fantasy; gauntlet curve can ramp gently. Balance watch: Bone-Priest and Fat Tick get stronger under attrition. |
| **Daily reset** | Fixed 06:00 CET | Simple, predictable, offline-computable. "Dawn" is flavor, not astronomy. |
| **Share card (v0)** | Emoji/text grid | Wordle-style paste-anywhere text ("🐀 WRAD #37 — Wave 12"). Image card is a possible fast-follow. |
| **Sequencing** | Thin visual slice first | Milestone 1 is a watchable battle in the browser, not a headless library. Determinism tests ride along from day one. |
| **Sim authority (v1 social)** | Deferred | No backend in MVP. Default when it comes: server re-simulation using the same TS `core`. |
| **Run telemetry** *(2026-07-03)* | Supabase (free tier) | Anonymous balance telemetry: each ride POSTs `(ride_date, device_id, lineup, waves_cleared, score, dev, version)` to a `runs` table via the public anon key (insert-only under RLS). Dev rides (date picker / +10 scrap) are flagged. Opt-out toggle in the app; random UUID device id, no accounts. Scores can be re-verified by re-simulation (same anti-cheat muscle as the future leaderboard). |
| **Economy escalation** | Deferred — start flat | Fixed daily scrap budget for MVP; growing budget is a tunable later. |

### The daily loop (revised for "ride into the unknown")

- **At dawn (06:00 CET) of day N:** day N's gauntlet is revealed; the lineup you locked during day N-1 auto-resolves against it (lazily, on next app open). You watch the replay, get your score, share it.
- **During day N:** you build/rebuild the horde for **day N+1**, guided by a **scout report** for N+1 (e.g. "plague-ridden waves; heavy armor from wave 4").
- **New player on day one:** builds with the scout report; the first real result arrives next dawn. The wait *is* the hook. (Practice rides — the pinned Test Ride feature — will soften the first-day wait when they land post-MVP.)

**Honesty caveat (accepted for MVP):** the gauntlet is still a pure function of the date, so a determined player could compute tomorrow's gauntlet locally — the app just doesn't show it. Fine at friends-scale. If real leaderboards arrive, switch to a server-published daily seed (secret + date), which slots in without touching the sim.

## 2. Repository structure

Monorepo (npm workspaces), two packages mirroring the spec's `core`/`app` split:

```
wrad/
├── package.json               # workspaces: packages/*
├── packages/
│   ├── core/                  # pure TS, zero runtime deps, no DOM access
│   │   ├── src/
│   │   │   ├── prng.ts        # seeded PRNG (xorshift128 / PCG) — the only randomness source
│   │   │   ├── seed.ts        # dailySeed(YYYY-MM-DD) via FNV-1a; 06:00 CET day boundary
│   │   │   ├── data/          # units, relics, abilities as data tables (spec §5.4)
│   │   │   ├── gauntlet.ts    # seed → escalating enemy waves (spec §5.1)
│   │   │   ├── shop.ts        # buy/sell/reroll/freeze/combine + scrap (spec §5.3)
│   │   │   ├── sim.ts         # simulate(lineup, gauntlet, seed) → event log + result (spec §5.2)
│   │   │   └── score.ts       # spec §5.5
│   │   └── test/              # Vitest; determinism tests are first-class
│   └── app/                   # Vite + Svelte + PixiJS
│       ├── src/
│       │   ├── shop/          # deckbuilder screen (Svelte)
│       │   ├── replay/        # PixiJS renderer animating the event log — no game logic
│       │   ├── share.ts       # emoji score card + Web Share API
│       │   └── persistence.ts # localStorage/IndexedDB keyed by date; storage.persist()
│       └── public/            # PWA manifest, service worker, icons
```

**Load-bearing rules:**
- `core` never imports from `app`; `app` never computes game logic.
- All randomness in the sim flows through the seeded PRNG in fixed consumption order — no `Math.random`, no wall clock, no object-key iteration order.
- The replay player consumes the event log only; it must be able to render any battle it has never simulated.

## 2.5 Environments (added 2026-07-03)

One repo, one GitHub Pages site, two channels:

| | prod | dev |
|---|---|---|
| Branch | `master` | `dev` |
| URL | `…github.io/we-ride-at-dawn/` | `…github.io/we-ride-at-dawn/dev/` |
| Testing toolbar | hidden | visible |
| localStorage | `wrad-build:*` | `wrad-build-dev:*` (no collisions on the shared origin) |
| Telemetry | real balance data | always flagged `dev`, version suffixed `-dev` |

The deploy workflow builds both branches on every push to either and assembles prod at the site root with dev under `/dev/`. Channel is baked at build time via `VITE_CHANNEL` (anything not `prod` — including local `npm run dev` — behaves as dev). Flow: changes land on `dev` → tested at the /dev/ URL → merged to `master` for players. A scheduled keep-alive workflow pings Supabase twice weekly so the free-tier project never pauses.

## 2.6 Expedition model — the core loop (designed 2026-07-04, v1 built on dev 2026-07-04)

**Built (v1, dev):** horde persists across a 7-day expedition (`advanceAfterDawn` carries roster/tiers/relics with a fresh shop + scrap each dawn); board cap grows 5→8 (`boardCapForDay`); gauntlet difficulty scales with the day (`difficultyForDay`, theme unchanged); after day 7 a fresh expedition begins. **Deviation from below:** currently a *rolling personal* expedition (day 1 = whenever you start), not synchronized weekly — chosen because there's no leaderboard yet and it lets a solo tester feel the whole arc. Switch to synchronized weeks when the leaderboard lands. **Not yet:** weekly leaderboard, expedition-complete summary screen, tuning of the difficulty/cap/scrap curves.



A day is the atom; a **week-long expedition** is the molecule. Same shop/scout/ride mechanics as a single day, plus three things layered on top: the horde **persists**, the board cap **grows**, and the gauntlet **escalates** across the seven days. This reconciles the two pillars that fight in a single day — each day stays *starving* (small scrap stipend, hard choices) while the *army* compounds into the deep, unique horde the "a lot of rats" pillar promises.

- **Synchronized weekly seasons.** Everyone starts a fresh horde Monday, faces the same 7 escalating daily gauntlets, leaderboard = cumulative depth, wiped Sunday. Synchronized (not rolling-per-player) preserves the shared puzzle + comparable leaderboard; the weekly wipe is what keeps power carryover *fair* (snowball resets every 7 days).
- **What carries between days:** roster, tiers, relics. Rats **heal to full** each dawn (only the building persists, not battle damage).
- **Board cap grows** across the week (e.g. 5 → 8) — the lever that delivers the horde-size payoff.
- **Daily scrap = equal stipend** for everyone. Deliberately *not* score-based (would snowball the leader out of reach within the week).
  - *Future tunable (not now):* +1 scrap per depth reached, as a mild performance reward. Parked at Jesper's request 2026-07-04.
- **Shop rerolls are already equal across players** and stay that way: offerings are `rollOfferings(date, rollNumber)`, a pure seeded function, so everyone who rerolls N times walks the same N+1 shops. Freezing lets players diverge by *choice*, not luck. In the expedition, seed per expedition-day.
- **Latecomers:** play the single-day "quick ride" (the current loop) until Sunday, then join Monday's fresh season with everyone. The single-day loop becomes onboarding/practice, not throwaway.
- **New work vs. reuse:** shop/scout/sim/replay all reused unchanged. New: multi-day expedition persistence (will want the Supabase backend for cross-device horde state — already provisioned), the escalation curve, growing board cap, weekly-season leaderboard. Supersedes the old milestone 5 "daily loop."

## 3. Milestones

1. ✅ *(2026-07-03)* **Walking skeleton (the early view).** `core`: PRNG, dailySeed, data tables for ~3 units, minimal sim (attack ticks, deaths, one `onFaint` trigger). `app`: static page, hardcoded lineup vs wave 1 of today's real seeded gauntlet, rendered as labeled rectangles sliding into each other with damage numbers. Determinism test: same input ⇒ byte-identical event log. *Everything downstream is filling in, not re-plumbing.*
2. ✅ *(2026-07-03)* **Full sim.** All 10 units / 6 relics, all trigger types, wave carry-over with persistent damage, poison, summons, revive. Golden-log regression tests + cross-run determinism tests.
3. ✅ *(2026-07-03)* **Gauntlet generator + scouting.** Budgeted escalating waves from the daily seed, with waves tagged by archetype; scout-report extraction (archetype summary of a gauntlet). Sanity tests: monotonic difficulty, deterministic across runs, scout report consistent with the real gauntlet.
4. ✅ *(2026-07-03)* **Shop.** Headless `core` economy first (tested), then the Svelte deckbuilder screen: buy/sell/reroll/freeze, three-of-a-kind combine, drag-to-reposition.
4.5 *(added 2026-07-03)* **Testing mode.** The milestone-4 "build today, ride now" loop is kept deliberately as the testing/practice mode — the dawn loop is on hold until the core game is tuned. Adds: a dev date picker (ride any date's theme), replay speed control (1×/2×/4× + skip to result), and a headless balance report (batch-simulate archetype lineups across many dates, print depth distributions). When milestone 5 lands, this mode becomes the player-facing practice ride (the pinned Test Ride, arrived early).

5. 🔨 *(single-day loop built on dev 2026-07-04)* **The daily loop.** Build for the next dawn; `build.date` = target ride date. A reactive effect resolves the locked horde against its gauntlet when its 06:00 CET dawn passes (on load or live while open), stores it as the last dawn ride, and starts a fresh build. Idle screen: muster line + live countdown + labeled practice ride (vs today's *revealed* gauntlet, doesn't count, never tomorrow's) + last-dawn result with watch-replay. Dev has a "simulate dawn" button to advance the loop without waiting. Persistence = pending + lastRide, channel-namespaced. **Still to do:** the expedition wrapper (multi-day carry-over, growing board cap, escalation, weekly leaderboard) per §2.6 — this single day is its atom.
6. **Ship it.** Emoji share card, PWA manifest + install prompt, deploy to static hosting. Play it with friends; start the balance-tuning loop.

## 3.5 Teaching the rats (designed 2026-07-03, not yet built)

Three layers of progressive disclosure, all app-layer:
1. ✅ *(2026-07-04)* **Tap-to-inspect card** — bottom-sheet for shop stalls and board rats: portrait, stats incl. ★2/★3 preview, ability as a generated plain-English sentence. Buy/pin and sell/reposition live inside the card; tapping no longer instant-buys (accidental-buy fixed). Unit sprites also shown on the tiles. *(Not yet: archetype/role badge, enemy inspect — deferred to the Codex.)*
2. **Warren Codex** — bestiary screen (rats by strategy archetype, relics, defenders by their archetypes). Scout-report chips deep-link into it, making the report a strategic instrument. Build second.
3. **Replay callouts** — ability procs named in float text; one-time-per-device mechanic explainers (poison, revive, combine). Build third.
Explicitly rejected: tutorial flows, stat tables, hover tooltips (mobile-first).

## 4. Later / explicitly out of MVP

- **Test Ride / practice rides (pinned 2026-07-03):** rehearsal battles against practice gauntlets sampled from the scouted archetypes. First post-MVP candidate — softens the new-player first-day wait.
- Backend + friends leaderboard (server re-simulates lineups with the same `core` for anti-cheat).
- Capacitor wrap for app stores, if the browser version proves the loop.
- Web push at dawn ("The horde rides") — works on Android; iOS requires installed PWA.
- Image share card, art pass, sound, meta-progression, monetization.
