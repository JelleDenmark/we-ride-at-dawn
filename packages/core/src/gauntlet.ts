import { xorshift128 } from './prng';
import { dailySeed } from './seed';
import { ENEMY_POOL } from './data/enemies';
import type { UnitDef } from './data/units';

export interface EnemyWave {
  units: UnitDef[];
}

export interface Gauntlet {
  date: string;
  seed: number;
  waves: EnemyWave[];
}

export const WAVE_COUNT = 12;
export const WAVE_BUDGET_BASE = 3;
export const WAVE_BUDGET_GROWTH = 2;
export const WAVE_UNIT_CAP = 5;

export function generateGauntlet(date: string): Gauntlet {
  const seed = dailySeed(date);
  const rng = xorshift128(seed);
  const waves: EnemyWave[] = [];

  for (let i = 0; i < WAVE_COUNT; i++) {
    let budget = WAVE_BUDGET_BASE + i * WAVE_BUDGET_GROWTH;
    const units: UnitDef[] = [];
    while (units.length < WAVE_UNIT_CAP) {
      const affordable = ENEMY_POOL.filter((u) => u.cost <= budget);
      if (affordable.length === 0) break;
      const pick = affordable[rng.int(affordable.length)];
      units.push(pick);
      budget -= pick.cost;
    }
    waves.push({ units });
  }

  return { date, seed, waves };
}
