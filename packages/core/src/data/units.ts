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

export type Effect =
  | { kind: 'summon'; unitId: string; count: number }
  | { kind: 'buffBehind'; attack: number; health: number; all?: boolean }
  /**
   * Buffs BOTH board neighbors (index-1 and index+1), whichever exist. At
   * the front only the "behind" neighbor exists; at the back only the
   * "front" neighbor exists; a middle placement hits both — the first
   * effect in the game where being in the middle is strictly better than
   * an edge. See `buffAdjacent`'s application in sim.ts for the
   * compounding-law note (it's `startOfBattle`-gated, same shape as
   * `buffBehind` on Warren-Warden).
   */
  | { kind: 'buffAdjacent'; attack: number; health: number }
  | { kind: 'poisonFrontEnemy'; stacks: number }
  | { kind: 'poisonTarget'; stacks: number }
  | { kind: 'gainStats'; attack: number; health: number }
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
   * Flat, whole-team stat grant (issue #12: Dawn-Runt/Dusk-Runt) — every
   * horde unit currently on the board gets `+attack`/`+health`, including the
   * caster itself (unlike `buffBehind`, which deliberately excludes the
   * caster — see Warren-Warden). Only ever wired to a `startOfBattle`
   * trigger, so it fires once per unit instance, ever, exactly like
   * Warren-Warden's `buffBehind`, and cannot compound across the 45-wave
   * battle. See the `condition` field on `Ability` for how this pairs with a
   * time-of-day gate.
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
   */
  condition?: { timeOfDay: TimeOfDay };
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
   * Always larger than the recruitable board so a summoner is never starved by
   * a full warren (see `combatCapForDay`). Omitted = `BOARD_CAP`, which keeps
   * every pre-existing golden log byte-identical.
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

/** Full spec §5.4 roster. Archetypes: Breed/Swarm, Plague, Sacrifice, Bruiser/Anchor. */
export const UNIT_DEFS: Record<string, UnitDef> = {
  pup: { id: 'pup', name: 'Pup', attack: 1, health: 1, cost: 0 },
  'gutter-runt': {
    id: 'gutter-runt', name: 'Gutter Runt', attack: 1, health: 1, cost: 2,
    desc: 'cheap body',
  },
  'rat-piper': {
    id: 'rat-piper', name: 'Rat-Piper', attack: 1, health: 2, cost: 4,
    desc: 'each wave: pipes in a pup',
    ability: { trigger: 'startOfWave', effect: { kind: 'summon', unitId: 'pup', count: 1 } },
  },
  'brood-mother': {
    id: 'brood-mother', name: 'Brood-Mother', attack: 2, health: 3, cost: 6,
    desc: 'faint: births 2 pups',
    ability: { trigger: 'faint', effect: { kind: 'summon', unitId: 'pup', count: 2 } },
  },
  'plague-bearer': {
    id: 'plague-bearer', name: 'Plague-Bearer', attack: 2, health: 2, cost: 4,
    desc: 'each wave: poisons front foe',
    ability: { trigger: 'startOfWave', effect: { kind: 'poisonFrontEnemy', stacks: 1 } },
  },
  'blight-witch': {
    id: 'blight-witch', name: 'Blight-Witch', attack: 3, health: 3, cost: 6,
    desc: 'poisons whatever it hits',
    ability: { trigger: 'afterAttack', effect: { kind: 'poisonTarget', stacks: 1 } },
  },
  gnawer: {
    id: 'gnawer', name: 'Gnawer', attack: 3, health: 1, cost: 4,
    desc: 'faint: +2 atk to rat behind',
    ability: { trigger: 'faint', effect: { kind: 'buffBehind', attack: 2, health: 0 } },
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
    desc: 'battle: +1/+1 to all behind',
    ability: { trigger: 'startOfBattle', effect: { kind: 'buffBehind', attack: 1, health: 1, all: true } },
  },
  'dire-rat': {
    id: 'dire-rat', name: 'Dire-Rat', attack: 4, health: 5, cost: 8,
    desc: 'hide like a door: shrugs off 2 from every blow',
    damageReduction: 2,
  },
  'md-rattyfock': {
    id: 'md-rattyfock', name: 'MD Rattyfock', attack: 2, health: 6, cost: 6,
    desc: 'battle: Season 1 survivor, patched and returned; +1/+1 to all behind',
    ability: { trigger: 'startOfBattle', effect: { kind: 'buffBehind', attack: 1, health: 1, all: true } },
  },
  'press-kin': {
    id: 'press-kin', name: 'Press-Kin', attack: 2, health: 4, cost: 5,
    desc: 'battle: +2/+2 to the rats beside it (both sides — best in the middle)',
    ability: { trigger: 'startOfBattle', effect: { kind: 'buffAdjacent', attack: 2, health: 2 } },
  },
  'ward-weaver': {
    id: 'ward-weaver', name: 'Ward-Weaver', attack: 1, health: 3, cost: 6,
    desc: 'each wave, blocks the front rat’s first incoming hit outright — ★2 blocks its first 2 hits, ★3 its first 3; charges reset every wave and never carry over',
    ability: { trigger: 'startOfWave', effect: { kind: 'blockFrontHits' } },
  },
  // Issue #12: a parallel "Runt" pair (Gutter-Runt precedent) tied to the
  // game's dawn/dusk duality rather than literal noon-splitting — the actual
  // trigger condition is the broader before/after-noon Copenhagen split, but
  // the flavor leans poetic. Day-gated (unlockDay) rather than depth-gated,
  // per #6's fairness resolution, so the shop stays a pure function of
  // (date, day) with no new per-account state.
  'dawn-runt': {
    id: 'dawn-runt', name: 'Dawn-Runt', attack: 1, health: 2, cost: 4,
    desc: 'thrives in the grey light before the city wakes; battle (before noon): +2 attack to the horde',
    ability: {
      trigger: 'startOfBattle',
      effect: { kind: 'teamBuff', attack: 2, health: 0 },
      condition: { timeOfDay: 'beforeNoon' },
    },
    unlockDay: 3,
  },
  'dusk-runt': {
    id: 'dusk-runt', name: 'Dusk-Runt', attack: 1, health: 2, cost: 4,
    desc: 'comes alive as the drains go black again, ahead of the next dawn’s ride; battle (after noon): +2 health to the horde',
    ability: {
      trigger: 'startOfBattle',
      effect: { kind: 'teamBuff', attack: 0, health: 2 },
      condition: { timeOfDay: 'afterNoon' },
    },
    unlockDay: 3,
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
