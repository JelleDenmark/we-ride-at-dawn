# We Ride at Dawn

A grimy dark-fantasy idle auto-battler. Build a horde of rats; it auto-rides a gauntlet every hour and hauls back scrap by how deep it pushed. See [`CONTEXT.md`](./CONTEXT.md) for the domain glossary (Wave, Depth, Ride, Season, Archetype, etc.) — read it before touching game logic so terminology stays consistent.

Play: `https://jelledenmark.github.io/we-ride-at-dawn/` (prod, built from `master`) · `https://jelledenmark.github.io/we-ride-at-dawn/dev/` (dev channel, built from `dev`).

## Layout

TypeScript monorepo (npm workspaces):

- **`packages/core`** — pure, deterministic game logic: PRNG/seeding, gauntlet generation, combat sim, shop/economy. No UI, no I/O. Vitest + golden-log hashes (see [`docs/adr/0001-gauntlet-difficulty-is-depth-only.md`](./docs/adr/) and `prng.ts` for why determinism here is load-bearing, not incidental).
- **`packages/app`** — Svelte 5 + PixiJS v8 (shop UI + battle replay). No game logic lives here; it calls into `core`.
- **`docs/adr/`** — architectural decisions with lasting rationale (why the Gauntlet is season-seeded, why income is decoupled from Depth, the compounding-law discipline, why Enemies share the Unit engine).
- **`docs/design/`** — forward-looking content design banks (e.g. `future-minions.md`) — concepts, not committed content.
- **`docs/agents/`** — how agent skills should consume this repo (issue tracker conventions, triage labels, domain-doc usage).
- **`docs/handoff-*.md`** — dated, single-session handoff notes for whatever was actively being worked on at that time. The live pattern for "what's the current state" — prefer the most recent one plus `git log` over the older root-level `HANDOFF.md`/`AGENT-KICKOFF.md`, which are explicitly flagged stale at their top.
- **`.claude/agents/`** — repo-specific subagents (`patch-notes`, `balance-analyst`, `content-designer`) scoped to recurring workflows in this project.

## Running things

From the repo root:

```
npm test        # core's Vitest suite
npm run dev      # app dev server (packages/app)
npm run build    # app production build
npm run balance  # strategy-archetype depth report (see below)
npm run snowball # week-long economy + unit/relic value ranking (see below)
```

## Balance & simulation scripts

All live in `packages/core/scripts/`, run via `npm run balance:<name>` from the root (or `npx tsx scripts/<file>.ts` from `packages/core` directly). Each script's own header comment is the authoritative description — this table is a discovery index, not a replacement for reading it before trusting its numbers.

| Command | Script | Answers |
|---|---|---|
| `npm run balance` | `balance.ts` | Depth reached per named strategy archetype (swarm/plague/sacrifice/bruiser/anchor) across many synthetic dates. |
| `npm run balance:depth` | `depth-scaling.ts` | The optimal hand-built roster's depth *ceiling* per expedition day — a ceiling, not a median player's experience. |
| `npm run snowball` | `snowball.ts` | The deepest tool: week-long real-economy simulation (income → shop → Depth via a greedy spend policy), unit value ranking (the tier-list generator), relic value ranking, and snowball/convergence tests. |
| `npm run balance:day-variance` | `day-to-day-variance.ts` | How much Depth swings day-to-day for a fixed Horde — the regression test for issue #41 (season-seeding fix). |
| `npm run balance:reroll-fishing` | `reroll-fishing-test.ts` | How reroll spend affects merge-fishing odds. |
| `npm run balance:stress` | `exploit-stress.ts` | Compounding-law / exploit canary sweep — see [`docs/adr/0003-compounding-law-for-repeating-triggers.md`](./docs/adr/0003-compounding-law-for-repeating-triggers.md). |
| `npm run balance:all-unit-value` | `all-unit-value.ts` | Full-roster unit cost-efficiency pass. |
| `npm run balance:relic-value` | `relic-value.ts` | Full relic cost-efficiency pass. |
| `npm run balance:dire-rat-armor` | `dire-rat-armor.ts` | Dire-Rat's flat-armor (`damageReduction`) mechanic in isolation. |
| `npm run balance:economy` | `economy.ts` | Idle scrap creep for a passive (build-once, never-spend) player, across the week. |
| `npm run balance:maxed-board-guardrail` | `maxed-board-guardrail.ts` | Ceiling check: does a maxed tier-3 board stay comfortably under `WAVE_COUNT=45`? |
| `npm run balance:slot-value` | `slot-value.ts` | Buyable board-slot pricing (issue #70) — marginal Depth value of an extra slot. |
| `npm run balance:t2-percentiles` | `t2-percentiles.ts` | Realistic strong-but-not-maxed (tier-2, partial relics) player's Depth percentile spread. |

**Before quoting any of these numbers:** confirm which branch/commit you ran them against — `master` (prod) and `dev` frequently diverge in balance-relevant ways, and the scripts don't tag their own output with a commit hash. If you need prod's numbers while your working tree is on `dev` (or vice versa), use an isolated `git worktree add ../wrad-tmp <branch>` rather than checking out the other branch into your working tree.

## Agents working in this repo

Read `CONTEXT.md` for vocabulary and `docs/adr/` for decisions before making non-trivial changes to `packages/core`. `CLAUDE.md` at the repo root lists the agent skills this project uses (issue tracker, triage labels, domain docs). For balance/tier-list questions or new-content design brainstorming, the `balance-analyst` and `content-designer` subagents in `.claude/agents/` are pre-scoped for those workflows.
