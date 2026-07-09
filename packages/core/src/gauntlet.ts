import { xorshift128, type Rng } from './prng';
import { dailySeed, fnv1a } from './seed';
import { seasonIdFor } from './shop';
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
 * gauntlets. Both the theme (archetype composition) AND the specific wave
 * composition (enemy picks) are derived from the *season* (the Monday that
 * starts the current 7-day expedition, via `seasonIdFor`), not the calendar
 * date — this is the fix for #41: a fixed roster was seeing up to an
 * 11-wave depth swing day-to-day purely from the gauntlet re-rolling every
 * date, even though nothing about the roster changed. Keying everything off
 * the season instead makes the WHOLE gauntlet byte-identical for every ride
 * across all 7 days of one expedition — full sameness, matching how #34
 * fully eliminated hour-to-hour variance within a day (not just dampened
 * it). It still varies week-to-week, since a new season means a new
 * `seasonIdFor` value.
 *
 * `hour` (absolute hour bucket) is legacy: #34 already removed every call
 * site that passes it, so this branch is unreachable in practice. Left
 * alone (harmless, trivially reversible) rather than deleted, per the
 * "minimal option" #34 itself took for the same kind of now-dead capability
 * in `App.svelte`. If ever revived, it should probably also key off the
 * season rather than the date, for consistency with the rest of this fix.
 */
export function generateGauntlet(date: string, day = 1, hour?: number): Gauntlet {
  const seasonSeed = dailySeed(seasonIdFor(date));
  const seed = seasonSeed;
  const themeRng = xorshift128(seasonSeed);

  const primary = ARCHETYPES[themeRng.int(ARCHETYPES.length)];
  const rest = ARCHETYPES.filter((a) => a !== primary);
  const secondary = rest[themeRng.int(rest.length)];
  const pivotWave = 4 + themeRng.int(4);
  const theme: GauntletTheme = { primary, secondary, pivotWave };

  // The base (hourless) gauntlet rolls its waves from a season-seeded
  // stream, independent of (but derived the same way as) the theme stream
  // above — so the whole 45-wave gauntlet is now identical for every day of
  // one expedition, not just the theme.
  const rng =
    hour === undefined
      ? xorshift128(fnv1a(`${seasonIdFor(date)}#waves`))
      : xorshift128(fnv1a(`${date}#ride#${hour}`));

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
