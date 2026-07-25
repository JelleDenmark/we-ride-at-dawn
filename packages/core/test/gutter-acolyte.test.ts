// Gutter-Acolyte (issue #137): the roster's first enemy-STAT debuff — armor
// blunts hits and poison races health, but nothing lowered the incoming
// number itself before this. `startOfWave`-fired attack shred on the whole
// enemy line, floored at MIN_ATTACK_DAMAGE (enemies always hit for at least
// 1, mirroring the armor rule). Safe under ADR-0003 because enemies are
// re-instantiated fresh every wave — the shred can never carry across the
// ride, exactly like poisonAllEnemies.
//
// 2026-07-25: converted from a flat `attack * tier` shred to a percentage
// of the target's ORIGINAL wave-start attack ([0.05, 0.10, 0.15] per tier,
// weakenPercentForTier) — the flat version decayed into irrelevance as
// enemy attack scales ~5x by wave 45; percentage stays proportionally
// meaningful at any depth. The rate started at [0.10, 0.20, 0.30] but was
// halved after the maxed-board leaderboard-ceiling guardrail found a SINGLE
// ★3 Acolyte swapped into the deepest existing comp erased all headroom and
// full-cleared the 45-wave gauntlet. "Original" (not current) attack, plus a
// shared per-enemy cap-not-sum budget across multiple casters (capped at
// weakenPercentForTier(3) total), makes multi-caster stacking additive and
// bounded — same precedent as poisonAllEnemies's stack cap (issue #116).
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

  it('saps 5% attack from the front enemy, and the softened swing actually lands softer', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-acolyte' }),
      gauntletOf([dummy(20, 30)])
    );
    const weakens = ofType(events, 'weaken');
    expect(weakens.length).toBe(1);
    expect(weakens[0].attack).toBe(1); // round(20 * 0.05)
    expect(weakens[0].newAttack).toBe(19);
    // The Acolyte (no armor) then takes 19-damage hits, not 20s.
    const acolyteId = ofType(events, 'battleStart')[0].horde[0].instanceId;
    const onAcolyte = ofType(events, 'damage').filter((d) => d.targetId === acolyteId);
    expect(onAcolyte.length).toBeGreaterThan(0);
    expect(onAcolyte.every((d) => d.amount === 19)).toBe(true);
  });

  it('shreds the WHOLE enemy line, not just the front (the #112 dead-front lesson)', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-acolyte' }),
      gauntletOf([dummy(20, 30), dummy(40, 30), dummy(60, 30)])
    );
    const wave = ofType(events, 'waveStart')[0];
    const weakens = ofType(events, 'weaken');
    expect(weakens.length).toBe(3);
    expect(weakens.map((w) => w.targetId).sort()).toEqual(
      wave.enemies.map((e) => e.instanceId).sort()
    );
  });

  it('scales via the [0.05, 0.10, 0.15] table, never the exponential curve', () => {
    // ★2 (10%) of 20 attack = 2.
    const { events } = simulate(
      lineup({ defId: 'gutter-acolyte', tier: 2 }),
      gauntletOf([dummy(20, 30)])
    );
    const weakens = ofType(events, 'weaken');
    expect(weakens[0].attack).toBe(2);
    expect(weakens[0].newAttack).toBe(18);
  });

  it('an enemy already at (or below) the floor is untouched — no event, no negative shred', () => {
    const { events } = simulate(
      lineup({ defId: 'gutter-acolyte' }),
      gauntletOf([dummy(1, 30), dummy(0, 30)])
    );
    expect(ofType(events, 'weaken').length).toBe(0);
  });

  it('multi-caster cap-not-sum: 4x★1 Acolytes (5% each) clip at the ★3 budget (15%), matching one ★3 alone', () => {
    // Percent is taken off ORIGINAL attack (100), so each of the first three
    // casters sheds a flat 5 (round(100*0.05)) — 100->95->90->85 — and the
    // 4th caster's remaining budget is 0.15-0.15=0, a no-op.
    const { events } = simulate(
      lineup(
        { defId: 'gutter-acolyte' },
        { defId: 'gutter-acolyte' },
        { defId: 'gutter-acolyte' },
        { defId: 'gutter-acolyte' }
      ),
      gauntletOf([dummy(100, 200)])
    );
    const weakens = ofType(events, 'weaken');
    expect(weakens.length).toBe(3); // the 4th caster's shred is fully clipped — no event
    expect(weakens.map((w) => w.newAttack)).toEqual([95, 90, 85]);

    // A lone ★3 Acolyte (15% in one shot) lands on the SAME final attack —
    // proof the budget caps the group at exactly one ★3's worth, no more.
    const soloResult = simulate(
      lineup({ defId: 'gutter-acolyte', tier: 3 }),
      gauntletOf([dummy(100, 200)])
    );
    const soloWeakens = ofType(soloResult.events, 'weaken');
    expect(soloWeakens.length).toBe(1);
    expect(soloWeakens[0].newAttack).toBe(85);
  });

  it('re-applies to each fresh wave — and never carries: wave 2 recomputes from ITS OWN wave-start attack', () => {
    // Dire-Rat up front keeps the Acolyte alive into wave 2. Both waves feed
    // the same base-40 dummy, but enemyAttackScale bumps wave 2's actual
    // attack to round(40*1.09)=44 — if wave 1's shred (or budget) carried
    // over, wave 2's shred would be computed off a reduced or already-spent
    // base instead of that fresh 44.
    const { events } = simulate(
      lineup({ defId: 'dire-rat' }, { defId: 'gutter-acolyte' }),
      gauntletOf([dummy(40, 1)], [dummy(40, 30)])
    );
    const wave2Start = ofType(events, 'waveStart')[1].enemies[0];
    expect(wave2Start.attack).toBe(44); // fresh scaled base, not 40 minus wave 1's shred
    const weakens = ofType(events, 'weaken');
    expect(weakens.length).toBe(2);
    expect(weakens[0].newAttack).toBe(38); // wave 1: round(40*0.05)=2 shred
    expect(weakens[1].newAttack).toBe(42); // wave 2: round(44*0.05)=2 shred, off the fresh 44
  });
});
