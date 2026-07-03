import type { UnitDef } from './units';

/**
 * The city's defenders, drawn by budget when generating the gauntlet.
 * Every enemy carries an archetype so daily themes and scout reports
 * have something real to point at.
 */
export const ENEMY_POOL: UnitDef[] = [
  { id: 'watch-whelp', name: 'Watch-Whelp', attack: 1, health: 1, cost: 1, archetype: 'swarm' },
  { id: 'gutter-watch', name: 'Gutter-Watch', attack: 1, health: 2, cost: 1, archetype: 'swarm' },
  {
    id: 'watch-sergeant',
    name: 'Watch-Sergeant',
    attack: 2,
    health: 3,
    cost: 3,
    archetype: 'swarm',
    ability: { trigger: 'startOfBattle', effect: { kind: 'summon', unitId: 'watch-whelp', count: 1 } },
  },
  {
    id: 'muster-captain',
    name: 'Muster-Captain',
    attack: 3,
    health: 4,
    cost: 6,
    archetype: 'swarm',
    ability: { trigger: 'startOfBattle', effect: { kind: 'summon', unitId: 'watch-whelp', count: 2 } },
  },
  { id: 'sewer-hound', name: 'Sewer-Hound', attack: 3, health: 1, cost: 2, archetype: 'brute' },
  { id: 'rat-catcher', name: 'Rat-Catcher', attack: 4, health: 3, cost: 4, archetype: 'brute' },
  { id: 'dray-ogre', name: 'Dray-Ogre', attack: 6, health: 5, cost: 7, archetype: 'brute' },
  { id: 'drain-warden', name: 'Drain-Warden', attack: 2, health: 5, cost: 3, archetype: 'armored' },
  { id: 'grate-golem', name: 'Grate-Golem', attack: 1, health: 9, cost: 4, archetype: 'armored' },
  { id: 'culvert-knight', name: 'Culvert-Knight', attack: 5, health: 7, cost: 7, archetype: 'armored' },
  {
    id: 'plague-doctor',
    name: 'Plague-Doctor',
    attack: 2,
    health: 3,
    cost: 3,
    archetype: 'plague',
    ability: { trigger: 'startOfBattle', effect: { kind: 'poisonFrontEnemy', stacks: 1 } },
  },
  {
    id: 'midden-hag',
    name: 'Midden-Hag',
    attack: 3,
    health: 4,
    cost: 5,
    archetype: 'plague',
    ability: { trigger: 'afterAttack', effect: { kind: 'poisonTarget', stacks: 1 } },
  },
];
