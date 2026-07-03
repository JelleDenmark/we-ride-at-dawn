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

## 3. Milestones

1. ✅ *(2026-07-03)* **Walking skeleton (the early view).** `core`: PRNG, dailySeed, data tables for ~3 units, minimal sim (attack ticks, deaths, one `onFaint` trigger). `app`: static page, hardcoded lineup vs wave 1 of today's real seeded gauntlet, rendered as labeled rectangles sliding into each other with damage numbers. Determinism test: same input ⇒ byte-identical event log. *Everything downstream is filling in, not re-plumbing.*
2. ✅ *(2026-07-03)* **Full sim.** All 10 units / 6 relics, all trigger types, wave carry-over with persistent damage, poison, summons, revive. Golden-log regression tests + cross-run determinism tests.
3. ✅ *(2026-07-03)* **Gauntlet generator + scouting.** Budgeted escalating waves from the daily seed, with waves tagged by archetype; scout-report extraction (archetype summary of a gauntlet). Sanity tests: monotonic difficulty, deterministic across runs, scout report consistent with the real gauntlet.
4. ✅ *(2026-07-03)* **Shop.** Headless `core` economy first (tested), then the Svelte deckbuilder screen: buy/sell/reroll/freeze, three-of-a-kind combine, drag-to-reposition.
4.5 *(added 2026-07-03)* **Testing mode.** The milestone-4 "build today, ride now" loop is kept deliberately as the testing/practice mode — the dawn loop is on hold until the core game is tuned. Adds: a dev date picker (ride any date's theme), replay speed control (1×/2×/4× + skip to result), and a headless balance report (batch-simulate archetype lineups across many dates, print depth distributions). When milestone 5 lands, this mode becomes the player-facing practice ride (the pinned Test Ride, arrived early).

5. ⏸ *(on hold 2026-07-03, pending balance testing)* **The daily loop.** 06:00 CET boundary, persistence keyed by date, lineup lock at dawn, lazy resolution of yesterday's lineup against the newly revealed gauntlet, scout report display for tomorrow, scoring.
6. **Ship it.** Emoji share card, PWA manifest + install prompt, deploy to static hosting. Play it with friends; start the balance-tuning loop.

## 4. Later / explicitly out of MVP

- **Test Ride / practice rides (pinned 2026-07-03):** rehearsal battles against practice gauntlets sampled from the scouted archetypes. First post-MVP candidate — softens the new-player first-day wait.
- Backend + friends leaderboard (server re-simulates lineups with the same `core` for anti-cheat).
- Capacitor wrap for app stores, if the browser version proves the loop.
- Web push at dawn ("The horde rides") — works on Android; iOS requires installed PWA.
- Image share card, art pass, sound, meta-progression, monetization.
