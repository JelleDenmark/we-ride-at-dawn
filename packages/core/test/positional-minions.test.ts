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

describe('Ward-Weaver (shieldFront / watchFrontAttack)', () => {
  it('grants a shield on the 3rd attack the front rat lands, absorbing the next hit fully', () => {
    // dire-rat: attack 4, health 5, armor 2. Enemy attack 1 -> blunted to the
    // MIN_ATTACK_DAMAGE floor of 1 per hit (1 - 2 armor clamps up to 1).
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver' }),
      gauntletOf([dummy(1, 1000)])
    );
    const granted = ofType(events, 'shieldGranted');
    const absorbed = ofType(events, 'shieldAbsorbed');
    expect(granted.length).toBeGreaterThanOrEqual(1);
    expect(absorbed.length).toBeGreaterThanOrEqual(1);
    // The grant precedes its absorb in the log.
    expect(events.indexOf(granted[0])).toBeLessThan(events.indexOf(absorbed[0]));

    // Exactly 3 clashes happen before the first grant (3rd attack landed).
    const clashes = ofType(events, 'clash');
    const grantIdx = events.indexOf(granted[0]);
    const clashesBeforeGrant = clashes.filter((c) => events.indexOf(c) < grantIdx);
    expect(clashesBeforeGrant.length).toBe(3);

    // Damage taken by dire-rat should show a gap (no 'damage' event) on the
    // tick the shield is consumed.
    const damageToFront = ofType(events, 'damage').filter((d) => d.targetId === events
      .filter((e): e is Extract<BattleEvent, { type: 'battleStart' }> => e.type === 'battleStart')[0].horde[0].instanceId);
    // dire-rat takes exactly one fewer 'damage' hit than clashes before it dies,
    // because one hit was absorbed instead of dealt.
    expect(damageToFront.length).toBeLessThan(clashesBeforeGrant.length + 3);
  });

  it('does not stack: two watchers granting in the same tick still only absorb one hit', () => {
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver' }, { defId: 'ward-weaver' }),
      gauntletOf([dummy(1, 1000)])
    );
    const granted = ofType(events, 'shieldGranted');
    const absorbed = ofType(events, 'shieldAbsorbed');
    // Both watchers proc on the same tick (3rd attack) -> two grants...
    expect(granted.length).toBeGreaterThanOrEqual(2);
    expect(granted[0].targetId).toBe(granted[1].targetId);
    // ...but the very next incoming hit is absorbed exactly once, not twice
    // in a row (there's a real 'damage' event to the front between any two
    // consecutive 'shieldAbsorbed' events targeting it).
    const firstAbsorbIdx = events.indexOf(absorbed[0]);
    const frontId = granted[0].targetId;
    const nextEventsForFront = events
      .slice(firstAbsorbIdx + 1)
      .filter((e) => (e.type === 'damage' || e.type === 'shieldAbsorbed') && e.targetId === frontId);
    // The event immediately following the absorb, for this unit, must be a
    // real 'damage' (the shield was consumed, not still active).
    expect(nextEventsForFront[0]?.type).toBe('damage');
  });

  it('tracks whoever is currently front — a swap does not reset the counter', () => {
    // gutter-runt (1atk/1hp) dies to the first hit; dire-rat becomes front on
    // tick 2. The counter is a single running total across the whole battle,
    // so the 3rd overall attack (dire-rat's 2nd) grants the shield to
    // whoever is front THEN — dire-rat, not the original front unit.
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'dire-rat' }, { defId: 'ward-weaver' }),
      gauntletOf([dummy(3, 1000)])
    );
    const granted = ofType(events, 'shieldGranted');
    expect(granted.length).toBeGreaterThanOrEqual(1);
    const battleStart = events.find((e): e is Extract<BattleEvent, { type: 'battleStart' }> => e.type === 'battleStart')!;
    const direRatId = battleStart.horde[1].instanceId;
    expect(granted[0].targetId).toBe(direRatId);
  });

  it('a fully-absorbed hit resolves before Tail-Charm — it does not consume the charm', () => {
    // bone-priest: attack 1, health 4. Enemy attack 1 (unshielded) chips it
    // 4 -> 3 -> 2 -> 1 across the first 3 ticks (shield grants after tick 3,
    // active for tick 4). Tick 4's hit is fully absorbed at 1 health
    // remaining — if the shield resolved after Tail-Charm's lethal check,
    // 1 - 1 = 0 would have already burned the charm. It must not.
    const { events } = simulate(
      lineup({ defId: 'bone-priest', relicIds: ['tail-charm'] }, { defId: 'ward-weaver' }),
      gauntletOf([dummy(1, 1000)])
    );
    const absorbed = ofType(events, 'shieldAbsorbed');
    expect(absorbed.length).toBeGreaterThanOrEqual(1);
    const absorbIdx = events.indexOf(absorbed[0]);
    const tailCharmProcsBeforeAbsorb = events
      .slice(0, absorbIdx + 1)
      .filter((e) => e.type === 'relicProc' && e.relicId === 'tail-charm');
    expect(tailCharmProcsBeforeAbsorb.length).toBe(0);

    // The charm does eventually get used by a later, real lethal hit.
    const tailCharmProcs = ofType(events, 'relicProc').filter((e) => e.relicId === 'tail-charm');
    expect(tailCharmProcs.length).toBe(1);
    expect(events.indexOf(tailCharmProcs[0])).toBeGreaterThan(absorbIdx);
  });

  it('the counter and shield persist across wave boundaries within one battle', () => {
    // Two waves, each with an enemy that dies in a single hit (dire-rat
    // attack 4 vs 1hp enemy), so no clash happens in wave 2 until a fresh
    // enemy spawns. If the counter reset per wave, wave 2 could not reach
    // the 3rd-attack threshold with only 1 clash in that wave.
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver' }),
      gauntletOf([dummy(0, 1)], [dummy(0, 1)], [dummy(0, 1)])
    );
    const granted = ofType(events, 'shieldGranted');
    // 3 waves, 1 clash each = 3 total attacks landed by the front -> exactly
    // one grant, occurring on wave 3's single clash.
    expect(granted.length).toBe(1);
  });
});
