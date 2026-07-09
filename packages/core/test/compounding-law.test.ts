// Generic regression coverage for the compounding law (see units.ts's Ability
// doc comment), not per-unit hand-written tests. History: two real incidents
// shipped to prod before being caught —
//   - Warren-Warden's `startOfBattle` firing every wave (4x t3 -> 241 attack,
//     44/45 clear on the live #1 board before anyone noticed).
//   - Two Bone-Priests reviving each other forever (found by manual audit,
//     already live on prod).
// Neither was caught by the balance sim scripts (balance.ts, depth-scaling.ts,
// snowball.ts), which all run one hand-picked roster and measure drift, not
// per-unit firing frequency. A hand-written regression test exists for
// Warren-Warden specifically (added after its incident, see
// abilities.test.ts), but nothing generic protects every *future*
// startOfBattle unit the same way — MD Rattyfock, Press-Kin, Dawn-Runt, and
// Dusk-Runt were all added since with no equivalent coverage. This file
// parametrizes over UNIT_DEFS itself so any new startOfBattle buff-effect
// unit is automatically covered, no one has to remember to add a test.
import { describe, expect, it } from 'vitest';
import { simulate, type BattleEvent } from '../src/sim';
import type { Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';
import { UNIT_DEFS } from '../src/data/units';

const dummy = (attack: number, health: number): UnitDef => ({
  id: 'dummy', name: 'Dummy', attack, health, cost: 0,
});

const grinder = (waves: number): Gauntlet => ({
  date: 'test',
  seed: 0,
  waves: Array.from({ length: waves }, () => ({ units: [dummy(0, 1000)] })),
});

const ofType = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

// Every effect kind that funnels through sim.ts's shared `buff()` helper
// (which is what emitted the runaway 'buff' events in the Warren-Warden
// incident) and is wired to `startOfBattle` — i.e. every unit where a
// per-wave re-fire would silently compound a permanent stat forever.
const BUFF_EFFECT_KINDS = ['buffBehind', 'buffAdjacent', 'teamBuff', 'gainStats'];

const startOfBattleBuffUnits = Object.values(UNIT_DEFS).filter(
  (u): u is UnitDef & { ability: NonNullable<UnitDef['ability']> } =>
    u.ability?.trigger === 'startOfBattle' && BUFF_EFFECT_KINDS.includes(u.ability.effect.kind)
);

describe('compounding-law: startOfBattle buff effects fire once, never scale with wave count', () => {
  // Sanity check that this test file isn't silently vacuous — if every
  // startOfBattle buff unit got renamed/removed, `it.each` would just pass
  // on zero cases and nobody would notice.
  it('covers at least one real unit (guards against a vacuous test suite)', () => {
    expect(startOfBattleBuffUnits.length).toBeGreaterThan(0);
  });

  it.each(startOfBattleBuffUnits.map((u) => [u.id, u] as const))(
    '%s: buff-event count does not grow with wave count',
    (_id, def) => {
      const timeOfDay = def.ability.condition?.timeOfDay;
      const lineup = (waves: number): Lineup => ({
        units: [{ defId: def.id, tier: 1 }, { defId: 'gutter-runt', tier: 1 }],
        timeOfDay,
      });

      const short = simulate(lineup(2), grinder(2));
      const long = simulate(lineup(10), grinder(10));

      const shortBuffs = ofType(short.events, 'buff').length;
      const longBuffs = ofType(long.events, 'buff').length;

      // The Warren-Warden bug's signature exactly: buff-event count scaled
      // linearly with wave count instead of staying flat at "however many
      // targets this unit's ability can reach."
      expect(longBuffs).toBe(shortBuffs);
      // And confirm the ability actually fired at all (not a false-pass from
      // a condition that never matched in this fixture).
      expect(longBuffs).toBeGreaterThan(0);
    }
  );
});

describe('compounding-law: revive is bounded, never an infinite ring', () => {
  const reviveUnits = Object.values(UNIT_DEFS).filter(
    (u): u is UnitDef & { ability: NonNullable<UnitDef['ability']> } =>
      u.ability?.effect.kind === 'revive'
  );

  it('covers at least one real unit (guards against a vacuous test suite)', () => {
    expect(reviveUnits.length).toBeGreaterThan(0);
  });

  it.each(reviveUnits.map((u) => u.id))(
    '%s: two copies reviving each other cannot loop indefinitely',
    (defId) => {
      // The exact shape of the shipped-to-prod incident: two revivers, no
      // other units, ground down against a durable enemy. If revival isn't
      // capped to "once per corpse," this either times out or clears far
      // more of a long gauntlet than two cheap t1 units legitimately should.
      const { result } = simulate(
        { units: [{ defId, tier: 1 }, { defId, tier: 1 }] },
        grinder(45)
      );
      // Two lone t1 revivers with no attack-side support should not be
      // clearing anywhere near the full 45-wave gauntlet. The historical
      // incident cleared all 45; a bounded revive should fall far short.
      expect(result.wavesCleared).toBeLessThan(20);
    }
  );
});
