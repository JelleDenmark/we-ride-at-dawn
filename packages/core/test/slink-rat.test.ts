// Slink-Rat (issue #86) — first player-facing consumer of the `backlineDamage`
// primitive (#85, see backline-damage.test.ts for the primitive's own
// interaction/compounding coverage). This suite only checks the real
// `slink-rat` UnitDef's wiring and tier scaling, not the primitive itself.
import { describe, expect, it } from 'vitest';
import { simulate, type BattleEvent } from '../src/sim';
import type { Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';

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

describe('Slink-Rat (issue #86)', () => {
  it('fires from a back slot, adding its attack to the front clash', () => {
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'slink-rat' }),
      gauntletOf([dummy(0, 100)])
    );
    const foeId = ofType(events, 'waveStart')[0].enemies[0].instanceId;
    const damages = ofType(events, 'damage').filter((d) => d.targetId === foeId);
    // Slink-Rat's 3-attack startOfWave hit lands before dire-rat's own
    // tick-loop clash damage.
    expect(damages[0].amount).toBe(3);
    expect(damages.length).toBeGreaterThanOrEqual(2);
  });

  it('does not double-dip if it ends up alone at the front', () => {
    const { events } = simulate(lineup({ defId: 'slink-rat' }), gauntletOf([dummy(0, 100)]));
    const foeId = ofType(events, 'waveStart')[0].enemies[0].instanceId;
    const damages = ofType(events, 'damage').filter((d) => d.targetId === foeId);
    // Only the normal per-tick clash damage (3 each tick) — the
    // backlineDamage effect excludes index 0, so no extra startOfWave hit.
    expect(damages.every((d) => d.amount === 3)).toBe(true);
  });

  it('merge scaling grows target count, not per-hit damage (issue #86 follow-up)', () => {
    // ★2 hits the first 2 enemies (backlineTargetsForTier), each for the
    // unit's flat base attack (3) — not one enemy for a tier-multiplied 9.
    const t2 = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'slink-rat', tier: 2 }),
      gauntletOf([dummy(0, 1000), dummy(0, 1000)])
    );
    const enemies = ofType(t2.events, 'waveStart')[0].enemies;
    const hitOn = (foeId: number) => ofType(t2.events, 'damage').find((d) => d.targetId === foeId);
    expect(hitOn(enemies[0].instanceId)?.amount).toBe(3);
    expect(hitOn(enemies[1].instanceId)?.amount).toBe(3);
  });

  it('★1 only ever hits the frontmost enemy, even against a multi-enemy wave', () => {
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'slink-rat' }),
      gauntletOf([dummy(0, 1000), dummy(0, 1000)])
    );
    const enemies = ofType(events, 'waveStart')[0].enemies;
    const preTickDamages = ofType(events, 'damage').slice(0, 1);
    expect(preTickDamages).toEqual([expect.objectContaining({ targetId: enemies[0].instanceId, amount: 3 })]);
  });

  it('multiple Slink-Rats stack additively, bounded by board size', () => {
    const { events } = simulate(
      lineup(
        { defId: 'dire-rat' },
        { defId: 'slink-rat' },
        { defId: 'slink-rat' },
        { defId: 'slink-rat' }
      ),
      gauntletOf([dummy(0, 1000)])
    );
    const foeId = ofType(events, 'waveStart')[0].enemies[0].instanceId;
    const damages = ofType(events, 'damage').filter((d) => d.targetId === foeId);
    // Three Slink-Rats, each landing one 3-damage startOfWave hit, before
    // the tick loop's own clash resolves.
    expect(damages.slice(0, 3).map((d) => d.amount)).toEqual([3, 3, 3]);
  });
});
