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
  | { kind: 'revive'; health: number }
  /**
   * Watches this unit's OWN side's current front-line unit (not itself) and,
   * every `every`th attack that front unit lands, grants it a one-hit
   * shield. See the `watchFrontAttack` trigger doc comment and the
   * compounding-law note in sim.ts's tick loop for why the shield can never
   * exceed "absorbs one hit" no matter how long the battle runs.
   */
  | { kind: 'shieldFront'; every: number }
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
 * `watchFrontAttack` is different in kind from the others: it does not fire
 * on anything that happens to *this* unit. It fires once per combat tick in
 * which this unit's own side's current front-line unit lands an attack —
 * i.e. it observes a teammate's combat event, not its own. See sim.ts's
 * `tickWatchers` for the implementation and why "whoever is currently
 * front" (not a fixed unit) is the thing being watched.
 */
export interface Ability {
  trigger: 'startOfBattle' | 'startOfWave' | 'faint' | 'afterAttack' | 'allyFaint' | 'watchFrontAttack';
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
    desc: 'faint: revives first fallen',
    ability: { trigger: 'faint', effect: { kind: 'revive', health: 1 } },
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
    desc: 'watches the front rat: every 3rd attack it lands, shields it from the next hit',
    ability: { trigger: 'watchFrontAttack', effect: { kind: 'shieldFront', every: 3 } },
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
    unlockDay: 4,
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
