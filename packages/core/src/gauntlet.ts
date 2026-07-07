import { xorshift128, type Rng } from './prng';
import { dailySeed, fnv1a } from './seed';
import { ENEMY_POOL } from './data/enemies';
import type { Archetype, UnitDef } from './data/units';

export interface EnemyWave {
  units: UnitDef[];
}

export interface GauntletTheme {
  primary: Archetype;
  secondary: Archetype;
  /** 1-based wave from which the secondary archetype starts mustering. */
  pivotWave: number;
}

export interface Gauntlet {
  date: string;
  seed: number;
  theme: GauntletTheme;
  /** Absolute hour bucket this ride belongs to; absent = the day's base gauntlet. */
  hour?: number;
  waves: EnemyWave[];
}

// Depth is the leaderboard's core metric, so the ceiling needs enough
// headroom that even a maxed-out horde is chasing depth, not capping out.
export const WAVE_COUNT = 45;
export const WAVE_BUDGET_BASE = 3;
export const WAVE_BUDGET_GROWTH = 2;
/** Super-linear term: budget grows by i^2 * this, so late waves outpace
 * early linear growth instead of scaling forever at the same rate. Dialed
 * down from 0.15: depth difficulty now comes primarily from enemy-stat
 * scaling by wave depth (see sim.ts's enemyHealthScale/enemyAttackScale),
 * not from a wall of extra chaff bodies compounding with day difficulty. */
export const WAVE_BUDGET_QUADRATIC = 0.05;
export const WAVE_UNIT_CAP = 5;

const ARCHETYPES: Archetype[] = ['swarm', 'brute', 'armored', 'plague'];

function weightedPick<T>(rng: Rng, items: T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = rng.int(total);
  for (const item of items) {
    roll -= weight(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

/**
 * Difficulty multiplier for a given expedition day (day 1 = baseline).
 * Constant **1** for every day: difficulty no longer scales by expedition
 * day at all. The leaderboard metric is max depth over the whole week, so
 * day-scaling was never allowed to be the primary lever (that would let
 * players peak early and coast) — it's now removed entirely rather than just
 * kept modest. Depth difficulty comes purely from (a) enemy-stat scaling by
 * WAVE DEPTH (sim.ts's enemyHealthScale / enemyAttackScale), which is
 * day-agnostic, and (b) roster growth (board cap, tiers, relics) outpacing
 * that curve as the expedition progresses. Kept as a function (rather than
 * inlining `1`) purely for API stability — callers and tests still reference
 * it, and reintroducing day-scaling later (if ever) is a one-line change.
 */
export function difficultyForDay(_day: number): number {
  return 1;
}

/**
 * `day` scales every wave's budget so later expedition days field tougher
 * gauntlets. The theme (archetype composition) is derived before the waves,
 * so it stays a pure function of the date regardless of difficulty.
 *
 * `hour` (absolute hour bucket) reshuffles the wave composition under the
 * fixed daily theme: same budget, same archetype quotas, different enemy
 * picks and ordering — so hourly rides vary but the scout report stays
 * truthful all day. Hourless calls keep the day's base stream byte-identical
 * (golden logs, telemetry dawn rides).
 */
export function generateGauntlet(date: string, day = 1, hour?: number): Gauntlet {
  const seed = dailySeed(date);
  const themeRng = xorshift128(seed);

  const primary = ARCHETYPES[themeRng.int(ARCHETYPES.length)];
  const rest = ARCHETYPES.filter((a) => a !== primary);
  const secondary = rest[themeRng.int(rest.length)];
  const pivotWave = 4 + themeRng.int(4);
  const theme: GauntletTheme = { primary, secondary, pivotWave };

  // Hourly rides roll waves from their own stream; the base gauntlet
  // continues the theme stream exactly as before.
  const rng = hour === undefined ? themeRng : xorshift128(fnv1a(`${date}#ride#${hour}`));

  // Structural theming: each wave force-spends a budget quota on the
  // primary archetype (and on the secondary once its pivot wave is
  // reached), so the scout report is guaranteed to describe what the
  // player actually meets. The secondary never appears before its pivot.
  const PRIMARY_SHARE = 0.6;
  const SECONDARY_SHARE = 0.25;
  const scale = difficultyForDay(day);

  const waves: EnemyWave[] = [];
  for (let i = 0; i < WAVE_COUNT; i++) {
    const waveBudget = Math.round(
      (WAVE_BUDGET_BASE + i * WAVE_BUDGET_GROWTH + i * i * WAVE_BUDGET_QUADRATIC) * scale
    );
    let budget = waveBudget;
    const units: UnitDef[] = [];

    const spendPhase = (archetype: Archetype | null, quota: number): void => {
      let spent = 0;
      while (spent < quota && units.length < WAVE_UNIT_CAP) {
        const pool = ENEMY_POOL.filter((u) => {
          if (u.cost > budget) return false;
          if (archetype !== null) return u.archetype === archetype;
          return !(u.archetype === secondary && i + 1 < pivotWave);
        });
        if (pool.length === 0) break;
        const pick = weightedPick(rng, pool, (u) => u.cost);
        units.push(pick);
        budget -= pick.cost;
        spent += pick.cost;
      }
    };

    spendPhase(primary, Math.ceil(waveBudget * PRIMARY_SHARE));
    if (i + 1 >= pivotWave) spendPhase(secondary, Math.ceil(waveBudget * SECONDARY_SHARE));
    spendPhase(null, budget);

    waves.push({ units });
  }

  return hour === undefined ? { date, seed, theme, waves } : { date, seed, theme, hour, waves };
}
