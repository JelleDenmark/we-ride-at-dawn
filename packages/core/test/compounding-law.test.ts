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
import { simulate, COMBAT_CAP_BONUS, type BattleEvent } from '../src/sim';
import type { Gauntlet } from '../src/gauntlet';
import type { Lineup, UnitDef } from '../src/data/units';
import { UNIT_DEFS } from '../src/data/units';
import { sellRefund } from '../src/shop';

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

describe('compounding-law: allyFaint stat-farming stays capped by the combat headroom (canary)', () => {
  // The 2026-07-11 pre-launch exploit hunt found the one combo in the
  // current roster with the classic incident shape — a PERMANENT stat gain
  // (`gainStats`) on a trigger that repeats every wave (`allyFaint`, fed by
  // Rat-Piper's per-wave pup summons / Brood-Mother's faint-births). Its
  // growth is unbounded in principle (a probe with an artificial
  // combatCap=40 full-cleared 45/45 at ~150 attack); in real play it is
  // held back ONLY by the summon headroom (`COMBAT_CAP_BONUS = 2`) capping
  // how much chaff can exist per wave — the best real board reached 39/45.
  //
  // This canary pins that ceiling: it plays the strongest real-rules combo
  // board and asserts it cannot clear the gauntlet. If a future change to
  // COMBAT_CAP_BONUS, board slots, summon counts, or gainStats magnitude
  // silently unlocks the combo, this fails loudly instead of shipping the
  // third compounding incident. (Deliberately a canary, not a "fires once"
  // check — repeating on allyFaint is Corpse-Glutton's intended identity;
  // what must stay true is that the loop stays *bounded*.)
  it('a maxed feeder + Corpse-Glutton board cannot full-clear a 45-wave grind', () => {
    // RECRUITABLE feeders only (cost > 0): the issue #105 babushka added
    // cost-0 internal cascade bodies (brood-broodling summons brood-runts) —
    // those are never on a real board, so a canary that recruited one
    // standalone would be measuring a fiction. Both summon shapes feed
    // allyFaint: `summon` (Brood-Mother's cascade) and `maintainSummons`
    // (Rat-Piper's litter, which keeps re-feeding dead pups).
    const feeders = Object.values(UNIT_DEFS).filter(
      (u) =>
        u.cost > 0 &&
        (u.ability?.effect.kind === 'summon' || u.ability?.effect.kind === 'maintainSummons')
    );
    const farmers = Object.values(UNIT_DEFS).filter(
      (u) => u.ability?.trigger === 'allyFaint' && u.ability.effect.kind === 'gainStats'
    );
    expect(feeders.length).toBeGreaterThan(0);
    expect(farmers.length).toBeGreaterThan(0);
    const units: Lineup['units'] = [
      { defId: 'dire-rat', tier: 3 },
      { defId: 'dire-rat', tier: 3 },
      ...feeders.slice(0, 3).map((u) => ({ defId: u.id, tier: 3 })),
      ...Array.from({ length: 3 }, () => ({ defId: farmers[0].id, tier: 3 })),
    ].slice(0, 8);
    const { result } = simulate(
      // Full purchasable board (8) with the REAL summon headroom — track the
      // live constant (raised to +6 for the #105 rework), not a stale literal,
      // so this canary guards actual play. Clears only a handful of waves here
      // (well under the 45 the assertion guards); the exploit-stress script is
      // the stronger headroom guard, this pins the specific allyFaint-farm loop.
      { units, combatCap: units.length + COMBAT_CAP_BONUS },
      grinder(45)
    );
    expect(result.wavesCleared).toBeLessThan(45);
  });
});

describe('compounding-law: retired-unit severance (issue #108) never pays above par', () => {
  // Par-buyback exploit shape: a naive `cost * tier²` refund (instead of
  // `cost * 3^(tier-1)`) would pay 4x cost for a tier-2 unit that only cost
  // 3x to build — a repeatable scrap printer via buy-3 -> merge -> sell. This
  // parametrizes over every unit with a `retireDay` (currently Gutter-Runt,
  // issue #109) so any FUTURE retired unit is automatically covered too, no
  // one has to remember to extend this test by hand.
  const retiredUnits = Object.values(UNIT_DEFS).filter((u) => u.retireDay !== undefined);

  it('covers at least one real unit (guards against a vacuous test suite)', () => {
    expect(retiredUnits.length).toBeGreaterThan(0);
  });

  it.each(retiredUnits.map((u) => u.id))(
    '%s: retired-sell refund never exceeds the scrap actually spent reaching that tier, for every tier',
    (defId) => {
      const def = UNIT_DEFS[defId];
      for (const tier of [1, 2, 3]) {
        // Ground truth, deliberately NOT derived from sellRefund's own
        // formula: tier N is reached by merging 3^(N-1) base copies (see
        // tierAttackMultiplier's doc comment in units.ts) — that IS the
        // scrap actually spent, independent of however sellRefund computes
        // its payout. If a future change regresses the payout formula (e.g.
        // to a `tier²` curve), this catches it even though this test never
        // imports that formula itself.
        const totalScrapSpent = def.cost * Math.pow(3, tier - 1);
        const refund = sellRefund({ defId, tier, relicIds: [] }, def.retireDay!);
        expect(refund).toBeLessThanOrEqual(totalScrapSpent);
        // Par, not just under it — the issue calls for refunding EXACTLY
        // what was spent, no discount and no premium.
        expect(refund).toBe(totalScrapSpent);
      }
    }
  );

  it('a unit sold before its own retireDay still gets the old (lower) quadratic discount, never the par buyback', () => {
    const retiring = retiredUnits[0];
    const beforeDay = retiring.retireDay! - 1;
    const refund = sellRefund({ defId: retiring.id, tier: 2, relicIds: [] }, beforeDay);
    const parRefund = retiring.cost * 3; // cost * 3^(2-1)
    expect(refund).toBeLessThan(parRefund);
  });
});

describe('compounding-law: Gnawer bequeathAttack + Bone-Priest revive is a bounded double, not a loop (issue #111)', () => {
  // The exact scenario the issue flags: `faint` fires on EVERY death, not
  // just the first, so a Bone-Priest-revived Gnawer that dies a SECOND time
  // fires `bequeathAttack` again. That's fine IFF it's bounded — `revive` is
  // capped to once per corpse (the `raised` flag), so at most 2 payouts per
  // Gnawer copy, ever, each individually capped by `waveBonusCapMultiplier`.
  // This probe pins down BOTH bounds with a hand-timed gauntlet: a 0/0
  // "filler" wave is already dead at wave start (resolveDeaths runs before
  // any tick), so it auto-clears for free and lets the wave number be
  // walked forward precisely without spending any damage, while a 50/1
  // "killer" wave kills whoever is currently front outright.
  //
  // Board: [Gnawer, Gutter-Runt, Bone-Priest, Dire-Rat]. Timeline:
  //   waves 1-4  filler   -> nothing happens, Gnawer stays front.
  //   wave 5     killer   -> Gnawer dies (payout #1, wave bonus 5, uncapped).
  //   wave 6     killer   -> Gutter-Runt (now front) dies, no ability.
  //   waves 7-10 filler   -> Bone-Priest (now front) survives untouched.
  //   wave 11    killer   -> Bone-Priest dies, revives Gnawer's corpse (the
  //                          oldest unraised fallen ally) back onto the
  //                          board directly in front of Dire-Rat.
  //   wave 12    killer   -> revived Gnawer dies AGAIN (payout #2, wave
  //                          bonus 12 -> capped at 2*ownAttack).
  const filler: UnitDef = { id: 'filler', name: 'Filler', attack: 0, health: 0, cost: 0 };
  const killer: UnitDef = { id: 'killer', name: 'Killer', attack: 50, health: 1, cost: 0 };
  const timedGauntlet: Gauntlet = {
    date: 'test',
    seed: 0,
    waves: [
      filler, filler, filler, filler, // waves 1-4
      killer,                         // wave 5: Gnawer dies
      killer,                         // wave 6: Gutter-Runt dies
      filler, filler, filler, filler, // waves 7-10
      killer,                         // wave 11: Bone-Priest dies, revives Gnawer
      killer,                         // wave 12: revived Gnawer dies again
    ].map((u) => ({ units: [u] })),
  };

  it('pays out at most twice, each payout individually capped', () => {
    const { events } = simulate(
      {
        units: [
          { defId: 'gnawer', tier: 1 },
          { defId: 'gutter-runt', tier: 1 },
          { defId: 'bone-priest', tier: 1 },
          { defId: 'dire-rat', tier: 1 },
        ],
      },
      timedGauntlet
    );

    // Bounded, not a loop: Bone-Priest's revive fires exactly once (it only
    // dies once), never an infinite reviver ring.
    expect(ofType(events, 'revive').length).toBe(1);
    expect(ofType(events, 'revive')[0].unit.defId).toBe('gnawer');

    // Gnawer's own attack (tier 1, no relics) is 3 the whole battle — revive
    // resets health/poison, never attack — so both payouts share the same
    // ownAttack and the same cap: waveBonusCapMultiplier(2) * 3 = 6.
    const ownAttack = 3;
    const capMultiplier = 2;
    const maxSinglePayout = ownAttack + capMultiplier * ownAttack; // 9

    const buffs = ofType(events, 'buff');
    // Exactly two bequeathAttack payouts landed (Gutter-Runt's wave-6 death
    // has no ability and contributes no buff event) — the bounded DOUBLE the
    // issue calls out, not a runaway loop.
    expect(buffs.length).toBe(2);

    for (const b of buffs) {
      expect(b.attack).toBeGreaterThan(0);
      expect(b.attack).toBeLessThanOrEqual(maxSinglePayout);
      expect(b.health).toBe(0);
    }

    // Payout #1 (wave 5, bonus 5 < cap 6): inherited = 3 + 5 = 8.
    expect(buffs[0].attack).toBe(8);
    // Payout #2 (wave 12, bonus would be 12 uncapped -> clamped to 6):
    // inherited = 3 + 6 = 9 = maxSinglePayout, confirming the cap actually
    // engaged rather than merely never being tested.
    expect(buffs[1].attack).toBe(9);
    expect(buffs[1].attack).toBe(maxSinglePayout);

    // The combined double payout is bounded by 2x the single-payout cap —
    // explicitly NOT unbounded growth from repeated faints.
    expect(buffs[0].attack + buffs[1].attack).toBeLessThanOrEqual(2 * maxSinglePayout);
  });
});
