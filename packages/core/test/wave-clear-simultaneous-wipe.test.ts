// Regression test for the wave-clear crediting bug: damage for both sides
// resolves in the same tick before resolveDeaths() runs (batch resolution,
// not incremental), so the last horde unit and the last enemy can die on
// the exact same tick. Killing every enemy should always count as clearing
// that wave, even if the horde was wiped out in the process — the outer
// `for` loop's `horde.length > 0` guard is what correctly stops the run
// from continuing into the next wave, that's a separate concern from
// whether THIS wave's clear gets credited. See sim.ts around the
// `enemies.length === 0` wave-outcome check.
import { describe, expect, it } from 'vitest';
import { simulate, type BattleEvent } from '../src/sim';
import type { Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';
import { UNIT_DEFS } from '../src/data/units';

const gauntletOf = (...waves: UnitDef[][]): Gauntlet => ({
  date: 'test',
  seed: 0,
  waves: waves.map((units) => ({ units })),
});

const lineup = (...units: Lineup['units']): Lineup => ({ units });

const ofType = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

// A single-unit-vs-single-unit trade where both sides' attack exactly
// equals the other's health: on the very first clash tick, the horde unit's
// hit fells the enemy AND the enemy's hit fells the horde unit, in the same
// tick (both `applyDamage` calls happen before `resolveDeaths()` runs).
// That's the exact simultaneous-wipe scenario the bug was about.
const mutualKiller: UnitDef = {
  id: 'test-mutual-killer', name: 'Test Mutual Killer', attack: 5, health: 5, cost: 0,
};
UNIT_DEFS[mutualKiller.id] = mutualKiller;

const dummy = (attack: number, health: number): UnitDef => ({
  id: 'dummy-mutual-foe', name: 'Dummy Mutual Foe', attack, health, cost: 0,
});

describe('wave-clear credit on a simultaneous last-unit wipe', () => {
  it('counts the wave as cleared when the last horde unit and last enemy die on the same tick', () => {
    const { events, result } = simulate(
      lineup({ defId: 'test-mutual-killer' }),
      gauntletOf([dummy(5, 5)])
    );

    // Confirm the scenario actually produced a simultaneous wipe: both
    // sides are empty of survivors at battle end.
    expect(result.survivors).toHaveLength(0);

    // The wave must still be credited as cleared: killing every enemy is a
    // win for that wave regardless of whether the horde also died resolving it.
    expect(ofType(events, 'waveClear')).toHaveLength(1);
    expect(result.wavesCleared).toBe(1);
  });

  it('does not continue into a second wave once the horde is wiped, even though the first wave cleared', () => {
    // Two waves queued, but the horde dies clearing the first — the outer
    // loop's `horde.length > 0` guard must still stop the run before wave 2,
    // which is a separate concern from wave-1's clear credit.
    const { events, result } = simulate(
      lineup({ defId: 'test-mutual-killer' }),
      gauntletOf([dummy(5, 5)], [dummy(1, 1)])
    );

    expect(result.wavesCleared).toBe(1);
    expect(ofType(events, 'waveStart')).toHaveLength(1);
    expect(ofType(events, 'waveClear')).toHaveLength(1);
  });
});
