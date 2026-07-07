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
  difficultyForDay,
  type Gauntlet,
  type GauntletTheme,
  type EnemyWave,
  WAVE_COUNT,
} from './gauntlet';
export { scoutReport, ARCHETYPE_LABEL, type ScoutReport, type ScoutHint } from './scout';
export {
  newBuild,
  advanceAfterDawn,
  boardCapForDay,
  weekdayFor,
  seasonIdFor,
  interestFor,
  SEASON_DAYS,
  SCRAP_PER_DEPTH,
  INTEREST_CAP,
  rollOfferings,
  buyUnit,
  canRecruit,
  buyRelic,
  sellUnit,
  sellBenchUnit,
  sellRefund,
  rerollShop,
  toggleFreeze,
  moveUnit,
  benchUnit,
  deployUnit,
  swapWithBench,
  lineupFromBuild,
  unitStats,
  DAILY_SCRAP,
  REROLL_COST,
  MAX_TIER,
  BENCH_SIZE,
  type BuildState,
  type BoardUnit,
  type ShopSlot,
  type ActionResult,
} from './shop';
export {
  simulate,
  BOARD_CAP,
  SCORE_PER_WAVE,
  ENEMY_HEALTH_SCALE_PER_WAVE,
  ENEMY_HEALTH_SCALE_QUADRATIC,
  ENEMY_ATTACK_SCALE_PER_WAVE,
  enemyHealthScale,
  enemyAttackScale,
  type BattleEvent,
  type BattleResult,
  type UnitView,
} from './sim';
