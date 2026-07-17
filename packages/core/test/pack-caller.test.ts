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

// Pack-Caller (issue #88, reworked 2026-07-16): `faint`-triggered, gives away
// its own CURRENT (tier-scaled, relic/buff-inflated) attack and max health,
// split evenly across every other living teammate, remainder going one point
// each to the frontmost survivors. With no relic or startOfBattle buff
// applied, "current" and "base tier-scaled" are the same number, which is
// what most of the tests below exercise; the dedicated relic test further
// down is what actually proves the LIVE-stat behavior (see that test).
// `dire-rat` (attack 4 / health 5 / cost 7) has no ability of its own — a
// clean filler so its only `buff` events come from Pack-Caller's death
// payout, and its base stats are large enough that the issue #131 receiver
// cap (`receiveCapMultiplier: 1` — see that describe block below) never
// engages for these small-payout tests, keeping them focused purely on the
// split/remainder/live-stat logic. `pup` (attack 1 / health 1 / cost 0) is
// reserved for the receiver-cap tests specifically, where its tiny base is
// the point. Pack-Caller is placed at the front (index 0) against a
// `dummy(50, 1)` enemy — same one-shot-both-ways idiom `abilities.test.ts`
// uses for Gnawer's `bequeathAttack` — so it faints deterministically on
// wave 1.

describe('Pack-Caller (distributeStatsOnFaint, issue #88 rework)', () => {
  it('splits its own current attack/health evenly, remainder to the frontmost survivor', () => {
    // t1 Pack-Caller: attack 2, health 3. Two dire-rat survivors: 2/2=1r0
    // attack, 3/2=1r1 health — the front dire-rat (board index 0 after
    // removal) gets the spare health point, the back one does not.
    const { events } = simulate(
      lineup({ defId: 'pack-caller' }, { defId: 'dire-rat' }, { defId: 'dire-rat' }),
      gauntletOf([dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(2);
    expect(buffs[0].attack).toBe(1);
    expect(buffs[0].health).toBe(2);
    expect(buffs[1].attack).toBe(1);
    expect(buffs[1].health).toBe(1);
    // Full total distributed, nothing lost to rounding.
    const totalAttack = buffs.reduce((s, b) => s + b.attack, 0);
    const totalHealth = buffs.reduce((s, b) => s + b.health, 0);
    expect(totalAttack).toBe(2);
    expect(totalHealth).toBe(3);
  });

  it('gives away its LIVE (relic-buffed) stats, not its flat base line', () => {
    // t1 Pack-Caller + Rusted Nail (+2 attack, no health): live attack =
    // 2 + 2 = 4, live health unchanged at 3. Two dire-rat survivors: 4/2=2r0
    // attack, 3/2=1r1 health — proves the payout reads `source.attack`/
    // `source.maxHealth` at time of death, not a fixed tier-scaled literal.
    const { events } = simulate(
      lineup({ defId: 'pack-caller', relicIds: ['rusted-nail'] }, { defId: 'dire-rat' }, { defId: 'dire-rat' }),
      gauntletOf([dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(2);
    expect(buffs[0].attack).toBe(2);
    expect(buffs[0].health).toBe(2);
    expect(buffs[1].attack).toBe(2);
    expect(buffs[1].health).toBe(1);
    expect(buffs.reduce((s, b) => s + b.attack, 0)).toBe(4);
    expect(buffs.reduce((s, b) => s + b.health, 0)).toBe(3);
  });

  it('spreads a multi-point remainder across multiple frontmost survivors', () => {
    // t1 Pack-Caller: attack 2, health 3. Three dire-rat survivors: 2/3=0r2
    // attack (front two get +1 each, third gets 0), 3/3=1r0 health (everyone
    // gets exactly 1, no remainder).
    const { events } = simulate(
      lineup({ defId: 'pack-caller' }, { defId: 'dire-rat' }, { defId: 'dire-rat' }, { defId: 'dire-rat' }),
      gauntletOf([dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(3);
    expect(buffs.map((b) => b.attack)).toEqual([1, 1, 0]);
    expect(buffs.every((b) => b.health === 1)).toBe(true);
    expect(buffs.reduce((s, b) => s + b.attack, 0)).toBe(2);
    expect(buffs.reduce((s, b) => s + b.health, 0)).toBe(3);
  });

  it('scales the payout with tier via the same base-stat curve as its own body', () => {
    // t2 Pack-Caller: attack 2*3=6, health 3*3=9. Two dire-rat survivors
    // (base 4/5 — high enough that the #131 receiver cap, 3x own base =
    // 12/15, has plenty of headroom and doesn't interfere with this test):
    // 6/2=3r0 attack, 9/2=4r1 health — front dire-rat gets the spare health
    // point. (`pup`'s 1/1 base stats give it only a 3/3 cap — too small a
    // receiver for this test; see the dedicated cap tests below instead.)
    const { events } = simulate(
      lineup({ defId: 'pack-caller', tier: 2 }, { defId: 'dire-rat' }, { defId: 'dire-rat' }),
      gauntletOf([dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(2);
    expect(buffs[0].attack).toBe(3);
    expect(buffs[0].health).toBe(5);
    expect(buffs[1].attack).toBe(3);
    expect(buffs[1].health).toBe(4);
  });

  it('in the last slot with nobody left, the payout evaporates — no crash', () => {
    const { events, result } = simulate(lineup({ defId: 'pack-caller' }), gauntletOf([dummy(50, 100)]));
    expect(ofType(events, 'buff').length).toBe(0);
    expect(ofType(events, 'death').length).toBe(1);
    expect(result.survivors.length).toBe(0);
  });

  it('only pays out once — a unit only faints once, so there is no per-wave re-stacking risk', () => {
    // Two harmless filler waves (0-attack, 0-health enemies clear instantly,
    // same idiom abilities.test.ts uses for Gnawer's wave-died-on tests)
    // pass for free, then Pack-Caller dies to the third. Exactly one payout.
    const { events } = simulate(
      lineup({ defId: 'pack-caller' }, { defId: 'dire-rat' }),
      gauntletOf([dummy(0, 0)], [dummy(0, 0)], [dummy(50, 1)])
    );
    const buffs = ofType(events, 'buff');
    expect(buffs.length).toBe(1);
    expect(buffs[0].attack).toBe(2);
    expect(buffs[0].health).toBe(3);
  });

  // Issue #131: shared, whole-battle, per-SIDE budget on `distributeStatsOnFaint`
  // (v2 — replaced a receiver-side cap shipped earlier the same day that fixed
  // the same exploit but flattened the card's late-death "bank it and dump it
  // on 1-2 units" playstyle, since a recipient's own small pre-existing stats
  // capped how much of a big late payout it could ever use). This version
  // caps the TOTAL every Pack-Caller on a side can move over the whole
  // battle — `totalBudgetMultiplier` (3) × a single tier-3 Pack-Caller's own
  // base attack/health (2/3 base × 9 tier-3 multiplier = 18/27), so the
  // budget is 3×18=54 attack, 3×27=81 health — regardless of who ends up
  // with it. Multiplier tuned empirically (see the effect's doc comment in
  // data/units.ts): the response curve is smooth for legitimate boards but
  // has a sharp cliff around 6x for Jesper's actual reported board (9 phases
  // at 3x vs. back to the original 46-47 phase exploit at 6x+) — 3x leaves a
  // real margin below that cliff.
  describe('distributeStatsOnFaint shared budget (issue #131 v2)', () => {
    it('the TOTAL given away across several deaths is capped, however it gets split', () => {
      // 4x t3 Pack-Caller + 1 dire-rat sink. Each wave's dummy(1000, 1) one-
      // shots whatever's currently front (however buffed by prior payouts)
      // while also dying itself, clearing cleanly into the next of 4 waves —
      // so all 4 Pack-Callers die in sequence, each splitting its (possibly
      // budget-clipped) live stats across whichever teammates are still
      // alive. Without a cap, 4 uninflated t3 Pack-Callers alone would give
      // away at least 4×18=72 attack / 4×27=108 health (more once earlier
      // payouts inflate later casters) — well past the 54/81 budget.
      const { events } = simulate(
        lineup(
          { defId: 'pack-caller', tier: 3 },
          { defId: 'pack-caller', tier: 3 },
          { defId: 'pack-caller', tier: 3 },
          { defId: 'pack-caller', tier: 3 },
          { defId: 'dire-rat', tier: 3 }
        ),
        gauntletOf([dummy(1000, 1)], [dummy(1000, 1)], [dummy(1000, 1)], [dummy(1000, 1)])
      );
      const buffs = ofType(events, 'buff');
      const totalAttack = buffs.reduce((s, b) => s + b.attack, 0);
      const totalHealth = buffs.reduce((s, b) => s + b.health, 0);
      expect(totalAttack).toBe(54); // exactly the shared budget, not 72+
      expect(totalHealth).toBe(81); // exactly the shared budget, not 108+
    });

    it('an ordinary single-Pack-Caller board never gets near the budget — normal play is untouched', () => {
      // t1 Pack-Caller giving away its base 2/3 to two dire-rats is nowhere
      // close to the 54/81 whole-battle budget — confirms the shared cap is
      // invisible at normal scale, only engaging for genuinely stacked boards.
      const { events } = simulate(
        lineup({ defId: 'pack-caller' }, { defId: 'dire-rat' }, { defId: 'dire-rat' }),
        gauntletOf([dummy(50, 1)])
      );
      const buffs = ofType(events, 'buff');
      expect(buffs.reduce((s, b) => s + b.attack, 0)).toBe(2); // full amount, uncapped
      expect(buffs.reduce((s, b) => s + b.health, 0)).toBe(3); // full amount, uncapped
    });
  });
});
