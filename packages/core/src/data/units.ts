export type Side = 'horde' | 'gauntlet';

export type Archetype = 'swarm' | 'brute' | 'armored' | 'plague';

/**
 * Tier (star-level) power multiplier applied to a unit's own base ATTACK
 * and HEALTH (issue #22). Merging costs scrap super-linearly — 3 copies ->
 * one t2, 3 t2s -> one t3, i.e. 9x the scrap of a single t1 — so a flat
 * `x tier` curve (1x/2x/3x) made merging mostly a board-space play, not a
 * power one. Each tier step is now >=3x the previous step's power: 1x / 3x
 * / 9x (`3^(tier-1)`), matching the requested factor and the actual scrap
 * spent. Applied uniformly to attack and health (Jesper, 2026-07-09): the
 * owner wants a much deeper, more rewarding late-game curve, up to and
 * including players regularly pushing `WAVE_COUNT = 45` — a full-power
 * curve on both stats is the intended lever for that, not a limitation to
 * design around. See `HANDOFF.md`'s compounding-law section before adding
 * any *new* trigger effect that scales off these bigger numbers.
 */
export function tierAttackMultiplier(tier: number): number {
  return Math.pow(3, tier - 1);
}

/** Same curve as `tierAttackMultiplier` — see its doc comment. */
export function tierHealthMultiplier(tier: number): number {
  return Math.pow(3, tier - 1);
}

/**
 * HP a Bone-Priest's `revive` returns the raised ally at, by tier (issue
 * #53). Deliberately NOT `tierHealthMultiplier` or any other flat multiplier
 * of a base value — `revive` fires exactly once per Bone-Priest instance
 * (its own `faint` trigger, which a unit only hits once), so unlike
 * per-battle-recurring effects there's no compounding risk in a steep,
 * hand-tuned curve here. A flat `health * tier` (1/2/3) made merging this
 * unit nearly pointless since the ability only ever pays out once; this
 * table (1/10/20) makes tiering up actually matter. Callers must still cap
 * the result at the revived corpse's own `maxHealth` — see the `revive`
 * case in sim.ts's `applyEffect`.
 */
export function reviveHpForTier(tier: number): number {
  const table = [1, 10, 20];
  return table[tier - 1] ?? table[table.length - 1];
}

/**
 * Number of the front rat's incoming hits Ward-Weaver's `blockFrontHits`
 * blocks per wave, by tier (issue #56). Same shape as `reviveHpForTier` — a
 * small explicit table, not a multiplier of a base value — because this
 * magnitude resets every wave (see the compounding-law note on
 * `blockCharges` in sim.ts) rather than compounding like `tierAttackMultiplier`.
 * Deliberately linear (1/2/3), not `tierAttackMultiplier`'s 3^(tier-1) curve:
 * a wave only has so many meaningful hits to block, so a steep curve here
 * would just let a t3 Ward-Weaver no-sell an entire early wave.
 */
export function blockHitsForTier(tier: number): number {
  const table = [1, 2, 3];
  return table[tier - 1] ?? table[table.length - 1];
}

/**
 * Poison stacks applied by Plague-Bearer's `poisonFrontEnemy` (`startOfWave`)
 * and Blight-Witch's `poisonAllEnemies` (`startOfWave`), by tier (issue #62,
 * folding in #59's table). Same shape as `reviveHpForTier`/`blockHitsForTier`
 * — a small explicit table, not a multiplier of a base value.
 *
 * Safe under the compounding law for the same reason as `blockHitsForTier`:
 * poison stacks reset every wave (`waveClear`), so unlike `gainStats` or any
 * other permanently-accumulating effect on a per-wave trigger, a steep
 * per-tier jump here cannot snowball across the 45-wave battle — each wave
 * starts the count fresh.
 *
 * Deliberately `[1, 3, 5]`, NOT `tierAttackMultiplier`'s full `3^(tier-1)`
 * curve (which would give 1/3/9). A full exponential jump would make poison
 * a dominant, matchup-agnostic answer regardless of enemy archetype —
 * flat, depth-independent damage that ignores armor and doesn't need to
 * out-scale enemy health the way attack does. That risk is exactly the
 * still-open question flagged in `scripts/depth-scaling.ts` report section
 * "4) Poison-leaning vs attack-leaning roster": poison's flat/depth-independent
 * nature was left as a report-only, not-yet-resolved finding, not something
 * to resolve by picking a magnitude here. `[1, 3, 5]` is a moderate,
 * hand-tuned middle ground between the old flat `stacks * tier` (1/2/3) and
 * the full exponential curve.
 */
export function poisonStacksForTier(tier: number): number {
  const table = [1, 3, 5];
  return table[tier - 1] ?? table[table.length - 1];
}

/**
 * Hard ceiling on total attack Cellar-Coil's `chargeWhileBenched` may ever
 * bank onto a single instance, over the WHOLE Ride (all `WAVE_COUNT` = 45
 * Waves), by tier (issue #106). Same shape as `reviveHpForTier`/
 * `blockHitsForTier` above — a small explicit table, NOT a multiplier of a
 * base value — but unlike either of those, this table exists specifically
 * because ADR-0003 (`docs/adr/0003-compounding-law-for-repeating-triggers.md`)
 * requires one: `chargeWhileBenched` is a *permanent* stat gain on the
 * repeating `startOfWave` Trigger, which is exactly the shape that already
 * shipped once as the Warren-Warden incident (a `startOfBattle` buff
 * mistakenly re-firing every Wave). It is only safe here because the cap is
 * a hard `Math.min` clamp baked into the effect's application (see the
 * `chargeWhileBenched` case in sim.ts's `applyEffect`), not a tunable
 * suggestion — this function is the one and only source of truth for that
 * ceiling, and nothing may bank past it no matter how many of the 45 Waves
 * the unit spends off the front slot.
 *
 * Placeholder table `[6, 12, 18]` per issue #106 / `docs/design/future-minions.md`'s
 * Cellar-Coil writeup — tune the numbers during the balance pass, but the
 * existence of a hard cap here is not up for debate.
 */
export function cellarCoilChargeCapForTier(tier: number): number {
  const table = [6, 12, 18];
  return table[tier - 1] ?? table[table.length - 1];
}

export type Effect =
  | { kind: 'summon'; unitId: string; count: number }
  /**
   * Buffs the rat(s) behind the source (or `all` of them) by
   * `attack`/`health`, scaled by `tierAttackMultiplier`/`tierHealthMultiplier`
   * (issue #58) rather than a flat `* tier` — Gnawer wires this to `faint`,
   * Warren-Warden and MD Rattyfock wire it to `startOfBattle`; both trigger
   * kinds fire exactly once per unit instance, ever, so the steeper
   * `3^(tier-1)` curve can't accumulate across the 45-wave battle the way a
   * per-wave-recurring effect could (see the compounding-law note above the
   * `Ability` interface). A flat `* tier` left tiering these units up nearly
   * pointless since the payout only ever lands once — same rationale as
   * `reviveHpForTier`.
   */
  | { kind: 'buffBehind'; attack: number; health: number; all?: boolean }
  /**
   * Buffs BOTH board neighbors (index-1 and index+1), whichever exist. At
   * the front only the "behind" neighbor exists; at the back only the
   * "front" neighbor exists; a middle placement hits both — the first
   * effect in the game where being in the middle is strictly better than
   * an edge. See `buffAdjacent`'s application in sim.ts for the
   * compounding-law note (it's `startOfBattle`-gated, same shape as
   * `buffBehind` on Warren-Warden). Magnitude scales via
   * `tierAttackMultiplier`/`tierHealthMultiplier` (issue #58), same
   * fire-once reasoning as `buffBehind`.
   */
  | { kind: 'buffAdjacent'; attack: number; health: number }
  /**
   * Pack-Caller (issue #88). Same shape as `buffAdjacent` — both board
   * neighbors (whichever exist), middle placement hits both — but the
   * magnitude is not a fixed number: it's `attack`/`health` (pre tier-scale,
   * same as every other effect here) MULTIPLIED by a live count of how many
   * OTHER rats currently on the board share the source's own `tribe` tag
   * (see `UnitDef.tribe`). Counted at apply time in sim.ts, not stored on
   * the effect — the count depends on the board, which isn't known until
   * the battle actually starts.
   *
   * Compounding-law note: `startOfBattle`-gated exactly like `buffAdjacent`
   * (see `fireEntryTriggers`) — fires once per unit instance, ever, never
   * re-fires on a later wave. The count itself is also bounded: it can
   * never exceed `BOARD_CAP - 1` (every other slot, at most), so a maxed
   * board with every rat sharing a tribe is the ceiling, not an unbounded
   * multiplier. Safe under the same reasoning as `buffAdjacent`.
   */
  | { kind: 'buffAdjacentByTribe'; attack: number; health: number }
  | { kind: 'poisonFrontEnemy'; stacks: number }
  | { kind: 'poisonTarget'; stacks: number }
  /**
   * Blight-Witch (issue #62). Poisons every living enemy currently on the
   * board, not just the front one — the first effect in the game to hit the
   * whole opposing wave at once. Stack count is NOT carried on the effect —
   * it's looked up per-tier via `poisonStacksForTier` at apply time, same
   * pattern as `revive`'s `reviveHpForTier` lookup. Always wired to
   * `startOfWave` (never `afterAttack`): `afterAttack` only fires for
   * whichever unit is currently front, which both wasted this effect on an
   * enemy already dying from the clash and left a back-line Blight-Witch
   * dead weight. `startOfWave` fires for every unit regardless of board
   * slot and lands on the whole wave before it's been chipped by combat.
   *
   * Compounding-law note: enemies are re-instantiated every wave and
   * poison never carries across waves (see `waveClear`'s antidote, and
   * enemies simply not existing yet next wave), so this cannot accumulate
   * across the 45-wave battle. Multiple Blight-Witches stack additively
   * within a single wave — each one re-applies `poisonStacksForTier(tier)`
   * to every living enemy — but that's bounded by fresh enemies next wave
   * and the board cap on how many Blight-Witches can even be fielded, not
   * a persistent-horde compounding vector like the shipped exploits.
   */
  | { kind: 'poisonAllEnemies' }
  | { kind: 'gainStats'; attack: number; health: number }
  /**
   * Cellar-Coil (issue #106; "positional patience" in
   * `docs/design/future-minions.md`). Sibling to `gainStats` above, but
   * deliberately NOT the same shape: `gainStats` is uncapped and only ever
   * safe today because its one wired-up trigger (`allyFaint`) is implicitly
   * bounded by how many allies can faint in a battle. This effect is wired
   * to `startOfWave` — a repeating Trigger — gated by the new
   * `Ability.condition.notFront` (fires only on Waves the unit survives
   * while NOT at board index 0), which is exactly the shape ADR-0003 (see
   * `docs/adr/0003-compounding-law-for-repeating-triggers.md`) flags as
   * needing an explicit hard cap: the same permanent-per-wave-gain shape
   * that shipped as the Warren-Warden incident. It is only safe here
   * because the grant is HARD-CAPPED by construction, not a suggestion:
   *
   *   - Per-wave grant is `effect.attackPerWave * tier` — deliberately
   *     LINEAR tier scaling (1/2/3), not `tierAttackMultiplier`'s
   *     exponential `3^(tier-1)` — same rationale as `blockHitsForTier`'s
   *     doc comment: an accumulating per-wave effect must not also get an
   *     exponential per-tier multiplier, or the cap becomes meaningless at
   *     tier 3.
   *   - The grant is clamped in sim.ts's `applyEffect` (`chargeWhileBenched`
   *     case) to `Math.min(effect.attackPerWave * tier, cap - source.chargeStacks)`,
   *     where `cap` comes from `cellarCoilChargeCapForTier(tier)` — see that
   *     function's doc comment for the full sign-off. Once `chargeStacks`
   *     reaches the cap the ability is a silent no-op every subsequent Wave,
   *     not an error — there is no code path that lets it exceed the cap.
   *   - `chargeStacks` lives on `BattleUnit` (see its declaration in sim.ts,
   *     next to `raised`/`startOfBattleFired`) and persists across every
   *     Wave of the whole Ride the same way those fields do, so the cap is a
   *     true ceiling on total attack ever banked over all `WAVE_COUNT` (45)
   *     Waves, not just one Wave or one Battle.
   *
   * No health is granted by this effect — only attack accumulates, matching
   * the design bank's text; the unit's base `health` is its only durability
   * lever while it waits to bank charge.
   *
   * Enemy-side note (ADR-0004): the same effect is technically available to
   * an Enemy for free, but degenerates to near-harmless there — Enemies are
   * re-instantiated fresh every Wave and `fireEntryTriggers` only runs once
   * per Wave, so an Enemy copy could bank at most one grant before the Wave
   * ends and it ceases to exist; it can never reach anywhere near the cap.
   * This is intentional, not an oversight — see ADR-0004
   * (`docs/adr/0004-enemies-share-the-unit-engine.md`) — nobody should "fix"
   * this into carrying Enemy state across Waves.
   */
  | { kind: 'chargeWhileBenched'; attackPerWave: number }
  /**
   * HP is NOT carried on the effect — it's looked up per-tier via
   * `reviveHpForTier` at apply time (issue #53), then capped at the
   * revived corpse's own `maxHealth`. See `reviveHpForTier`'s doc comment
   * for why a steep table is safe here despite the compounding law.
   */
  | { kind: 'revive' }
  /**
   * Ward-Weaver (issue #56). Grants this side a per-wave pool of "block the
   * next incoming hit to whichever unit is currently front" charges, sized
   * by `blockHitsForTier(tier)` (1/2/3). Always wired to `startOfWave`, and
   * the pool is reset to 0 at the top of every wave before this fires — see
   * `blockCharges` in sim.ts for the full compounding-law note and the
   * `Math.max` (never summed) anti-stacking rule for multiple Ward-Weavers.
   */
  | { kind: 'blockFrontHits' }
  /**
   * Backline damage path (issue #85; "Slink-Rat option B" in
   * `docs/design/future-minions.md`). The reusable primitive behind future
   * backline snipers: a non-front unit adds its own current `attack`
   * directly to the frontmost enemy, once per wave, taking no retaliation
   * (it isn't the one clashing — see `blockFrontHits`'s "front" targeting
   * for contrast, which this deliberately bypasses). Always wired to
   * `startOfWave`, same firing point as `poisonFrontEnemy`/`blockFrontHits`,
   * so it lands before the tick loop's clash/poison resolution even begins
   * for that wave (see the `backlineDamage` case in sim.ts's `applyEffect`
   * for the full ordering rationale against Marrow-Snap, Ward-Weaver, and
   * Gore-Cleaver).
   *
   * Compounding-law note: this is a FIXED, non-accumulating per-wave
   * contribution — each living non-front carrier deals its current attack
   * once at that wave's start, then nothing more until the next wave's
   * `startOfWave` fires again. It does not grow with tick count, wave
   * count, or anything other than the unit's own (tier-scaled) attack stat,
   * and multiple carriers stack only additively, bounded by however many
   * non-front slots the board cap allows — the same "safe because bounded
   * by board size" shape as `poisonAllEnemies`'s multi-caster stacking.
   */
  | { kind: 'backlineDamage' }
  /**
   * Whole-team stat grant (issue #12: Dawn-Runt/Dusk-Runt) — every horde unit
   * currently on the board gets `+attack`/`+health`, including the caster
   * itself (unlike `buffBehind`, which deliberately excludes the caster —
   * see Warren-Warden). Only ever wired to a `startOfBattle` trigger, so it
   * fires once per unit instance, ever, exactly like Warren-Warden's
   * `buffBehind`, and cannot compound across the 45-wave battle. Magnitude
   * scales via `tierAttackMultiplier`/`tierHealthMultiplier` (issue #58)
   * instead of a flat `* tier`, same fire-once reasoning as `buffBehind`/
   * `buffAdjacent` above. See the `condition` field on `Ability` for how
   * this pairs with a time-of-day gate.
   */
  | { kind: 'teamBuff'; attack: number; health: number };

/**
 * Real-world half-day bucket, Copenhagen local time (issue #12) — matches the
 * existing Monday 06:00 CET season-reset convention. Resolved by the app
 * layer from the wall clock and threaded in via `Lineup.timeOfDay`;
 * `simulate` itself never reads `Date.now()`/`new Date()`, so this stays
 * fully deterministic for tests and golden logs (they pass, or omit,
 * `timeOfDay` explicitly).
 */
export type TimeOfDay = 'beforeNoon' | 'afterNoon';

/**
 * `startOfBattle` fires **once per unit instance, ever** — on the first wave
 * that unit is present for. `startOfWave` fires at the top of **every** wave.
 *
 * The distinction is load-bearing. `simulate` runs 45 waves against one
 * persistent horde, so any *permanent* effect on a per-wave trigger compounds
 * ~45× without bound: four tier-3 Warren-Wardens re-buffing "+1/+1 to all
 * behind" every wave took a 6-attack rat to 241 and full-cleared the gauntlet.
 * Rule of thumb: **`startOfWave` is only for effects that do not accumulate** —
 * summoning a body that will die, re-applying poison that clears at `waveClear`.
 * Anything that permanently raises a stat belongs on `startOfBattle`.
 *
 * Enemies are re-instantiated every wave, so their `startOfBattle` abilities
 * still fire each wave for free — the per-instance flag makes this automatic.
 *
 * Ward-Weaver's `blockFrontHits` (issue #56) used to be a bespoke
 * per-attack-tick trigger (`watchFrontAttack`), removed once its mechanic
 * changed from "every Nth attack landed" to "block the first N hits each
 * wave" — that reset-every-wave shape is exactly what `startOfWave` is for,
 * so it no longer needs its own trigger kind. See `blockCharges` in sim.ts.
 */
export interface Ability {
  trigger: 'startOfBattle' | 'startOfWave' | 'faint' | 'afterAttack' | 'allyFaint';
  effect: Effect;
  /**
   * Gate the ability's firing on the real-world half of the day the ride
   * belongs to (issue #12). Evaluated against `Lineup.timeOfDay` at the same
   * point the trigger itself would otherwise fire (see `fireEntryTriggers` in
   * sim.ts) — a `startOfBattle` ability still only ever gets its one shot per
   * unit instance, it just no-ops that shot when the condition doesn't match,
   * rather than retrying on a later wave.
   *
   * `notFront` (issue #106: Cellar-Coil) gates firing on the unit's own board
   * position that Wave: true only on Waves where the unit is present but NOT
   * at index 0 (the clashing slot). Evaluated in `fireEntryTriggers`
   * alongside `timeOfDay`, using the same `index` that function already
   * computes before calling `applyEffect` — a `startOfWave` ability still
   * fires every Wave the unit survives, it just no-ops on any Wave the unit
   * is currently front. Siblings, not mutually exclusive in the type, but no
   * current unit combines both.
   */
  condition?: { timeOfDay?: TimeOfDay; notFront?: boolean };
}

export interface UnitDef {
  id: string;
  name: string;
  attack: number;
  health: number;
  cost: number;
  desc?: string;
  archetype?: Archetype;
  ability?: Ability;
  /**
   * Flat armor: subtract this from every incoming **attack** hit (scaled by
   * tier, like every other magnitude). Poison bypasses it — armor doesn't stop
   * rot. A hit always lands for at least 1, so armor can never make a unit
   * immortal (cf. the Bone-Priest self-revive lesson). Strong against swarms of
   * small hits, near-useless against brutes.
   */
  damageReduction?: number;
  /**
   * Day-gated shop availability (issue #12), same mechanism as
   * `boardCapForDay` — a pure function of the expedition day, no new
   * per-account state. Absent = available from day 1 (every pre-existing
   * unit). Once a unit's `unlockDay` is reached it stays in the pool for
   * every later day too — this is not a day-exclusive appearance.
   */
  unlockDay?: number;
  /**
   * Build-around tag (issue #88: Pack-Caller). Purely descriptive on every
   * unit except Pack-Caller — it's the count Pack-Caller's
   * `buffAdjacentByTribe` scans the board for. Optional and freeform-ish
   * (kept to a small fixed vocabulary in practice: "runt", "plague",
   * "brute", "swarm"); a unit with no obvious kinship gets no tag rather
   * than a forced one. Tagging is a subjective flavor/mechanics read — see
   * the tagging rationale next to `UNIT_DEFS` below and the PR description
   * for issue #88.
   */
  tribe?: string;
}

export interface LineupUnit {
  defId: string;
  tier?: number;
  relicIds?: string[];
}

export interface Lineup {
  units: LineupUnit[];
  teamRelicIds?: string[];
  /**
   * How many bodies this side may hold *during combat*, summons included.
   * Callers building from a `BuildState` (see `lineupFromBuild`/
   * `combatCapForBuild` in shop.ts) set this to `units.length + 2` — always
   * larger than however many rats were actually deployed, so a summoner is
   * never starved by a full warren, but never banks more than 2 spare slots
   * either (issue #69). Omitted = `BOARD_CAP`, which keeps every pre-existing
   * golden log byte-identical.
   */
  combatCap?: number;
  /**
   * Real-world half-day this ride's rats fight in (issue #12) — drives
   * Dawn-Runt/Dusk-Runt's `condition.timeOfDay` gate. Omitted = neither
   * condition matches, so any lineup that predates or doesn't care about
   * time-of-day (every golden log, every existing test) behaves exactly as
   * it did before this field existed. The app layer resolves this from the
   * wall clock (see `copenhagenSeconds`/`timeOfDayAt` in App.svelte);
   * `simulate` never reads the clock itself.
   */
  timeOfDay?: TimeOfDay;
}

/**
 * Full spec §5.4 roster. Archetypes: Breed/Swarm, Plague, Sacrifice, Bruiser/Anchor.
 *
 * `tribe` tagging rationale (issue #88, Pack-Caller) — a subjective read of
 * each unit's flavor/mechanics, called out here since it's a judgment call:
 *   - "runt": small, cheap, or literally-named-Runt bodies — Pup, Gutter
 *     Runt, Dawn-Runt, Dusk-Runt. Gnawer joins this tribe too: fragile
 *     (1 health) glass-cannon chaff, thematically a scrappy little biter
 *     rather than a brute or plague unit. Pack-Caller itself is tagged
 *     "runt" — it's a rallying caller for the horde's little guys, and this
 *     tribe already has the deepest bench (5 other units), which makes an
 *     all-runt board a genuinely buildable theme rather than a trap with no
 *     support.
 *   - "swarm": breeding/summon-focused units — Rat-Piper (pipes in pups
 *     every wave) and Brood-Mother (births pups on faint).
 *   - "plague": poison-dealing units — Plague-Bearer and Blight-Witch.
 *   - "brute": big, tanky anchors — Warren-Warden, Dire-Rat (armored),
 *     MD Rattyfock (Warren-Warden's kit, reskinned).
 *   - Left untagged: Corpse-Glutton, Bone-Priest, Press-Kin, Ward-Weaver.
 *     None of these read as belonging to an obvious kinship group — forcing
 *     a tag on a unit with no real thematic tribe would just be noise (the
 *     issue explicitly says use judgment, not "tag everything").
 */
export const UNIT_DEFS: Record<string, UnitDef> = {
  pup: { id: 'pup', name: 'Pup', attack: 1, health: 1, cost: 0, tribe: 'runt' },
  'gutter-runt': {
    id: 'gutter-runt', name: 'Gutter Runt', attack: 1, health: 1, cost: 2,
    desc: 'cheap body',
    tribe: 'runt',
  },
  'rat-piper': {
    id: 'rat-piper', name: 'Rat-Piper', attack: 1, health: 2, cost: 4,
    desc: 'each wave: pipes in a pup',
    ability: { trigger: 'startOfWave', effect: { kind: 'summon', unitId: 'pup', count: 1 } },
    tribe: 'swarm',
  },
  'brood-mother': {
    id: 'brood-mother', name: 'Brood-Mother', attack: 2, health: 3, cost: 6,
    desc: 'faint: births 2 pups',
    ability: { trigger: 'faint', effect: { kind: 'summon', unitId: 'pup', count: 2 } },
    tribe: 'swarm',
  },
  'plague-bearer': {
    id: 'plague-bearer', name: 'Plague-Bearer', attack: 2, health: 2, cost: 4,
    desc: 'each wave: poisons front foe',
    ability: { trigger: 'startOfWave', effect: { kind: 'poisonFrontEnemy', stacks: 1 } },
    tribe: 'plague',
  },
  'blight-witch': {
    id: 'blight-witch', name: 'Blight-Witch', attack: 3, health: 3, cost: 8,
    desc: 'each wave: poisons the whole enemy line (scales ★)',
    ability: { trigger: 'startOfWave', effect: { kind: 'poisonAllEnemies' } },
    tribe: 'plague',
  },
  gnawer: {
    id: 'gnawer', name: 'Gnawer', attack: 3, health: 1, cost: 4,
    desc: 'faint: buffs the rat behind (scales ★)',
    ability: { trigger: 'faint', effect: { kind: 'buffBehind', attack: 2, health: 0 } },
    tribe: 'runt',
  },
  'corpse-glutton': {
    id: 'corpse-glutton', name: 'Corpse-Glutton', attack: 3, health: 2, cost: 6,
    desc: '+1/+1 when an ally faints',
    ability: { trigger: 'allyFaint', effect: { kind: 'gainStats', attack: 1, health: 1 } },
  },
  'bone-priest': {
    id: 'bone-priest', name: 'Bone-Priest', attack: 1, health: 4, cost: 6,
    desc: 'faint: revives first fallen at 1/10/20 HP (tier), capped at their own max',
    ability: { trigger: 'faint', effect: { kind: 'revive' } },
  },
  'warren-warden': {
    id: 'warren-warden', name: 'Warren-Warden', attack: 2, health: 6, cost: 6,
    desc: 'battle: buffs all rats behind it (scales ★)',
    ability: { trigger: 'startOfBattle', effect: { kind: 'buffBehind', attack: 1, health: 1, all: true } },
    tribe: 'brute',
  },
  'dire-rat': {
    id: 'dire-rat', name: 'Dire-Rat', attack: 4, health: 5, cost: 8,
    desc: 'hide like a door: shrugs off 2 from every blow',
    damageReduction: 2,
    // Day-1 shop is deliberately kept plain (Jesper, 2026-07-11): the three
    // strongest early picks — the armored tank, the Season-1 anchor, and the
    // front-shield — hold back to day 2, so day 1 is a humble scramble and the
    // shop gets visibly stronger as the expedition opens up (days 2-4 are the
    // exciting stretch). Only gates the SHOP roll; a unit already owned/on the
    // board is unaffected, and the balance scripts build lineups directly so
    // they don't see this gate.
    unlockDay: 2,
    tribe: 'brute',
  },
  'md-rattyfock': {
    id: 'md-rattyfock', name: 'MD Rattyfock', attack: 2, health: 6, cost: 6,
    desc: 'Season 1 survivor, patched and returned; battle: buffs all rats behind it (scales ★)',
    ability: { trigger: 'startOfBattle', effect: { kind: 'buffBehind', attack: 1, health: 1, all: true } },
    unlockDay: 2, // day-1 shop kept plain — see Dire-Rat's note.
    tribe: 'brute',
  },
  'press-kin': {
    id: 'press-kin', name: 'Press-Kin', attack: 2, health: 4, cost: 5,
    desc: 'battle: buffs the rats beside it, best in the middle (scales ★)',
    ability: { trigger: 'startOfBattle', effect: { kind: 'buffAdjacent', attack: 2, health: 2 } },
  },
  'ward-weaver': {
    id: 'ward-weaver', name: 'Ward-Weaver', attack: 1, health: 3, cost: 6,
    desc: 'each wave, blocks the front rat’s hit outright — ★2 blocks 2 hits, ★3 blocks 3; resets every wave',
    ability: { trigger: 'startOfWave', effect: { kind: 'blockFrontHits' } },
    unlockDay: 2, // day-1 shop kept plain — see Dire-Rat's note.
  },
  // Issue #12: a parallel "Runt" pair (Gutter-Runt precedent) tied to the
  // game's dawn/dusk duality rather than literal noon-splitting — the actual
  // trigger condition is the broader before/after-noon Copenhagen split, but
  // the flavor leans poetic. Day-gated (unlockDay) rather than depth-gated,
  // per #6's fairness resolution, so the shop stays a pure function of
  // (date, day) with no new per-account state.
  'dawn-runt': {
    id: 'dawn-runt', name: 'Dawn-Runt', attack: 1, health: 2, cost: 4,
    desc: 'thrives in the grey light before the city wakes; battle (before noon): buffs the horde’s attack (scales ★)',
    ability: {
      trigger: 'startOfBattle',
      effect: { kind: 'teamBuff', attack: 2, health: 0 },
      condition: { timeOfDay: 'beforeNoon' },
    },
    unlockDay: 3,
    tribe: 'runt',
  },
  'dusk-runt': {
    id: 'dusk-runt', name: 'Dusk-Runt', attack: 1, health: 2, cost: 4,
    desc: 'comes alive as the drains go black again, ahead of the next dawn’s ride; battle (after noon): buffs the horde’s health (scales ★)',
    ability: {
      trigger: 'startOfBattle',
      effect: { kind: 'teamBuff', attack: 0, health: 2 },
      condition: { timeOfDay: 'afterNoon' },
    },
    unlockDay: 3,
    tribe: 'runt',
  },
  // Issue #88: Pack-Caller — the build-around unit for the new `tribe` tag.
  // Stats (attack 2 / health 3 / cost 5) are the design doc's rough starting
  // point, NOT final — flagged for Jesper's balance sign-off, same as every
  // other tentative stat line in this file. Tagged "runt" itself (see the
  // tagging-rationale comment above `UNIT_DEFS`): it's a rallying caller for
  // the horde's little guys, and "runt" already has the deepest bench, which
  // makes an all-runt board an actually-buildable theme.
  'pack-caller': {
    id: 'pack-caller', name: 'Pack-Caller', attack: 2, health: 3, cost: 5,
    desc: 'battle: buffs the rats beside it +1/+1 for each other same-tribe rat on the board (scales ★)',
    // startOfBattle: fires once per unit instance, ever (see `fireEntryTriggers`
    // and the compounding-law note on `buffAdjacentByTribe` above) — bounded
    // by board size (at most BOARD_CAP-1 other rats to count), and cannot
    // re-fire on a later wave to re-stack. Safe under the compounding law.
    ability: { trigger: 'startOfBattle', effect: { kind: 'buffAdjacentByTribe', attack: 1, health: 1 } },
    tribe: 'runt',
  },
  // Issue #86: Slink-Rat — first consumer of the `backlineDamage` primitive
  // (#85). Attack 3 / health 1 / cost 6 are the design doc's rough starting
  // point, NOT final — flagged for Jesper's balance sign-off. 1 HP is
  // deliberate: worthless (dies to almost anything) if it ever reaches the
  // front, rewarding a durable front wall built to protect it.
  'slink-rat': {
    id: 'slink-rat', name: 'Slink-Rat', attack: 3, health: 1, cost: 6,
    desc: 'fights from the dark: each wave, adds its own attack to the clash against the front foe, from any slot — but 1 HP means it dies to almost anything if it ever reaches the front (scales ★)',
    // startOfWave, via `backlineDamage` (see that Effect's doc comment for
    // the full compounding-law note and the four resolved interaction
    // decisions against Marrow-Snap/Ward-Weaver/Gore-Cleaver). Fixed
    // per-wave damage equal to this unit's own (tier-scaled) attack — no
    // accumulation; multiple Slink-Rats stack additively, bounded by board size.
    ability: { trigger: 'startOfWave', effect: { kind: 'backlineDamage' } },
  },
  // Issue #106: Cellar-Coil — "positional patience" (docs/design/future-minions.md
  // concept 2). Attack 2 / health 4 / cost 5 are the design doc's rough
  // starting point, NOT final — flagged for Jesper's balance sign-off.
  // Squishy on purpose: 4 HP is little enough that benching it for the 6+
  // Waves it takes to fill the cap is a real risk, not a free stat stick.
  'cellar-coil': {
    id: 'cellar-coil', name: 'Cellar-Coil', attack: 2, health: 4, cost: 5,
    desc: 'each wave it survives off the front, permanently banks +attack (hard-capped) — cashes in once the line finally breaks to it (scales ★)',
    // startOfWave + `condition.notFront` (see both doc comments above): fires
    // every Wave the unit survives while NOT at board index 0, and is a
    // no-op the Wave it's front (or the Wave it doesn't survive). The
    // `chargeWhileBenched` effect is HARD-CAPPED via
    // `cellarCoilChargeCapForTier` — see that function's and the effect's
    // doc comments in this file, and the `chargeWhileBenched` case in
    // sim.ts's `applyEffect`, for the full ADR-0003 compounding-law sign-off.
    // `attackPerWave: 1` here is the PRE-tier-scale literal — the case in
    // sim.ts multiplies by `tier` (linear, 1/2/3), matching
    // `cellarCoilChargeCapForTier`'s own linear-not-exponential rationale.
    ability: {
      trigger: 'startOfWave',
      effect: { kind: 'chargeWhileBenched', attackPerWave: 1 },
      condition: { notFront: true },
    },
  },
};

/** Hardcoded showcase lineup until the shop lands (milestone 4). Index 0 = front. */
export const TEST_HORDE: Lineup = {
  units: [
    { defId: 'gnawer', relicIds: ['rusted-nail'] },
    { defId: 'plague-bearer' },
    { defId: 'corpse-glutton', relicIds: ['fat-tick'] },
    { defId: 'brood-mother' },
    { defId: 'bone-priest', relicIds: ['tail-charm'] },
  ],
  teamRelicIds: ['filth-totem'],
};
