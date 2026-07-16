import { describe, expect, it } from 'vitest';
import { simulate, type BattleEvent } from '../src/sim';
import type { Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';

const dummy = (attack: number, health: number): UnitDef => ({
  id: 'dummy',
  name: 'Dummy',
  attack,
  health,
  cost: 0,
});

const gauntletOf = (...waves: UnitDef[][]): Gauntlet => ({
  date: 'test',
  seed: 0,
  waves: waves.map((units) => ({ units })),
});

const lineup = (...units: Lineup['units']): Lineup => ({ units });

const ofType = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

// Pack-Caller (issue #88, reworked 2026-07-16): `faint`-triggered, gives away
// its own base (tier-scaled) attack/health split evenly across every other
// living teammate, remainder going one point each to the frontmost survivors.
// `pup` (attack 1 / health 1 / cost 0) has no ability of its own — clean
// filler so its only `buff` events come from Pack-Caller's death payout.
// Pack-Caller is placed at the front (index 0) against a `dummy(50, 1)`
// enemy — same one-shot-both-ways idiom `abilities.test.ts` uses for
// Gnawer's `bequeathAttack` — so it faints deterministically on wave 1.

describe('Pack-Caller (distributeStatsOnFaint, issue #88 rework)', () => {
  it('splits its own base attack/health evenly, remainder to the frontmost survivor', () => {
    // t1 Pack-Caller: attack 2, health 3. Two pup survivors: 2/2=1r0 attack,
    // 3/2=1r1 health — the front pup (board index 0 after removal) gets the
    // spare health point, the back pup does not.
    const { events } = simulate(
      lineup({ defId: 'pack-caller' }, { defId: 'pup' }, { defId: 'pup' }),
      gauntletOf([dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(2);
    expect(buffs[0].attack).toBe(1);
    expect(buffs[0].health).toBe(2);
    expect(buffs[1].attack).toBe(1);
    expect(buffs[1].health).toBe(1);
    // Full total distributed, nothing lost to rounding.
    const totalAttack = buffs.reduce((s, b) => s + b.attack, 0);
    const totalHealth = buffs.reduce((s, b) => s + b.health, 0);
    expect(totalAttack).toBe(2);
    expect(totalHealth).toBe(3);
  });

  it('spreads a multi-point remainder across multiple frontmost survivors', () => {
    // t1 Pack-Caller: attack 2, health 3. Three pup survivors: 2/3=0r2
    // attack (front two get +1 each, third gets 0), 3/3=1r0 health (everyone
    // gets exactly 1, no remainder).
    const { events } = simulate(
      lineup({ defId: 'pack-caller' }, { defId: 'pup' }, { defId: 'pup' }, { defId: 'pup' }),
      gauntletOf([dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(3);
    expect(buffs.map((b) => b.attack)).toEqual([1, 1, 0]);
    expect(buffs.every((b) => b.health === 1)).toBe(true);
    expect(buffs.reduce((s, b) => s + b.attack, 0)).toBe(2);
    expect(buffs.reduce((s, b) => s + b.health, 0)).toBe(3);
  });

  it('scales the payout with tier via the same base-stat curve as its own body', () => {
    // t2 Pack-Caller: attack 2*3=6, health 3*3=9. Two pup survivors:
    // 6/2=3r0 attack, 9/2=4r1 health — front pup gets the spare health point.
    const { events } = simulate(
      lineup({ defId: 'pack-caller', tier: 2 }, { defId: 'pup' }, { defId: 'pup' }),
      gauntletOf([dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(2);
    expect(buffs[0].attack).toBe(3);
    expect(buffs[0].health).toBe(5);
    expect(buffs[1].attack).toBe(3);
    expect(buffs[1].health).toBe(4);
  });

  it('in the last slot with nobody left, the payout evaporates — no crash', () => {
    const { events, result } = simulate(lineup({ defId: 'pack-caller' }), gauntletOf([dummy(50, 100)]));
    expect(ofType(events, 'buff').length).toBe(0);
    expect(ofType(events, 'death').length).toBe(1);
    expect(result.survivors.length).toBe(0);
  });

  it('only pays out once — a unit only faints once, so there is no per-wave re-stacking risk', () => {
    // Two harmless filler waves (0-attack, 0-health enemies clear instantly,
    // same idiom abilities.test.ts uses for Gnawer's wave-died-on tests)
    // pass for free, then Pack-Caller dies to the third. Exactly one payout.
    const { events } = simulate(
      lineup({ defId: 'pack-caller' }, { defId: 'pup' }),
      gauntletOf([dummy(0, 0)], [dummy(0, 0)], [dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(2);
    expect(buffs[0].health).toBe(3);
  });
});
