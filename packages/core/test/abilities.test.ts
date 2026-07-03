import { describe, expect, it } from 'vitest';
import { simulate, type BattleEvent } from '../src/sim';
import type { Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';
import { generateGauntlet } from '../src/gauntlet';
import { TEST_HORDE } from '../src/data/units';
import { fnv1a } from '../src/seed';

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

describe('unit abilities', () => {
  it('Plague-Bearer poisons the frontmost enemy at start of battle', () => {
    const { events } = simulate(lineup({ defId: 'plague-bearer' }), gauntletOf([dummy(0, 5)]));
    expect(ofType(events, 'poisonApplied').length).toBeGreaterThan(0);
    expect(ofType(events, 'poisonTick').length).toBeGreaterThan(0);
  });

  it('Blight-Witch stacks poison on the unit it hits', () => {
    const { events } = simulate(lineup({ defId: 'blight-witch' }), gauntletOf([dummy(0, 12)]));
    const applied = ofType(events, 'poisonApplied');
    expect(applied.length).toBeGreaterThanOrEqual(2);
    expect(applied[1].totalStacks).toBe(2);
  });

  it('Gnawer gives the rat behind it +2 attack on faint', () => {
    const { events } = simulate(
      lineup({ defId: 'gnawer' }, { defId: 'gutter-runt' }),
      gauntletOf([dummy(1, 50)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(2);
    expect(buffs[0].newAttack).toBe(3);
  });

  it('Corpse-Glutton grows +1/+1 whenever an ally faints', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'corpse-glutton' }),
      gauntletOf([dummy(1, 50)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBeGreaterThanOrEqual(1);
    expect(buffs[0].newAttack).toBe(4);
    expect(buffs[0].newHealth).toBe(3);
  });

  it('Bone-Priest revives the first fallen ally at 1 health', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'bone-priest' }),
      gauntletOf([dummy(2, 50)])
    );
    const revives = ofType(events, 'revive');
    expect(revives.length).toBe(1);
    expect(revives[0].unit.defId).toBe('gutter-runt');
    expect(revives[0].unit.health).toBe(1);
  });

  it('Warren-Warden buffs every rat behind it at start of battle', () => {
    const { events } = simulate(
      lineup({ defId: 'warren-warden' }, { defId: 'gutter-runt' }, { defId: 'dire-rat' }),
      gauntletOf([dummy(0, 1)])
    );
    const clashIdx = events.findIndex((e) => e.type === 'clash');
    const buffs = ofType(events.slice(0, clashIdx), 'buff');
    expect(buffs.length).toBe(2);
    expect(buffs.every((b) => b.attack === 1 && b.health === 1)).toBe(true);
  });

  it('Rat-Piper summons a Pup in front each wave', () => {
    const { events } = simulate(
      lineup({ defId: 'rat-piper' }),
      gauntletOf([dummy(0, 1)], [dummy(0, 1)])
    );
    const summons = ofType(events, 'summon');
    expect(summons.length).toBe(2);
    expect(summons.every((s) => s.unit.defId === 'pup')).toBe(true);
    expect(summons[0].index).toBe(0);
    expect(summons[1].index).toBe(1);
  });
});

describe('relics', () => {
  it('Rusted Nail adds +2 attack to the bearer', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt', relicIds: ['rusted-nail'] }),
      gauntletOf([dummy(0, 1)])
    );
    const start = ofType(events, 'battleStart')[0];
    expect(start.horde[0].attack).toBe(3);
  });

  it('Glass Shard adds +3 to the first hit only', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt', relicIds: ['glass-shard'] }),
      gauntletOf([dummy(0, 10)])
    );
    const hits = ofType(events, 'damage').filter((d) => d.amount > 0);
    expect(hits[0].amount).toBe(4);
    expect(hits[1].amount).toBe(1);
  });

  it('Weeping Boil damages all enemies when the bearer faints', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt', relicIds: ['weeping-boil'] }),
      gauntletOf([dummy(1, 1), dummy(0, 2), dummy(0, 3)])
    );
    expect(ofType(events, 'relicProc').some((p) => p.relicId === 'weeping-boil')).toBe(true);
    expect(ofType(events, 'death').length).toBe(3);
  });

  it('Fat Tick grants +1/+2 and heals 1 at the start of each tick', () => {
    const { events, result } = simulate(
      lineup({ defId: 'corpse-glutton', relicIds: ['fat-tick'] }),
      gauntletOf([dummy(1, 12)])
    );
    expect(ofType(events, 'heal').length).toBeGreaterThan(0);
    expect(result.wavesCleared).toBe(1);
  });

  it('Tail-Charm saves the bearer from one lethal hit', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt', relicIds: ['tail-charm'] }),
      gauntletOf([dummy(5, 100)])
    );
    const procs = ofType(events, 'relicProc').filter((p) => p.relicId === 'tail-charm');
    expect(procs.length).toBe(1);
    expect(ofType(events, 'clash').length).toBe(2);
    expect(ofType(events, 'death').length).toBe(1);
  });

  it('Filth Totem grants the whole horde +1 health, including summons', () => {
    const { events } = simulate(
      { units: [{ defId: 'rat-piper' }], teamRelicIds: ['filth-totem'] },
      gauntletOf([dummy(0, 1)])
    );
    const start = ofType(events, 'battleStart')[0];
    expect(start.horde[0].health).toBe(3);
    const summons = ofType(events, 'summon');
    expect(summons[0].unit.health).toBe(2);
  });
});

describe('wave carry-over', () => {
  it('survivors keep their damage between waves', () => {
    const { result } = simulate(
      lineup({ defId: 'dire-rat' }),
      gauntletOf([dummy(1, 1)], [dummy(1, 1)])
    );
    expect(result.wavesCleared).toBe(2);
    expect(result.survivors[0].health).toBe(3);
  });
});

describe('golden log regression', () => {
  it('the full showcase battle produces the pinned event-log hash', () => {
    const { events } = simulate(TEST_HORDE, generateGauntlet('2026-01-01'));
    expect(fnv1a(JSON.stringify(events))).toMatchInlineSnapshot(`1509703244`);
  });
});
