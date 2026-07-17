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

  // Issue #131: receiver-side cap on `distributeStatsOnFaint`, fixing the
  // payout-CONCENTRATION exploit (a board thinning to one long-lived
  // survivor soaking up nearly every Pack-Caller's death payout — measured
  // pushing Boss Trial to its 60-phase hard cap). Cap = receiveCapMultiplier
  // (1) × the RECIPIENT's own tier-scaled base attack/health — a recipient
  // can gain at most its own base stat line, once total, from this effect.
  // `pup` (base 1/1) caps at 1/1, tiny on purpose for these tests to
  // exercise clipping without needing an implausibly large payout. The
  // multiplier itself was tuned empirically against Jesper's actual
  // reported board, not picked blind — see the effect's doc comment in
  // data/units.ts (3x and even 1.5x barely moved the real board's measured
  // phase count; 1x is what actually closed the gap).
  describe('distributeStatsOnFaint receiver cap (issue #131)', () => {
    it("a payout bigger than the recipient's own cap gets clipped to the cap", () => {
      // t3 Pack-Caller: attack 2*9=18, health 3*9=27. Lone pup survivor gets
      // the whole thing raw (18/27) — clipped to pup's 1/1 cap.
      const { events } = simulate(
        lineup({ defId: 'pack-caller', tier: 3 }, { defId: 'pup' }),
        gauntletOf([dummy(50, 1)])
      );
      const buffs = ofType(events, 'buff');
      expect(buffs.length).toBe(1);
      expect(buffs[0].attack).toBe(1);
      expect(buffs[0].health).toBe(1);
    });

    it('the cap is cumulative across separate payouts in one battle, not reset per wave', () => {
      // Two t1 Pack-Callers die on separate waves; dire-rat (base 4/5, cap
      // 4/5) survives both and is the only long-term recipient — a bigger
      // base than `pup` so there's headroom left to show PARTIAL clipping
      // rather than an all-or-nothing zero. Wave 1's dummy(2,3) trades
      // evenly with front PC1 (2/3) and both die together on tick 2 (wave
      // clears). PC1's payout splits across the 2 survivors [PC2, dire-rat]:
      // PC2 (now frontmost) gets the remainder point — atk+1/hp+2 —
      // dire-rat gets atk+1/hp+1 (received so far: 1/1, well under its 4/5
      // cap). Wave 2's dummy(50,5) kills the now-buffed PC2 (atk3/hp5)
      // without dying itself (3 dmg leaves it at 2 hp) — a solo death, sole
      // survivor dire-rat gets ALL of PC2's live stats raw: atk 3, hp 5.
      // Added to dire-rat's already-banked 1/1, attack totals 4 (exactly the
      // 4 cap — fits with no visible clipping) but health totals 6, over the
      // 5 cap — clipped to the REMAINING headroom (5-1=4), not a fresh
      // 5-per-payout allowance. The health dimension is what proves the cap
      // tracks a running total, not a per-wave allowance.
      const { events } = simulate(
        lineup({ defId: 'pack-caller' }, { defId: 'pack-caller' }, { defId: 'dire-rat' }),
        gauntletOf([dummy(2, 3)], [dummy(50, 5)])
      );
      const buffs = ofType(events, 'buff');
      expect(buffs.length).toBe(3); // PC1's 2 payouts, then PC2's 1 payout
      expect(buffs[2].attack).toBe(3); // exactly fills remaining attack headroom (4 cap - 1 banked)
      expect(buffs[2].health).toBe(4); // clipped: remaining health headroom (5 cap - 1 banked), not a fresh 5
    });

    it("a capped recipient's overflow is lost, not redistributed to another survivor", () => {
      // t2 Pack-Caller (attack 6, health 9) splits evenly across dire-rat
      // (base 4/5, cap 4/5) and pup (base 1/1, cap 1/1): raw share 3/4r1
      // each (dire-rat, frontmost, gets the spare point: atk3/hp5). Both
      // land within dire-rat's cap untouched; pup's raw share (atk3/hp4)
      // blows well past its tiny 1/1 cap and gets clipped — proving pup's
      // clipped overflow doesn't spill over to dire-rat (dire-rat's payout
      // is exactly its calculated raw share, not inflated by pup's leftover).
      const { events } = simulate(
        lineup({ defId: 'pack-caller', tier: 2 }, { defId: 'dire-rat' }, { defId: 'pup' }),
        gauntletOf([dummy(50, 1)])
      );
      const buffs = ofType(events, 'buff');
      expect(buffs.length).toBe(2);
      expect(buffs[0].attack).toBe(3); // dire-rat: untouched, exactly its raw share
      expect(buffs[0].health).toBe(5);
      expect(buffs[1].attack).toBe(1); // pup: clipped to its 1/1 cap
      expect(buffs[1].health).toBe(1);
    });
  });
});
