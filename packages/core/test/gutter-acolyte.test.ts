// Gutter-Acolyte (issue #137): the roster's first enemy-STAT debuff — armor
// blunts hits and poison races health, but nothing lowered the incoming
// number itself before this. `startOfWave`-fired attack shred on the whole
// enemy line, floored at MIN_ATTACK_DAMAGE (enemies always hit for at least
// 1, mirroring the armor rule). Safe under ADR-0003 because enemies are
// re-instantiated fresh every wave — the shred can never carry across the
// ride, exactly like poisonAllEnemies.
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

describe('Gutter-Acolyte (issue #137: enemy attack shred)', () => {
  it('is wired as designed: startOfWave trigger, weakenAllEnemies effect', () => {
    const def = UNIT_DEFS['gutter-acolyte'];
    expect(def).toBeDefined();
    expect(def.ability?.trigger).toBe('startOfWave');
    expect(def.ability?.effect.kind).toBe('weakenAllEnemies');
  });

  it('saps 1 attack from the front enemy, and the softened swing actually lands softer', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-acolyte' }),
      gauntletOf([dummy(5, 30)])
    );
    const weakens = ofType(events, 'weaken');
    expect(weakens.length).toBe(1);
    expect(weakens[0].attack).toBe(1);
    expect(weakens[0].newAttack).toBe(4);
    // The Acolyte (no armor) then takes 4-damage hits, not 5s.
    const acolyteId = ofType(events, 'battleStart')[0].horde[0].instanceId;
    const onAcolyte = ofType(events, 'damage').filter((d) => d.targetId === acolyteId);
    expect(onAcolyte.length).toBeGreaterThan(0);
    expect(onAcolyte.every((d) => d.amount === 4)).toBe(true);
  });

  it('shreds the WHOLE enemy line, not just the front (the #112 dead-front lesson)', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-acolyte' }),
      gauntletOf([dummy(3, 30), dummy(4, 30), dummy(5, 30)])
    );
    const wave = ofType(events, 'waveStart')[0];
    const weakens = ofType(events, 'weaken');
    expect(weakens.length).toBe(3);
    expect(weakens.map((w) => w.targetId).sort()).toEqual(
      wave.enemies.map((e) => e.instanceId).sort()
    );
  });

  it('scales LINEARLY with tier (1/2/3), never the exponential curve', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-acolyte', tier: 2 }),
      gauntletOf([dummy(5, 30)])
    );
    const weakens = ofType(events, 'weaken');
    expect(weakens[0].attack).toBe(2);
    expect(weakens[0].newAttack).toBe(3);
  });

  it('enemies always keep at least 1 attack — the floor clips the shred, and reports the clipped amount', () => {
    // ★3 shreds 3, but a 2-attack enemy only has 1 to give above the floor.
    const { events } = simulate(
      lineup({ defId: 'gutter-acolyte', tier: 3 }),
      gauntletOf([dummy(2, 30)])
    );
    const weakens = ofType(events, 'weaken');
    expect(weakens.length).toBe(1);
    expect(weakens[0].attack).toBe(1); // post-floor actual, not the full 3
    expect(weakens[0].newAttack).toBe(1);
  });

  it('an enemy already at (or below) the floor is untouched — no event, no negative shred', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-acolyte' }),
      gauntletOf([dummy(1, 30), dummy(0, 30)])
    );
    expect(ofType(events, 'weaken').length).toBe(0);
  });

  it('a stack of Acolytes clips against the floor instead of zeroing a wave out', () => {
    const { events } = simulate(
      lineup(
        { defId: 'gutter-acolyte' },
        { defId: 'gutter-acolyte' },
        { defId: 'gutter-acolyte' },
        { defId: 'gutter-acolyte' }
      ),
      gauntletOf([dummy(3, 100)])
    );
    const weakens = ofType(events, 'weaken');
    // 3 attack, floor 1: only 2 points exist to shred — casters 3 and 4
    // fire into the floor and produce nothing.
    expect(weakens.length).toBe(2);
    expect(weakens.map((w) => w.newAttack)).toEqual([2, 1]);
  });

  it('re-applies to each fresh wave — and never carries: wave 2 starts at full attack again', () => {
    // Dire-Rat up front keeps the Acolyte alive into wave 2.
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'gutter-acolyte' }),
      gauntletOf([dummy(5, 1)], [dummy(5, 30)])
    );
    const weakens = ofType(events, 'weaken');
    expect(weakens.length).toBe(2);
    // Both shreds start from the SAME base 5 — proof nothing carried over.
    expect(weakens.every((w) => w.newAttack === 4)).toBe(true);
  });
});
