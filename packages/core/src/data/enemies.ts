import type { UnitDef } from './units';

/** The city's defenders — drawn by budget when generating the gauntlet. */
export const ENEMY_POOL: UnitDef[] = [
  { id: 'gutter-watch', name: 'Gutter-Watch', attack: 1, health: 2, cost: 1 },
  { id: 'sewer-hound', name: 'Sewer-Hound', attack: 3, health: 1, cost: 2 },
  { id: 'drain-warden', name: 'Drain-Warden', attack: 2, health: 5, cost: 3 },
  { id: 'rat-catcher', name: 'Rat-Catcher', attack: 4, health: 3, cost: 4 },
  { id: 'culvert-knight', name: 'Culvert-Knight', attack: 5, health: 7, cost: 7 },
];
