export type Side = 'horde' | 'gauntlet';

export type Archetype = 'swarm' | 'brute' | 'armored' | 'plague';

export type Effect =
  | { kind: 'summon'; unitId: string; count: number }
  | { kind: 'buffBehind'; attack: number; health: number; all?: boolean }
  | { kind: 'poisonFrontEnemy'; stacks: number }
  | { kind: 'poisonTarget'; stacks: number }
  | { kind: 'gainStats'; attack: number; health: number }
  | { kind: 'revive'; health: number };

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
 */
export interface Ability {
  trigger: 'startOfBattle' | 'startOfWave' | 'faint' | 'afterAttack' | 'allyFaint';
  effect: Effect;
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
