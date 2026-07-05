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

export const WAVE_COUNT = 12;
export const WAVE_BUDGET_BASE = 3;
export const WAVE_BUDGET_GROWTH = 2;
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

/** Difficulty multiplier for a given expedition day (day 1 = baseline). */
export function difficultyForDay(day: number): number {
  return 1 + (day - 1) * 0.35;
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
    const waveBudget = Math.round((WAVE_BUDGET_BASE + i * WAVE_BUDGET_GROWTH) * scale);
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
