export type Side = 'horde' | 'gauntlet';

export type Effect =
  | { kind: 'summon'; unitId: string; count: number }
  | { kind: 'buffBehind'; attack: number; health: number };

export interface Ability {
  trigger: 'startOfBattle' | 'faint';
  effect: Effect;
}

export interface UnitDef {
  id: string;
  name: string;
  attack: number;
  health: number;
  cost: number;
  ability?: Ability;
}

/** Milestone-1 subset of the spec §5.4 roster. */
export const UNIT_DEFS: Record<string, UnitDef> = {
  pup: { id: 'pup', name: 'Pup', attack: 1, health: 1, cost: 0 },
  'gutter-runt': { id: 'gutter-runt', name: 'Gutter Runt', attack: 1, health: 1, cost: 1 },
  'rat-piper': {
    id: 'rat-piper',
    name: 'Rat-Piper',
    attack: 1,
    health: 2,
    cost: 2,
    ability: { trigger: 'startOfBattle', effect: { kind: 'summon', unitId: 'pup', count: 1 } },
  },
  'brood-mother': {
    id: 'brood-mother',
    name: 'Brood-Mother',
    attack: 2,
    health: 3,
    cost: 3,
    ability: { trigger: 'faint', effect: { kind: 'summon', unitId: 'pup', count: 2 } },
  },
  gnawer: {
    id: 'gnawer',
    name: 'Gnawer',
    attack: 3,
    health: 1,
    cost: 2,
    ability: { trigger: 'faint', effect: { kind: 'buffBehind', attack: 2, health: 0 } },
  },
  'dire-rat': { id: 'dire-rat', name: 'Dire-Rat', attack: 4, health: 5, cost: 4 },
};

/** Hardcoded milestone-1 lineup, index 0 = front. */
export const TEST_HORDE: UnitDef[] = [
  UNIT_DEFS['gnawer'],
  UNIT_DEFS['gutter-runt'],
  UNIT_DEFS['rat-piper'],
  UNIT_DEFS['brood-mother'],
  UNIT_DEFS['dire-rat'],
];
