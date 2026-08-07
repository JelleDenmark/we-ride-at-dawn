// Gutter-Acolyte (issue #155 remake, replacing #137's `weakenAllEnemies`
// enemy-attack shred): the roster's first poison COUNTER. Poison bypasses
// armor entirely (see sim.ts's applyDamage — "poison is rot, it goes around
// the hide") and nothing lowered the incoming poison number before this,
// which made Blight-Witch/Draughtsman-Moe a matchup-agnostic answer on the
// PvP panel rather than a counter-pickable one (see issue #155's findings).
//
// `startOfWave`-fired, protects the CASTER'S OWN side: negates a flat
// `poisonResistForTier(tier)` (`[1, 2, 3]`) of every poison tick this side
// takes, looked up per-tier same as `poisonAllEnemies` reads
// `poisonStacksForTier` — no scalar field on the effect, the table is the
// whole magnitude. Deliberately partial by design — "not a hard or 100%
// counter" — and multiple Acolytes stack ADDITIVELY against a shared
// per-side cap-not-sum budget capped at `POISON_RESIST_CAP` (3, exactly one
// ★3's own value), same precedent as `poisonAllEnemies`'s stack cap (issue
// #116), so poison can never be fully zeroed out against any real poison
// source no matter how many Acolytes are stacked.
import { describe, expect, it } from 'vitest';
import { simulateDuel } from '../src/duel';
import type { BattleEvent } from '../src/sim';
import { UNIT_DEFS } from '../src/data/units';

const ofType = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

// A tier-3 Draughtsman-Moe deals poisonStacksForTier(3)=5 poison per tick to
// every living enemy — used throughout as a fixed, large poison source so
// resisted amounts land on clean integers. It also hits like a truck
// (tierAttackMultiplier(3)=9x), so every horde board below puts a sacrificial
// Grave-Leech at the front to eat the clash — the unit actually under test
// rides behind it, untouched by the clash, so its poison ticks are measured
// cleanly regardless of how the front-line fight goes.
const poisoner = { defId: 'draughtsman-moe', tier: 3 as const };
const frontTank = { defId: 'grave-leech' };

const hordePoisonTicks = (events: BattleEvent[]) => {
  const hordeIds = new Set(ofType(events, 'battleStart')[0].horde.map((u) => u.instanceId));
  return ofType(events, 'poisonTick').filter((t) => hordeIds.has(t.targetId));
};

describe('Gutter-Acolyte (issue #155: poison counter remake)', () => {
  it('is wired as designed: startOfWave trigger, poisonResist effect, cost 5', () => {
    const def = UNIT_DEFS['gutter-acolyte'];
    expect(def).toBeDefined();
    expect(def.cost).toBe(5);
    expect(def.ability?.trigger).toBe('startOfWave');
    expect(def.ability?.effect.kind).toBe('poisonResist');
  });

  it('with no Acolyte, the horde takes the full 5 poison per tick', () => {
    const { events } = simulateDuel({ units: [frontTank, frontTank] }, { units: [poisoner] });
    const ticks = hordePoisonTicks(events);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => t.amount === 5)).toBe(true);
  });

  it('scales resist via the [1, 2, 3] table by tier', () => {
    const tickAmountAt = (tier: 1 | 2 | 3) => {
      const { events } = simulateDuel(
        { units: [frontTank, { defId: 'gutter-acolyte', tier }] },
        { units: [poisoner] }
      );
      return hordePoisonTicks(events)[0]?.amount;
    };
    expect(tickAmountAt(1)).toBe(4); // 5 - 1
    expect(tickAmountAt(2)).toBe(3); // 5 - 2
    expect(tickAmountAt(3)).toBe(2); // 5 - 3
  });

  it('protects its own side only — an Acolyte riding with the poisoner does not shield the victims', () => {
    const { events } = simulateDuel(
      { units: [frontTank, frontTank] },
      { units: [poisoner, { defId: 'gutter-acolyte', tier: 3 }] }
    );
    const ticks = hordePoisonTicks(events);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => t.amount === 5)).toBe(true);
  });

  it('multi-caster cap-not-sum: a lone ★3 already exhausts the budget — extra casters add nothing further', () => {
    const solo = simulateDuel(
      { units: [frontTank, { defId: 'gutter-acolyte', tier: 3 }] },
      { units: [poisoner] }
    );
    const stacked = simulateDuel(
      { units: [frontTank, { defId: 'gutter-acolyte', tier: 3 }, { defId: 'gutter-acolyte', tier: 3 }] },
      { units: [poisoner] }
    );
    const soloAmount = hordePoisonTicks(solo.events)[0]?.amount;
    const stackedAmount = hordePoisonTicks(stacked.events)[0]?.amount;
    expect(soloAmount).toBe(2); // 5 - min(3, POISON_RESIST_CAP)
    expect(stackedAmount).toBe(soloAmount); // second ★3 clips, doesn't add
  });

  it('two ★1s (1+1=2) still land under the cap, so they resist LESS than one ★3 (capped at 3)', () => {
    const twoTierOnes = simulateDuel(
      { units: [frontTank, { defId: 'gutter-acolyte' }, { defId: 'gutter-acolyte' }] },
      { units: [poisoner] }
    );
    expect(hordePoisonTicks(twoTierOnes.events)[0]?.amount).toBe(3); // 5 - min(1+1, 3)
  });

  it('never reaches a full 100% counter, even at the multi-caster cap', () => {
    // Checks the RESIST mechanic's own guarantee only: the first tick after
    // poison lands is never fully negated by `poisonResistApplied`, no
    // matter how many Acolytes are stacked. In a long enough fight,
    // `POISON_DECAY_ENABLED` (2026-08-07, issue #155 PvP-duel-length
    // follow-up — see that constant's doc comment in sim.ts) separately
    // runs a unit's raw poison stack down to 0 over time, so LATER ticks in
    // this same fight legitimately land at 0 once poison naturally expires
    // — that's decay doing its job, not resist "fully" countering poison,
    // so this test only asserts on the tick where poison is freshest.
    const { events } = simulateDuel(
      { units: [frontTank, { defId: 'gutter-acolyte', tier: 3 }, { defId: 'gutter-acolyte', tier: 3 }] },
      { units: [poisoner] }
    );
    const ticks = hordePoisonTicks(events);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[0]?.amount).toBeGreaterThan(0);
  });
});
