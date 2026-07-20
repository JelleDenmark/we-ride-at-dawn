// Squeak-Sensei (issue #133): the swarm archetype's first payoff — a new
// `allySummoned` trigger fired from the summon resolution path, buffing the
// NEWLY-SUMMONED body only. The targeting IS the compounding-law safety
// (ADR-0003): a fresh instance is buffed exactly once at birth, so nothing
// accumulates on any persistent unit no matter how many of the 45 waves a
// feeder keeps summoning. The "dangerous variant" tests below pin that the
// Sensei itself never grows.
import { describe, expect, it } from 'vitest';
import { simulate, type BattleEvent } from '../src/sim';
import type { Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';
import { UNIT_DEFS } from '../src/data/units';

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

describe('Squeak-Sensei (issue #133: allySummoned swarm payoff)', () => {
  it('is wired as designed: allySummoned trigger, buffSummoned effect', () => {
    const def = UNIT_DEFS['squeak-sensei'];
    expect(def).toBeDefined();
    expect(def.ability?.trigger).toBe('allySummoned');
    expect(def.ability?.effect.kind).toBe('buffSummoned');
  });

  it('trains each pup Rat-Piper pipes in: the newcomer arrives at +1/+1', () => {
    const { events } = simulate(
      lineup({ defId: 'rat-piper' }, { defId: 'squeak-sensei' }),
      gauntletOf([dummy(0, 100)])
    );
    const summons = ofType(events, 'summon');
    expect(summons.length).toBe(1);
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].targetId).toBe(summons[0].unit.instanceId);
    // Pup base 1/1 + the Sensei's +1/+1.
    expect(buffs[0].newAttack).toBe(2);
    expect(buffs[0].newHealth).toBe(2);
  });

  it("trains Brood-Mother's whole faint-litter, one buff per body", () => {
    // Brood-Mother (front) dies to the opening clash and births 2 pups;
    // each gets its own training buff as it lands.
    const { events } = simulate(
      lineup({ defId: 'brood-mother' }, { defId: 'squeak-sensei' }),
      gauntletOf([dummy(50, 100)])
    );
    const summons = ofType(events, 'summon');
    expect(summons.length).toBe(2);
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(2);
    const summonedIds = summons.map((s) => s.unit.instanceId);
    expect(buffs.map((b) => b.targetId).sort()).toEqual(summonedIds.sort());
  });

  it('scales LINEARLY with tier (1/2/3), never the exponential buff curve', () => {
    // A repeating trigger must not get 3^(tier-1) — see the Effect's doc
    // comment. ★2 trains +2/+2, not +3/+3.
    const { events } = simulate(
      lineup({ defId: 'rat-piper' }, { defId: 'squeak-sensei', tier: 2 }),
      gauntletOf([dummy(0, 100)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(2);
    expect(buffs[0].health).toBe(2);
  });

  it('the buff count tracks the SUMMON count across waves — one per newcomer, never more', () => {
    const waves = 6;
    const { events } = simulate(
      lineup({ defId: 'rat-piper' }, { defId: 'squeak-sensei' }),
      gauntletOf(...Array.from({ length: waves }, () => [dummy(0, 1)]))
    );
    const summons = ofType(events, 'summon');
    const buffs = ofType(events, 'buff');
    expect(summons.length).toBeGreaterThan(1); // Rat-Piper pipes every wave
    expect(buffs.length).toBe(summons.length);
  });

  it('DANGEROUS-VARIANT canary: the Sensei itself never gains a point from all that summoning', () => {
    // Buffing the summoner (or any persistent unit) per summon is the exact
    // Warren-Warden compounding shape the issue forbids without a hard cap.
    // The Sensei's own stats must stay at base across a long feeder grind.
    const { events, result } = simulate(
      lineup({ defId: 'rat-piper' }, { defId: 'squeak-sensei' }),
      gauntletOf(...Array.from({ length: 10 }, () => [dummy(0, 1)]))
    );
    const senseiId = ofType(events, 'battleStart')[0].horde.find((u) => u.defId === 'squeak-sensei')!
      .instanceId;
    expect(ofType(events, 'buff').some((b) => b.targetId === senseiId)).toBe(false);
    const sensei = result.survivors.find((u) => u.defId === 'squeak-sensei');
    expect(sensei?.attack).toBe(UNIT_DEFS['squeak-sensei'].attack);
  });

  it('a revive is a raising, not a summoning — the Sensei does not train the risen', () => {
    // Dire-Rat falls, Bone-Priest falls and raises it: one revive, zero
    // summons, and therefore zero training buffs.
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'bone-priest' }, { defId: 'squeak-sensei' }),
      gauntletOf([dummy(50, 100)])
    );
    expect(ofType(events, 'revive').length).toBe(1);
    expect(ofType(events, 'summon').length).toBe(0);
    expect(ofType(events, 'buff').length).toBe(0);
  });

  it('a Sensei alone does nothing — no feeder, no payoff (not a hidden stat stick)', () => {
    const { events } = simulate(
      lineup({ defId: 'squeak-sensei' }),
      gauntletOf([dummy(0, 100)])
    );
    expect(ofType(events, 'buff').length).toBe(0);
  });
});
