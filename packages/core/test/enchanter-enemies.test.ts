// Enchanter/support enemy wing (issue #138): Muster-Herald (rally,
// enemy-side teamBuff) and Sluice-Warden (enemy-side blockFrontHits) — the
// pool's first BUFFERS, both reusing existing Effect kinds (ADR-0004). Plus
// the two gauntlet-generation levers the issue specifies: the `minWave`
// hard floor in the pool filter, and the `rearguard` reorder that parks
// supports behind the wall after a wave is rolled.
import { describe, expect, it } from 'vitest';
import { simulate, type BattleEvent } from '../src/sim';
import { generateGauntlet, WAVE_COUNT, type Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';
import { ENEMY_POOL } from '../src/data/enemies';

const dummy = (attack: number, health: number): UnitDef => ({
  id: 'dummy', name: 'Dummy', attack, health, cost: 0,
});

const gauntletOf = (...waves: UnitDef[][]): Gauntlet => ({
  date: 'test',
  seed: 0,
  waves: waves.map((units) => ({ units })),
});

const lineup = (...units: Lineup['units']): Lineup => ({ units });

const ofType = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

const byId = (id: string): UnitDef => {
  const def = ENEMY_POOL.find((e) => e.id === id);
  if (!def) throw new Error(`missing enemy def: ${id}`);
  return def;
};

describe('Muster-Herald (enemy rally)', () => {
  it('buffs its whole wave — every enemy body, itself included, +1/+1', () => {
    const herald = byId('muster-herald');
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }),
      gauntletOf([byId('watch-whelp'), byId('gutter-watch'), herald])
    );
    const wave = ofType(events, 'waveStart')[0];
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(3);
    expect(buffs.map((b) => b.targetId).sort()).toEqual(
      wave.enemies.map((e) => e.instanceId).sort()
    );
    expect(buffs.every((b) => b.attack === 1 && b.health === 1)).toBe(true);
  });

  it('fires fresh every wave (re-instantiated enemies), bounded within each — never a cross-wave snowball', () => {
    const herald = byId('muster-herald');
    const { events } = simulate(
      lineup({ defId: 'dire-rat', tier: 3 }),
      gauntletOf([byId('watch-whelp'), herald], [byId('watch-whelp'), herald])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(4); // 2 bodies × 2 waves — flat per wave, no growth
    // Every buffed enemy ends at base+1, wave 2 included: nothing carried.
    expect(buffs.every((b) => b.attack === 1 && b.health === 1)).toBe(true);
  });
});

describe('Sluice-Warden (enemy shield)', () => {
  it("no-sells the horde's opening hit: the enemy front absorbs it, taking no damage that tick", () => {
    const warden = byId('sluice-warden');
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }),
      gauntletOf([warden])
    );
    const wardenId = ofType(events, 'waveStart')[0].enemies[0].instanceId;
    const absorbed = ofType(events, 'shieldAbsorbed').filter((e) => e.targetId === wardenId);
    expect(absorbed.length).toBe(1); // tier-1 pool: exactly one blocked hit
    // The first damage the warden actually takes comes strictly after the absorb.
    const firstAbsorbIdx = events.indexOf(absorbed[0]);
    const firstDamageIdx = events.findIndex(
      (e) => e.type === 'damage' && e.targetId === wardenId
    );
    expect(firstDamageIdx).toBeGreaterThan(firstAbsorbIdx);
  });

  it('shields whichever enemy is currently front, exactly like the horde-side Ward-Weaver kit', () => {
    // Warden parked at the back (its shipped rearguard placement): the pool
    // still protects the front body, not the warden itself.
    const warden = byId('sluice-warden');
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }),
      gauntletOf([byId('grate-golem'), warden])
    );
    const frontId = ofType(events, 'waveStart')[0].enemies[0].instanceId;
    const absorbed = ofType(events, 'shieldAbsorbed');
    expect(absorbed.length).toBe(1);
    expect(absorbed[0].targetId).toBe(frontId);
  });
});

describe('gauntlet gating & placement (issue #138)', () => {
  const supports = ENEMY_POOL.filter((e) => e.rearguard);
  const supportIds = new Set(supports.map((e) => e.id));

  it('covers both shipped supports (guards against a vacuous suite)', () => {
    expect(supports.map((e) => e.id).sort()).toEqual(['muster-herald', 'sluice-warden']);
    expect(supports.every((e) => e.minWave !== undefined)).toBe(true);
  });

  // A handful of season seeds — the gate is deterministic, but the pool
  // roll is seeded per season, so sweep several to make the assertion mean
  // something beyond one lucky week.
  const dates = ['2026-01-01', '2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10'];

  it('no support enemy ever musters before its minWave — the hard floor holds for every wave of every sweep', () => {
    for (const date of dates) {
      const gauntlet = generateGauntlet(date);
      expect(gauntlet.waves.length).toBe(WAVE_COUNT);
      gauntlet.waves.forEach((wave, i) => {
        for (const u of wave.units) {
          if (u.minWave !== undefined) {
            expect(i + 1, `${u.id} appeared on wave ${i + 1} (${date})`).toBeGreaterThanOrEqual(
              u.minWave
            );
          }
        }
      });
    }
  });

  it('every rolled support sits at the BACK of its wave — never in the clash slot with bodies left to hide behind', () => {
    for (const date of dates) {
      const gauntlet = generateGauntlet(date);
      for (const wave of gauntlet.waves) {
        const firstSupport = wave.units.findIndex((u) => supportIds.has(u.id));
        if (firstSupport === -1) continue;
        // From the first support onward, everything must be a support —
        // i.e. all non-supports come first, stable partition.
        expect(wave.units.slice(firstSupport).every((u) => supportIds.has(u.id))).toBe(true);
      }
    }
  });

  it('at most ONE support musters per wave — cost-weighted picks would otherwise flood deep waves', () => {
    // weightedPick weights BY cost, so once affordable a cost-8 enchanter
    // is the likeliest pick, not a rare one (an uncapped sweep rolled 4
    // Sluice-Wardens into one wave). One protected support is the design.
    for (const date of dates) {
      const gauntlet = generateGauntlet(date);
      for (const wave of gauntlet.waves) {
        expect(wave.units.filter((u) => u.rearguard).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('supports do actually appear somewhere in the deep waves (the wing is not silently gated out)', () => {
    // Sweep the dates: at least one generated gauntlet should field at
    // least one enchanter past its floor — if none ever roll, the cost is
    // too high for the budget curve and the wing shipped dead.
    const seen = dates.some((date) =>
      generateGauntlet(date).waves.some((w) => w.units.some((u) => supportIds.has(u.id)))
    );
    expect(seen).toBe(true);
  });
});
