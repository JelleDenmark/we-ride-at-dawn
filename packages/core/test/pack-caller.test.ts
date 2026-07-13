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

// Pack-Caller (issue #88): startOfBattle, buffs both adjacent rats (whichever
// exist) by +1/+1 PER other board rat sharing its own tribe tag ("runt").
// gutter-runt, pup, dawn-runt, dusk-runt, gnawer are all tagged "runt";
// press-kin and ward-weaver are deliberately left untagged, making them
// useful "no shared tribe" filler for the incoherent-board tests below.

describe('Pack-Caller (buffAdjacentByTribe, issue #88)', () => {
  it('scales the buff with the count of other same-tribe rats on the board', () => {
    // Exactly one other runt (gutter-runt) on the board -> +1/+1.
    const one = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'pack-caller' }),
      gauntletOf([dummy(0, 1)])
    ).events;
    const oneClash = one.findIndex((e) => e.type === 'clash');
    const oneBuffs = ofType(one.slice(0, oneClash), 'buff');
    expect(oneBuffs.length).toBe(1);
    expect(oneBuffs[0].attack).toBe(1);
    expect(oneBuffs[0].health).toBe(1);

    // Two other runts (gutter-runt + dawn-runt) on the board -> +2/+2 each.
    const two = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'pack-caller' }, { defId: 'dawn-runt' }),
      gauntletOf([dummy(0, 1)])
    ).events;
    const twoClash = two.findIndex((e) => e.type === 'clash');
    const twoBuffs = ofType(two.slice(0, twoClash), 'buff');
    expect(twoBuffs.length).toBe(2);
    expect(twoBuffs.every((b) => b.attack === 2 && b.health === 2)).toBe(true);

    // Three other runts -> +3/+3 each.
    const three = simulate(
      lineup(
        { defId: 'gutter-runt' },
        { defId: 'pack-caller' },
        { defId: 'dawn-runt' },
        { defId: 'dusk-runt' }
      ),
      gauntletOf([dummy(0, 1)])
    ).events;
    const threeClash = three.findIndex((e) => e.type === 'clash');
    const threeBuffs = ofType(three.slice(0, threeClash), 'buff');
    expect(threeBuffs.length).toBe(2);
    expect(threeBuffs.every((b) => b.attack === 3 && b.health === 3)).toBe(true);
  });

  it('grants no buff at all on an incoherent board with no shared tribe', () => {
    // dire-rat is tagged "brute" (not "runt") and bone-priest is untagged;
    // neither has a startOfBattle ability of its own that could add a
    // confounding buff event. Pack-Caller has zero other same-tribe rats to
    // count here — the effect should no-op entirely rather than buff for a
    // phantom "0 count".
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'pack-caller' }, { defId: 'bone-priest' }),
      gauntletOf([dummy(0, 1)])
    );
    const clashIdx = events.findIndex((e) => e.type === 'clash');
    const buffs = ofType(events.slice(0, clashIdx), 'buff');
    expect(buffs.length).toBe(0);
  });

  it('in the middle of a themed board, buffs both neighbors', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'pack-caller' }, { defId: 'dawn-runt' }),
      gauntletOf([dummy(0, 1)])
    );
    const clashIdx = events.findIndex((e) => e.type === 'clash');
    const buffs = ofType(events.slice(0, clashIdx), 'buff');
    expect(buffs.length).toBe(2);
    expect(buffs.every((b) => b.attack === 2 && b.health === 2)).toBe(true);
  });

  it('at an edge (front), buffs only the single neighbor behind it', () => {
    const { events } = simulate(
      lineup({ defId: 'pack-caller' }, { defId: 'gutter-runt' }, { defId: 'dawn-runt' }),
      gauntletOf([dummy(0, 1)])
    );
    const clashIdx = events.findIndex((e) => e.type === 'clash');
    const buffs = ofType(events.slice(0, clashIdx), 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(2);
    expect(buffs[0].health).toBe(2);
  });

  it('only fires once across many waves (startOfBattle, not startOfWave)', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'pack-caller' }, { defId: 'dawn-runt' }),
      gauntletOf([dummy(0, 1000)], [dummy(0, 1000)], [dummy(0, 1000)])
    );
    // Every wave clears (0-attack enemies), so Pack-Caller survives all 3
    // waves. If buffAdjacentByTribe re-fired per wave, this would show 6
    // buff events (2 per wave x 3 waves) instead of exactly 2.
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(2);
  });

  it('scales the count-based buff with tier on top of the count multiplier', () => {
    // t2 Pack-Caller with 2 other runts: count(2) * tierAttackMultiplier(2)=3 -> 6.
    const { events } = simulate(
      lineup(
        { defId: 'gutter-runt' },
        { defId: 'pack-caller', tier: 2 },
        { defId: 'dawn-runt' }
      ),
      gauntletOf([dummy(0, 1)])
    );
    const clashIdx = events.findIndex((e) => e.type === 'clash');
    const buffs = ofType(events.slice(0, clashIdx), 'buff');
    expect(buffs.length).toBe(2);
    expect(buffs.every((b) => b.attack === 6 && b.health === 6)).toBe(true);
  });
});
