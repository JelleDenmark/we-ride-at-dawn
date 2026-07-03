export { xorshift128, type Rng } from './prng';
export { fnv1a, dailySeed, currentRideDate } from './seed';
export {
  UNIT_DEFS,
  TEST_HORDE,
  type UnitDef,
  type Ability,
  type Effect,
  type Side,
  type Lineup,
  type LineupUnit,
} from './data/units';
export { RELIC_DEFS, type RelicDef } from './data/relics';
export { ENEMY_POOL } from './data/enemies';
export type { Archetype } from './data/units';
export {
  generateGauntlet,
  type Gauntlet,
  type GauntletTheme,
  type EnemyWave,
  WAVE_COUNT,
} from './gauntlet';
export { scoutReport, ARCHETYPE_LABEL, type ScoutReport, type ScoutHint } from './scout';
export {
  simulate,
  BOARD_CAP,
  SCORE_PER_WAVE,
  type BattleEvent,
  type BattleResult,
  type UnitView,
} from './sim';
