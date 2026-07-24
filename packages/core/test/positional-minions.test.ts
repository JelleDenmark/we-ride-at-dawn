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

describe('Ward-Weaver (grantArmor rework, 2026-07-24)', () => {
  // Was a `startOfWave` `blockFrontHits` full-negate pool; reworked to a
  // `startOfBattle` `grantArmor` that hardens the whole warren with flat armor
  // (`wardArmorForTier`, 2/4/6) for the ride. `damage` events record the
  // POST-armor amount (`applyDamage` in sim.ts), so we read the reduced hit
  // directly. dire-rat: attack 4, health 5, own armor 2 (×tier).
  const firstDamageTo = (events: BattleEvent[], id: number) =>
    ofType(events, 'damage').find((d) => d.targetId === id)!;
  const frontIdOf = (events: BattleEvent[]) =>
    events.find((e): e is Extract<BattleEvent, { type: 'battleStart' }> => e.type === 'battleStart')!.horde[0].instanceId;

  it('grants tier-scaled armor (2/4/6) to the front, on top of its own armor', () => {
    // dire-rat's own armor is 2. A t-N ward adds wardArmorForTier(N), so a
    // 9-attack dummy lands for max(1, 9 - (2 + ward)) = 5 / 3 / 1 by tier.
    for (const [tier, expected] of [[1, 5], [2, 3], [3, 1]] as const) {
      const { events } = simulate(
        lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver', tier }),
        gauntletOf([dummy(9, 1000)])
      );
      expect(firstDamageTo(events, frontIdOf(events)).amount).toBe(expected);
    }
  });

  it('a warded unit still takes ≥1 per hit however much armor — never immortal (the Boss Trial fix)', () => {
    // Two t3 wards stack additively to +12 armor, dire-rat's own 2 makes 14.
    // A 5-attack dummy would go negative (5 - 14), but the MIN_ATTACK_DAMAGE
    // floor keeps it at 1 — which is exactly why flat armor terminates the
    // exponentially-escalating Boss Trial where full hit-negation did not.
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver', tier: 3 }, { defId: 'ward-weaver', tier: 3 }),
      gauntletOf([dummy(5, 1000)])
    );
    expect(firstDamageTo(events, frontIdOf(events)).amount).toBe(1);
  });

  it('wards the whole warren (all), not just the front — including itself', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-runt' }, { defId: 'dire-rat' }, { defId: 'ward-weaver', tier: 1 }),
      gauntletOf([dummy(0, 1000)])
    );
    const battleStart = events.find((e): e is Extract<BattleEvent, { type: 'battleStart' }> => e.type === 'battleStart')!;
    const allIds = battleStart.horde.map((u) => u.instanceId);
    const grantedTo = ofType(events, 'shieldGranted').map((e) => e.targetId);
    // Every ally — front, back, and the Ward-Weaver's own instance — is warded.
    expect(new Set(grantedTo)).toEqual(new Set(allIds));
  });

  it('is a one-time startOfBattle grant — it does not re-apply or re-stack each wave', () => {
    // Two waves (attack-0 dummies, so nobody dies; dire-rat clears each 5hp
    // dummy in 2 ticks). The ward fires once at battle start for the 2 allies
    // = 2 grants total, NOT 2 per wave. If it re-fired per wave we'd see 4.
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'ward-weaver', tier: 1 }),
      gauntletOf([dummy(0, 5)], [dummy(0, 5)])
    );
    const granted = ofType(events, 'shieldGranted');
    // Two allies warded once each = 2 grants total. If the grant re-fired per
    // wave (startOfWave instead of the reworked startOfBattle) we'd see 4.
    expect(granted.length).toBe(2);
    // Both grants land during wave 1's entry and never again — none at or
    // after the second wave starts.
    const secondWaveStart = events.indexOf(ofType(events, 'waveStart')[1]);
    expect(granted.every((g) => events.indexOf(g) < secondWaveStart)).toBe(true);
  });
});

describe('blockFrontHits mechanic (issue #56 — enemy-only since the Ward-Weaver armor rework)', () => {
  // The engine primitive still exists and is used by an enemy (see enemies.ts);
  // no HORDE unit carries it any more, so it's exercised here on the enemy
  // side. A gauntlet-side blocker (attack 0 so nobody on the horde dies)
  // absorbs the dire-rat's first swing each wave, and the pool refills every
  // wave when the enemy re-instantiates.
  const blocker: UnitDef = {
    id: 'blocker', name: 'Blocker', attack: 0, health: 12, cost: 0,
    ability: { trigger: 'startOfWave', effect: { kind: 'blockFrontHits' } },
  };

  it('blocks the tier-1 first hit each wave and the pool resets per wave', () => {
    // dire-rat (attack 4) vs a 12hp blocker: swing 1 is absorbed, swings 2-4
    // (12 dmg) kill it — so exactly one absorb per wave, twice over two waves.
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }),
      gauntletOf([blocker], [blocker])
    );
    const waveStarts = ofType(events, 'waveStart');
    expect(waveStarts.length).toBe(2);
    for (let w = 0; w < 2; w++) {
      const start = events.indexOf(waveStarts[w]);
      const end = w + 1 < 2 ? events.indexOf(waveStarts[w + 1]) : events.length;
      const absorbedThisWave = ofType(events, 'shieldAbsorbed').filter((e) => {
        const idx = events.indexOf(e);
        return idx >= start && idx < end;
      });
      expect(absorbedThisWave.length).toBe(1);
    }
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
