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
    id: 'sluice-bulwark',
    name: 'Sluice-Bulwark',
    attack: 2,
    health: 16,
    cost: 8,
    archetype: 'armored',
  },
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
  // ---- Enchanter/support wing (issue #138, season 4) — the pool's first
  // BUFFERS: every enemy above hits, tanks, spawns, or curses; these two
  // make their own line stronger, mirroring the player's support wing
  // (Warren-Warden/Press-Kin/Twilight-Runt). Both reuse existing Effect
  // kinds (ADR-0004: enemies share the unit engine), so there is zero
  // combat-engine work here. Compounding-law: a non-issue on this side —
  // enemies regenerate fresh every wave, so each buff is bounded within
  // one battle-wave by construction. Gating is both mechanisms the issue
  // asks for: `minWave` as the deterministic hard floor (the median player
  // lives at depth ~6-10, so no enchanters where they ride), plus a high
  // `cost` so they stay rare in the budget rolls when first available.
  // `rearguard` moves them behind the wall after a wave is rolled (see
  // generateGauntlet) — a support that rolls into the clash slot dies
  // doing nothing, and the whole point is the "kill the protected support
  // first" read that AoE poison and backline snipers exist to answer.
  // Stats/magnitudes/minWave floors are placeholders pending the usual
  // balance sign-off (npm run balance + a reachability check).
  {
    id: 'muster-herald',
    name: 'Muster-Herald',
    attack: 2,
    health: 4,
    cost: 8,
    archetype: 'swarm',
    minWave: 12,
    rearguard: true,
    // teamBuff rather than buffBehind: rearguard parks it at the BACK,
    // where "behind it" is nobody — the whole-line rally is the Warren-
    // Warden mirror that actually works from the back seat. startOfBattle
    // fires fresh each wave for a re-instantiated enemy, bounded within it.
    ability: { trigger: 'startOfBattle', effect: { kind: 'teamBuff', attack: 1, health: 1 } },
  },
  {
    id: 'sluice-warden',
    name: 'Sluice-Warden',
    attack: 2,
    health: 7,
    cost: 8,
    archetype: 'armored',
    minWave: 12,
    rearguard: true,
    // Ward-Weaver's kit on the enemy side: the line no-sells the horde's
    // opening hit(s) each wave — a check on burst/execute openings that
    // rewards sustained damage and poison. blockCharges is already keyed
    // by side in sim.ts, so this works unchanged.
    ability: { trigger: 'startOfWave', effect: { kind: 'blockFrontHits' } },
  },
];
