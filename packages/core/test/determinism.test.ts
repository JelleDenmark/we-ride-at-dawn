import { describe, expect, it } from 'vitest';
import { dailySeed, currentRideDate } from '../src/seed';
import { xorshift128 } from '../src/prng';
import { generateGauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import { TEST_HORDE } from '../src/data/units';

describe('seed derivation', () => {
  it('is stable across runs (fixed FNV-1a)', () => {
    expect(dailySeed('2026-07-03')).toBe(dailySeed('2026-07-03'));
    expect(dailySeed('2026-07-03')).not.toBe(dailySeed('2026-07-04'));
  });

  it('flips the ride-day at 06:00 Copenhagen time', () => {
    expect(currentRideDate(new Date('2026-07-03T03:59:00+02:00'))).toBe('2026-07-02');
    expect(currentRideDate(new Date('2026-07-03T06:01:00+02:00'))).toBe('2026-07-03');
  });
});

describe('prng', () => {
  it('same seed yields identical sequences', () => {
    const a = xorshift128(12345);
    const b = xorshift128(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('different seeds diverge', () => {
    const a = xorshift128(1);
    const b = xorshift128(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });
});

describe('gauntlet generation', () => {
  it('is deterministic for a given date', () => {
    expect(generateGauntlet('2026-07-03')).toEqual(generateGauntlet('2026-07-03'));
  });

  it('differs between dates', () => {
    expect(JSON.stringify(generateGauntlet('2026-07-03'))).not.toBe(
      JSON.stringify(generateGauntlet('2026-07-04'))
    );
  });

  it('escalates: later waves cost at least as much as early ones', () => {
    const g = generateGauntlet('2026-07-03');
    const waveCost = (i: number) => g.waves[i].units.reduce((s, u) => s + u.cost, 0);
    expect(waveCost(g.waves.length - 1)).toBeGreaterThan(waveCost(0));
  });
});

describe('gauntlet stability', () => {
  it('gauntlets are unchanged by day (golden compatibility)', () => {
    const g = generateGauntlet('2026-07-03');
    expect(g.hour).toBeUndefined();
    expect(g.theme).toEqual({ primary: 'swarm', secondary: 'armored', pivotWave: 5 });
  });
});

describe('battle sim', () => {
  const gauntlet = generateGauntlet('2026-07-03');

  it('same input produces a byte-identical event log', () => {
    const a = simulate(TEST_HORDE, gauntlet);
    const b = simulate(TEST_HORDE, gauntlet);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.result).toEqual(b.result);
  });

  it('does not mutate its inputs', () => {
    const lineupBefore = JSON.stringify(TEST_HORDE);
    const gauntletBefore = JSON.stringify(gauntlet);
    simulate(TEST_HORDE, gauntlet);
    expect(JSON.stringify(TEST_HORDE)).toBe(lineupBefore);
    expect(JSON.stringify(gauntlet)).toBe(gauntletBefore);
  });

  it('emits a well-formed log: starts, fights, ends', () => {
    const { events, result } = simulate(TEST_HORDE, gauntlet);
    expect(events[0].type).toBe('battleStart');
    expect(events.at(-1)?.type).toBe('battleEnd');
    expect(events.some((e) => e.type === 'clash')).toBe(true);
    expect(events.some((e) => e.type === 'death')).toBe(true);
    expect(result.wavesCleared).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeGreaterThanOrEqual(result.wavesCleared * 100);
  });

  it('fires the milestone-1 abilities (summons and faint-buffs appear)', () => {
    const { events } = simulate(TEST_HORDE, gauntlet);
    expect(events.some((e) => e.type === 'summon')).toBe(true);
    expect(events.some((e) => e.type === 'buff')).toBe(true);
  });
});
