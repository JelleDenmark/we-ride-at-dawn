export { xorshift128, type Rng } from './prng';
export { fnv1a, dailySeed, currentRideDate } from './seed';
export { UNIT_DEFS, TEST_HORDE, type UnitDef, type Ability, type Effect, type Side } from './data/units';
export { ENEMY_POOL } from './data/enemies';
export { generateGauntlet, type Gauntlet, type EnemyWave, WAVE_COUNT } from './gauntlet';
export {
  simulate,
  BOARD_CAP,
  SCORE_PER_WAVE,
  type BattleEvent,
  type BattleResult,
  type UnitView,
} from './sim';
