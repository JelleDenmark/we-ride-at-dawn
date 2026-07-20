// Steel-Whisker (issue #134): thorns — the game's first on-hurt reaction.
// A new `onHurt` trigger fired from the clash tick when a blow actually
// LANDS on the front unit, reflecting a fixed `damage * tier` back at the
// attacker. Stateless by design (ADR-0003): a per-hit contribution against
// enemies that are re-instantiated every wave — the "gain stats when hurt"
// cousin is the forbidden shape, and the canary below pins that this unit
// never grows.
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

// The foe's instanceId from the first waveStart — reflect assertions read
// damage events landing on it.
const frontFoeId = (events: BattleEvent[]): number =>
  ofType(events, 'waveStart')[0].enemies[0].instanceId;

describe('Steel-Whisker (issue #134: onHurt thorns)', () => {
  it('is wired as designed: onHurt trigger, reflectDamage effect, light armor', () => {
    const def = UNIT_DEFS['steel-whisker'];
    expect(def).toBeDefined();
    expect(def.ability?.trigger).toBe('onHurt');
    expect(def.ability?.effect.kind).toBe('reflectDamage');
    expect(def.damageReduction).toBe(1);
  });

  it('cuts back for 2 on every clash blow that lands on it', () => {
    // Rusted Nail pushes the clash swing to 4 so the reflect's 2s are
    // unambiguous in the damage stream: each tick the foe takes [4 clash,
    // 2 reflect] until dead at 12 after two ticks.
    const { events } = simulate(
      lineup({ defId: 'steel-whisker', relicIds: ['rusted-nail'] }),
      gauntletOf([dummy(3, 12)])
    );
    const onFoe = ofType(events, 'damage').filter((d) => d.targetId === frontFoeId(events));
    expect(onFoe.map((d) => d.amount)).toEqual([4, 2, 4, 2]);
    expect(ofType(events, 'death').length).toBe(1);
  });

  it('reflect scales linearly with tier (2/4/6), never the exponential curve', () => {
    // ★2: clash swing 2*3=6, reflect 2*2=4 — distinct amounts, no relic
    // needed. Foe (5 attack) hits the ★2 whisker for max(1, 5 - armor 2)=3.
    const { events } = simulate(
      lineup({ defId: 'steel-whisker', tier: 2 }),
      gauntletOf([dummy(5, 10)])
    );
    const onFoe = ofType(events, 'damage').filter((d) => d.targetId === frontFoeId(events));
    expect(onFoe.map((d) => d.amount)).toEqual([6, 4]);
  });

  it("a Ward-Weaver-blocked hit draws no blood — absorbed blows don't reflect", () => {
    // Wave 1, tick 1: the whisker's incoming hit is absorbed (1 block
    // charge), so NO reflect fires — the foe takes only the 4-damage clash.
    // Tick 2: the pool is spent, the blow lands, and the 2-damage reflect
    // appears.
    const { events } = simulate(
      lineup(
        { defId: 'steel-whisker', relicIds: ['rusted-nail'] },
        { defId: 'ward-weaver' }
      ),
      gauntletOf([dummy(3, 100)])
    );
    expect(ofType(events, 'shieldAbsorbed').length).toBe(1);
    const clashes = ofType(events, 'clash');
    expect(clashes.length).toBeGreaterThanOrEqual(2);
    const foeId = frontFoeId(events);
    // Slice the event stream tick by tick: between clash 1 and clash 2 the
    // foe must see exactly one damage event (the clash hit, no reflect).
    const i1 = events.indexOf(clashes[0]);
    const i2 = events.indexOf(clashes[1]);
    const tick1OnFoe = ofType(events.slice(i1, i2), 'damage').filter((d) => d.targetId === foeId);
    expect(tick1OnFoe.map((d) => d.amount)).toEqual([4]);
    // From tick 2 on, the reflect's 2s show up.
    const laterOnFoe = ofType(events.slice(i2), 'damage').filter((d) => d.targetId === foeId);
    expect(laterOnFoe.some((d) => d.amount === 2)).toBe(true);
  });

  it('poison ticks are rot, not blows — they never trigger the reflect', () => {
    // A plague foe lands 1 poison per clash on top of its swing. The
    // whisker takes a clash blow AND a poison tick every tick, but reflects
    // once per tick only — reflect count tracks clash count, not total hurt
    // events.
    const poisoner: UnitDef = {
      id: 'poisoner', name: 'Poisoner', attack: 3, health: 30, cost: 0,
      ability: { trigger: 'afterAttack', effect: { kind: 'poisonTarget', stacks: 1 } },
    };
    const { events } = simulate(
      lineup({ defId: 'steel-whisker', relicIds: ['rusted-nail'] }),
      gauntletOf([poisoner])
    );
    const foeId = frontFoeId(events);
    const reflects = ofType(events, 'damage').filter((d) => d.targetId === foeId && d.amount === 2);
    const clashes = ofType(events, 'clash');
    const poisonTicks = ofType(events, 'poisonTick');
    expect(poisonTicks.length).toBeGreaterThan(0);
    expect(reflects.length).toBe(clashes.length);
  });

  it("the attacker's own armor blunts the reflect, floored at 1", () => {
    const armored: UnitDef = {
      id: 'armored', name: 'Armored', attack: 3, health: 30, cost: 0, damageReduction: 5,
    };
    const { events } = simulate(
      lineup({ defId: 'steel-whisker' }),
      gauntletOf([armored])
    );
    // Every hit on the armored foe — the 2-attack clash and the 2-damage
    // reflect alike — is blunted to the 1-damage floor.
    const onFoe = ofType(events, 'damage').filter((d) => d.targetId === frontFoeId(events));
    expect(onFoe.length).toBeGreaterThan(0);
    expect(onFoe.every((d) => d.amount === 1)).toBe(true);
  });

  it('GAIN-ON-HURT canary: thorns is stateless — the whisker never grows from being hit', () => {
    // "When hurt, gain stats" on the front slot is an unbounded per-tick
    // snowball (worse than the Warren-Warden incident) — the issue forbids
    // it. Pin that all those reflected hits never buff the whisker.
    const { events, result } = simulate(
      lineup({ defId: 'steel-whisker' }),
      gauntletOf(...Array.from({ length: 5 }, () => [dummy(1, 1)]))
    );
    expect(ofType(events, 'buff').length).toBe(0);
    const whisker = result.survivors.find((u) => u.defId === 'steel-whisker');
    expect(whisker?.attack).toBe(UNIT_DEFS['steel-whisker'].attack);
  });
});
