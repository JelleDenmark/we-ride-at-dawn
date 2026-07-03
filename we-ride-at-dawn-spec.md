# We Ride at Dawn — MVP Technical Spec

A handoff document for Claude Code. Describes the game, the core loop, the system contracts, and an MVP build order. Design levers that still need a decision are flagged in **Open Decisions** at the end.

---

## 1. Concept (context only)

A grimy dark-fantasy auto-battler. Beneath a dead city, warrens of rats war over scraps. Each **dawn (CET)** the whole horde "rides" — floods up through the drains, hits a gauntlet of defenders, and pours back underground. The player is the warlord: they never fight live, they spend the **day building the horde** (a Super Auto Pets–style deckbuilder shop), and at dawn the horde **auto-resolves** against that day's gauntlet. Score is based on how deep the horde pushed. Players compare scores with friends.

**Design pillars:** grimy/expendable rats, "just rats — a lot of rats" (value comes from numbers and multiplication, not hero units), a starving economy (never enough scrap), and one shared daily puzzle everyone wakes up to.

---

## 2. The Core Loop

1. **Daily reset at dawn CET.** A new challenge unlocks, identical for every player, derived deterministically from the date.
2. **Build phase (all day).** The player opens a shop: recruit rats, combine three-of-a-kind to tier up, pin relics, set marching order (front→back). They can freely re-open and edit until the next dawn. A **Test Ride** button re-runs the battle sim against a *preview* of today's gauntlet so they can tune (see §5.2 note on info-leak).
3. **Dawn resolution.** At the next dawn CET, the player's saved lineup is auto-resolved against the canonical daily seed. Produces a replay + a score.
4. **Compare.** Player watches the replay, sees their score and depth, and compares against friends.

---

## 3. Key Architectural Insight

The daily challenge is a **pure function of the date**. `seed = hash(dateString)` → deterministic gauntlet → deterministic battle. This means:

- **No server is required for the core loop.** Every client computes the same daily seed and the same gauntlet offline.
- The **battle sim must be deterministic**: same (lineup, seed) always yields the same result, bit-for-bit. This is the single most important technical property in the whole app. Everything below depends on it.
- Social/leaderboards are therefore a *separable, later* layer, not a core dependency (see §5.7).

---

## 4. Recommended Structure

Split the codebase into two layers:

- **`core` (pure logic, no UI/framework deps):** seed derivation, gauntlet generation, shop/economy, and the battle sim. Fully unit-testable, deterministic, portable. This is where most of the work and all of the correctness lives. Implement it in your client's language so it can later be reused server-side for anti-cheat re-simulation.
- **`app` (presentation):** the shop UI and the 2D replay playback. Engine-dependent — adapt to your actual stack (native Android/Compose, Unity, Godot, Flutter, etc.). The replay player is a "dumb" renderer that animates the event log the sim emits; it contains no game logic.

---

## 5. Systems

### 5.1 Daily Challenge Generation

- `dailySeed(date) = hash(YYYY-MM-DD in CET)`. Use a fixed hash (e.g. FNV-1a / xxHash) so all clients agree.
- Seed a small deterministic PRNG (xorshift128 or PCG) from it.
- **Gauntlet = an escalating sequence of enemy waves**, generated procedurally from the PRNG so no daily hand-authoring is needed. For wave `i`: `budget = base + i * growth`; spend the budget drawing enemy units from an enemy pool (deterministic draws). Waves get harder until the horde inevitably dies — depth reached is the score.
- Output: an ordered list of enemy waves (each wave = an enemy lineup). Same for everyone that day.

### 5.2 Battle Sim (the crux — specify precisely)

A **pure function**: `simulate(playerLineup, gauntlet, seed) -> BattleResult`.

Determinism rules:
- All randomness draws from the seeded PRNG in a **fixed consumption order**. No wall-clock, no unseeded RNG, no hash-map iteration order anywhere in the sim.
- Resolution model (Super Auto Pets–style, front-to-front):
  1. **Start-of-battle abilities** fire in a fixed order (by side, then by board position front→back, deterministic tiebreak).
  2. **Combat ticks:** the frontmost living unit on each side deal damage to each other **simultaneously**.
  3. Resolve deaths; fire **faint/on-death triggers** in position order; apply summons/buffs.
  4. Repeat until one side's board is empty.
  5. If the player cleared the wave, surviving units carry to the next wave (health may or may not persist — see Open Decisions); load next enemy wave; repeat from step 1.
  6. Battle ends when the horde is wiped or all waves are cleared.
- Output: an **event log** (ordered list of typed events: `attack`, `damage`, `death`, `summon`, `buff`, `poison`, `waveClear`, …) plus a `BattleResult` (waves cleared, surviving units, damage dealt). The client animates purely from the event log — it never recomputes logic.

> **Info-leak note for Test Ride:** because the sim is deterministic, a client can locally run the real daily seed and see the exact scored outcome before submitting. For an MVP this is acceptable (it's a solo puzzle). If you want the leaderboard to stay meaningful, have Test Ride show the enemy *composition* but resolve the scored dawn run with an unrevealed per-run seed, adding some variance. Flagged in Open Decisions.

### 5.3 Build / Shop System

Super Auto Pets–style, adapted to a single daily session:
- **Scrap** is the currency. MVP: a fixed daily budget (optionally growing over the day to add escalation later — start fixed).
- Actions: **buy** unit (from a shop offering of N units + M relics), **sell** (partial refund), **reroll** shop (costs scrap), **freeze** a shop slot, **combine** three identical units → tier up (bigger stats, upgraded ability), **reposition** units front↔back.
- Board cap: e.g. 5 units. Shop offering size and costs are tunable constants in `core`.
- The build persists across app sessions until dawn.

### 5.4 Units & Relics (concrete MVP set — tunable)

Keep it small but archetype-complete so the four strategies read clearly: **Breed/Swarm, Plague, Sacrifice, Bruiser/Anchor.**

Units (Attack/Health, ability):
- **Gutter Runt** 1/1 — vanilla cheap body (swarm filler).
- **Rat-Piper** 1/2 — start of battle: summon a 1/1 Pup in front.
- **Brood-Mother** 2/3 — faint: summon two 1/1 Pups.
- **Plague-Bearer** 2/2 — start of battle: apply 1 poison/turn to the frontmost enemy.
- **Blight-Witch** 3/3 — after attacking, apply 1 poison to the target it hit.
- **Gnawer** 3/1 — faint: give the rat behind it +2 attack.
- **Corpse-Glutton** 3/2 — whenever a friendly rat faints, gain +1/+1.
- **Bone-Priest** 1/4 — faint: revive the frontmost fallen ally at 1 health.
- **Warren-Warden** 2/6 — anchor; grants rats behind it +1/+1.
- **Dire-Rat** 4/5 — no ability; a stat-stick to fatten and combine into.

Relics (pinned to a unit unless noted):
- **Rusted Nail** — +2 attack.
- **Glass Shard** — first hit deals +3 damage.
- **Weeping Boil** — on faint, deal 2 damage to all enemies.
- **Fat Tick** — +1/+2; heals 1 at start of each tick.
- **Tail-Charm** — survive one otherwise-lethal hit at 1 health, once.
- **Filth Totem** (team relic) — all rats +0/+1.

Represent abilities as small data-driven triggers (`onStartOfBattle`, `onFaint`, `onAfterAttack`, `onAllyFaint`) so new units are data, not code branches.

### 5.5 Scoring

Depth-first, with a tiebreak:
- `score = wavesCleared * 100 + survivingUnitHealthAtEnd + damageDealtIntoNextWave`
- Report **depth (waves cleared)** as the headline number; use the rest as a smooth tiebreak. All weights are tunable constants.

### 5.6 Persistence (local)

Store the in-progress build (roster, scrap, shop state, frozen slots, positions) and the last resolved result. Any local store is fine (Room/SQLite/JSON on native Android). Keyed by date so a new day starts fresh.

### 5.7 Social / Leaderboard (deliberately last)

- **v0 (in MVP):** share-sheet a generated score card ("Warren rode to Wave 12 — beat that"). No backend.
- **v1 (post-MVP):** a minimal REST backend — submit `{date, lineup, score}`, fetch a friends leaderboard. Because the sim is deterministic and lives in `core`, the server can **re-simulate the submitted lineup** to validate the score (anti-cheat) instead of trusting the client.

### 5.8 Presentation / Replay

- 2D, sprite-based. The replay player consumes the event log and animates it (units sliding to clash, damage numbers, deaths, summons, poison ticks). For MVP the art bar is low — readable beats pretty. No logic here.
- Nice-to-have, cheap: a local push notification at dawn CET ("The horde rides").

---

## 6. Data Models (sketch)

```
Unit        { id, archetype, tier, attack, health, abilityId, relicIds[] }
Relic       { id, effectId, targetScope: unit|team }
Lineup      { orderedUnits: Unit[] }        // index 0 = front
EnemyWave   { orderedUnits: Unit[] }
Gauntlet    { date, seed, waves: EnemyWave[] }
ShopState   { scrap, offerings: (Unit|Relic)[], frozen: bool[], rerollCost }
BattleEvent { type, sourceIdx, targetIdx, amount, ... }
BattleResult{ wavesCleared, survivors: Unit[], damageDealt, events: BattleEvent[] }
DailyRun    { date, lineup, result, score, submitted: bool }
```

---

## 7. MVP Scope

**In:**
- Deterministic date-seeded daily gauntlet (procedural waves).
- Deterministic battle sim emitting a replay event log.
- Shop: buy/sell/reroll/freeze/combine/reposition + scrap economy.
- The ~10-unit / ~6-relic set above with data-driven triggers.
- Depth-based scoring + dawn auto-resolution + local persistence.
- Replay playback (basic 2D).
- ~~Test Ride button~~ — pinned post-MVP (2026-07-03): will rehearse against practice gauntlets sampled from scouted archetypes, never the real seed.
- Share-sheet score card.

**Out (defer):**
- Backend, accounts, real leaderboards, PvP ghosts.
- Meta-progression / unlocks between days, collection/gacha.
- Monetization, sound design, polished art, tutorial flows.
- Large rosters and balance tuning beyond "it works."

---

## 8. Suggested Build Order (for Claude Code)

1. **`core` foundation:** PRNG, `dailySeed(date)`, data models, the unit/relic/ability data tables.
2. **Battle sim** with a hard-coded test lineup vs a hard-coded wave. Write determinism tests first (same input → identical event log). This is the riskiest piece — nail it before UI.
3. **Gauntlet generator** (procedural escalating waves from seed).
4. **Shop/economy** logic in `core`, headless + tested.
5. **App shell:** shop UI wired to `core`.
6. **Replay player:** animate the event log.
7. **Dawn scheduling, persistence, scoring, Test Ride.**
8. **Share-sheet score card.**

Milestone 2 is the true make-or-break — get a deterministic, testable sim before anything visual.

---

## 9. Open Decisions — RESOLVED 2026-07-03 (see plan.md)

1. **Client stack.** ✅ Browser game / PWA. TypeScript monorepo: pure-TS `core`, Svelte + PixiJS `app`. Capacitor wrap possible later if a store release is warranted.
2. **Sim authority for v1 social.** ⏸ Deferred (no backend in MVP). Default when it comes: server re-simulation reusing the TS `core`.
3. **Test Ride info-leak.** ✅ Superseded by a loop change (2026-07-03, see plan.md): you build day N against a **scout report** for day N+1, and at dawn the locked horde meets an unseen gauntlet ("ride into the unknown"). Test Ride runs against practice gauntlets sampled from the scouted archetypes, never the real seed — the info-leak disappears by construction.
4. **Health persistence between waves.** ✅ Damage carries over. Attrition fits the horde fantasy. Balance watch: revive (Bone-Priest) and healing (Fat Tick) get stronger.
5. **Economy escalation.** ✅ Flat daily scrap budget for MVP; growing budget stays a tunable constant for later.

Additional decisions recorded in plan.md: daily reset is fixed **06:00 CET**; v0 share card is an **emoji/text grid**; build sequencing starts with a **thin visual slice** (watchable battle) rather than a fully headless core.
