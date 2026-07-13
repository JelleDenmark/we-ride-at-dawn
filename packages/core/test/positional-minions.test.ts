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

describe('Press-Kin (buffAdjacent)', () => {
  it('at the front, buffs only the rat behind it', () => {
    const { events } = simulate(
      lineup({ defId: 'press-kin' }, { defId: 'gutter-runt' }),
      gauntletOf([dummy(0, 1)])
    );
    const clashIdx = events.findIndex((e) => e.type === 'clash');
    const buffs = ofType(events.slice(0, clashIdx), 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(2);
    expect(buffs[0].health).toBe(2);
  });

  it('at the back, buffs only the rat in front of it', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'press-kin' }),
      gauntletOf([dummy(0, 1)])
    );
    const clashIdx = events.findIndex((e) => e.type === 'clash');
    const buffs = ofType(events.slice(0, clashIdx), 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(2);
    expect(buffs[0].health).toBe(2);
  });

  it('in the middle, buffs both neighbors — the whole point of the unit', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'press-kin' }, { defId: 'dire-rat' }),
      gauntletOf([dummy(0, 1)])
    );
    const clashIdx = events.findIndex((e) => e.type === 'clash');
    const buffs = ofType(events.slice(0, clashIdx), 'buff');
    expect(buffs.length).toBe(2);
    expect(buffs.every((b) => b.attack === 2 && b.health === 2)).toBe(true);
  });

  it('only fires once across many waves (startOfBattle, not startOfWave)', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'press-kin' }, { defId: 'dire-rat' }),
      gauntletOf([dummy(0, 1000)], [dummy(0, 1000)], [dummy(0, 1000)])
    );
    // Every wave clears (enemies have 0 attack), so Press-Kin survives all 3
    // waves. If buffAdjacent re-fired per wave it would show up 3x here.
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(2);
  });
});

describe('Ward-Weaver (blockFrontHits, issue #56)', () => {
  // dire-rat: attack 4, health 5, armor 2. Enemy attack 1 -> blunted to the
  // MIN_ATTACK_DAMAGE floor of 1 per hit (1 - 2 armor clamps up to 1), so
  // dire-rat survives long enough (1000hp enemy behind it) to observe many
  // ticks without either side dying mid-wave.

  it('t1 blocks exactly the first 1 hit of the wave, no more', () => {
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver', tier: 1 }),
      gauntletOf([dummy(1, 1000)])
    );
    const absorbed = ofType(events, 'shieldAbsorbed');
    const battleStart = events.find((e): e is Extract<BattleEvent, { type: 'battleStart' }> => e.type === 'battleStart')!;
    const frontId = battleStart.horde[0].instanceId;
    const absorbedForFront = absorbed.filter((e) => e.targetId === frontId);
    expect(absorbedForFront.length).toBe(1);
    // It's the very first hit of the wave that's blocked, not a later one.
    const firstDamageToFront = ofType(events, 'damage').find((d) => d.targetId === frontId);
    const firstAbsorbToFront = absorbedForFront[0];
    expect(events.indexOf(firstAbsorbToFront)).toBeLessThan(events.indexOf(firstDamageToFront!));
  });

  it('t2 blocks exactly the first 2 hits of the wave, no more', () => {
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver', tier: 2 }),
      gauntletOf([dummy(1, 1000)])
    );
    const battleStart = events.find((e): e is Extract<BattleEvent, { type: 'battleStart' }> => e.type === 'battleStart')!;
    const frontId = battleStart.horde[0].instanceId;
    const absorbedForFront = ofType(events, 'shieldAbsorbed').filter((e) => e.targetId === frontId);
    expect(absorbedForFront.length).toBe(2);
  });

  it('t3 blocks exactly the first 3 hits of the wave, no more', () => {
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver', tier: 3 }),
      gauntletOf([dummy(1, 1000)])
    );
    const battleStart = events.find((e): e is Extract<BattleEvent, { type: 'battleStart' }> => e.type === 'battleStart')!;
    const frontId = battleStart.horde[0].instanceId;
    const absorbedForFront = ofType(events, 'shieldAbsorbed').filter((e) => e.targetId === frontId);
    expect(absorbedForFront.length).toBe(3);
  });

  it('charges reset every wave — they do not carry over or accumulate', () => {
    // 3 separate waves, each with a fresh 5hp enemy: dire-rat's attack (4)
    // kills it in exactly 2 ticks, so each wave clears cleanly after
    // exactly 2 ticks — enough for a t2 Ward-Weaver's 2 charges to be fully
    // spent (and no more) every single wave, with a fresh enemy re-arming
    // the test for the next wave. If charges carried over or accumulated,
    // some wave would show a count other than exactly 2.
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver', tier: 2 }),
      gauntletOf([dummy(1, 5)], [dummy(1, 5)], [dummy(1, 5)])
    );
    const waveStarts = ofType(events, 'waveStart');
    expect(waveStarts.length).toBe(3);
    for (let w = 0; w < 3; w++) {
      const start = events.indexOf(waveStarts[w]);
      const end = w + 1 < 3 ? events.indexOf(waveStarts[w + 1]) : events.length;
      const absorbedThisWave = ofType(events, 'shieldAbsorbed').filter((e) => {
        const idx = events.indexOf(e);
        return idx >= start && idx < end;
      });
      expect(absorbedThisWave.length).toBe(2);
    }
  });

  it('does NOT stack additively: two t3 Ward-Weavers together still only block 3 hits, not 6', () => {
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver', tier: 3 }, { defId: 'ward-weaver', tier: 3 }),
      gauntletOf([dummy(1, 1000)])
    );
    const battleStart = events.find((e): e is Extract<BattleEvent, { type: 'battleStart' }> => e.type === 'battleStart')!;
    const frontId = battleStart.horde[0].instanceId;
    const absorbedForFront = ofType(events, 'shieldAbsorbed').filter((e) => e.targetId === frontId);
    expect(absorbedForFront.length).toBe(3);
  });

  it('mixed tiers use MAX, not sum: one t1 + one t3 Ward-Weaver together still only block 3 hits', () => {
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver', tier: 1 }, { defId: 'ward-weaver', tier: 3 }),
      gauntletOf([dummy(1, 1000)])
    );
    const battleStart = events.find((e): e is Extract<BattleEvent, { type: 'battleStart' }> => e.type === 'battleStart')!;
    const frontId = battleStart.horde[0].instanceId;
    const absorbedForFront = ofType(events, 'shieldAbsorbed').filter((e) => e.targetId === frontId);
    expect(absorbedForFront.length).toBe(3);
  });

  it('protects whichever unit is currently front, not the Ward-Weaver itself', () => {
    // Ward-Weaver sits behind the front-line gutter-runt. The block must
    // land on gutter-runt (index 0), never on the Ward-Weaver's own
    // instance — it watches the front, it doesn't shield itself.
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'ward-weaver', tier: 2 }),
      gauntletOf([dummy(3, 1000)])
    );
    const battleStart = events.find((e): e is Extract<BattleEvent, { type: 'battleStart' }> => e.type === 'battleStart')!;
    const gutterRuntId = battleStart.horde[0].instanceId;
    const wardWeaverId = battleStart.horde[1].instanceId;
    const absorbed = ofType(events, 'shieldAbsorbed');
    expect(absorbed.length).toBe(2);
    expect(absorbed.every((e) => e.targetId === gutterRuntId)).toBe(true);
    expect(absorbed.some((e) => e.targetId === wardWeaverId)).toBe(false);
  });

  it('a fully-blocked hit resolves before Tail-Charm — it does not consume the charm', () => {
    // bone-priest: attack 1, health 4. Enemy attack 1 (unblocked) would chip
    // it 4 -> 3 -> 2 -> 1 -> dead across 4 ticks, but t1 Ward-Weaver blocks
    // the wave's first hit outright, so bone-priest only takes 3 real hits
    // this wave and survives at 1 health, never touching Tail-Charm.
    const { events } = simulate(
      lineup({ defId: 'bone-priest', relicIds: ['tail-charm'] }, { defId: 'ward-weaver', tier: 1 }),
      gauntletOf([dummy(1, 4)])
    );
    const absorbed = ofType(events, 'shieldAbsorbed');
    expect(absorbed.length).toBeGreaterThanOrEqual(1);
    const tailCharmProcs = ofType(events, 'relicProc').filter((e) => e.relicId === 'tail-charm');
    expect(tailCharmProcs.length).toBe(0);
  });
});

describe('Blight-Witch (poisonAllEnemies, issue #62)', () => {
  it('poisons every enemy in the wave at wave start, not just the front one', () => {
    // A single wave with TWO enemies — the key new property is whole-wave
    // AoE, not just "the front enemy" like the old poisonTarget behavior.
    const { events } = simulate(
      lineup({ defId: 'blight-witch' }),
      gauntletOf([dummy(0, 12), dummy(0, 12)])
    );
    const waveStart = events.find((e): e is Extract<BattleEvent, { type: 'waveStart' }> => e.type === 'waveStart')!;
    const enemyIds = waveStart.enemies.map((e) => e.instanceId);
    expect(enemyIds.length).toBe(2);
    const applied = ofType(events, 'poisonApplied');
    expect(applied.length).toBe(2);
    expect(new Set(applied.map((e) => e.targetId))).toEqual(new Set(enemyIds));
    expect(applied.every((e) => e.totalStacks === 1)).toBe(true);
  });

  it('fires from any board slot — a back-line Blight-Witch still poisons (fixes the old afterAttack dead zone)', () => {
    // Old mechanic (afterAttack) only ever fired for whichever unit was
    // currently front, so a back-line Blight-Witch never got a turn. It's
    // now startOfWave, which fireEntryTriggers runs for every unit
    // regardless of board position.
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'blight-witch' }),
      gauntletOf([dummy(0, 12)])
    );
    const applied = ofType(events, 'poisonApplied');
    expect(applied.length).toBeGreaterThan(0);
  });

  it('fires once at wave start, not repeatedly on every attack tick', () => {
    // High-health, 0-attack enemy means many ticks pass before the wave
    // clears. If poisonAllEnemies still fired per-tick (the old afterAttack
    // shape), this would show many poisonApplied events instead of exactly
    // one — the whole point of moving off afterAttack was to stop landing
    // poison as overkill on an enemy already dying from the clash.
    const { events } = simulate(lineup({ defId: 'blight-witch' }), gauntletOf([dummy(0, 100)]));
    const applied = ofType(events, 'poisonApplied');
    expect(applied.length).toBe(1);
  });

  it('stacks scale by tier: 1 / 3 / 5 (poisonStacksForTier)', () => {
    for (const [tier, expected] of [[1, 1], [2, 3], [3, 5]] as const) {
      const { events } = simulate(
        lineup({ defId: 'blight-witch', tier }),
        gauntletOf([dummy(0, 1000)])
      );
      const applied = ofType(events, 'poisonApplied');
      expect(applied[0].totalStacks).toBe(expected);
    }
  });

  it('multiple Blight-Witches stack additively within one wave — bounded, not a compounding vector', () => {
    // Two t1 Blight-Witches each apply 1 stack to the same lone enemy this
    // wave (1 + 1 = 2). This is the additive-within-a-wave behavior the
    // compounding-law comment on `poisonAllEnemies` calls out as bounded:
    // enemies are re-instantiated next wave, so it can never carry forward.
    const { events } = simulate(
      lineup({ defId: 'blight-witch' }, { defId: 'blight-witch' }),
      gauntletOf([dummy(0, 1000)])
    );
    const applied = ofType(events, 'poisonApplied');
    expect(applied.length).toBe(2);
    expect(applied[0].totalStacks).toBe(1);
    expect(applied[1].totalStacks).toBe(2);
  });

  it('poison does not persist across waves — a fresh wave starts the count over', () => {
    const { events } = simulate(
      lineup({ defId: 'blight-witch' }),
      gauntletOf([dummy(0, 3)], [dummy(0, 1000)])
    );
    const waveStarts = ofType(events, 'waveStart');
    expect(waveStarts.length).toBe(2);
    const applied = ofType(events, 'poisonApplied');
    // One application per wave (one enemy each), both at 1 stack — the
    // second wave's fresh enemy does not inherit or stack onto whatever
    // the first wave's (now-dead) enemy accumulated.
    expect(applied.length).toBe(2);
    expect(applied.every((e) => e.totalStacks === 1)).toBe(true);
  });
});
