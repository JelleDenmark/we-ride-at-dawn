import { describe, expect, it } from 'vitest';
import { UNIT_DEFS, type UnitDef } from '../src/data/units';
import { seasonUnitPool } from '../src/shop';

/**
 * Reskin-twin parity guardrail.
 *
 * The project's established way to refresh the shop without authoring a new
 * unit is the "prestige reskin": ship a second def with IDENTICAL stats and
 * ability but a different name/art, and exclude one side of the pair from
 * `SHOP_UNIT_POOL`. Which side is live is then pure identity churn — the shop
 * reads differently on Monday at a balance delta of exactly zero.
 *
 * That promise only holds if the two sides ACTUALLY stay identical, and it has
 * already silently broken once. Gutter Gourmand's day-3 `unlockDay` was lifted
 * on 2026-08-01; its twin Twilight-Runt's was not. The pair sat desynced for
 * four weeks and nobody noticed, because the benched side is by definition
 * unreachable — nothing exercises it. It only surfaced on 2026-08-31 when the
 * pair was flipped and the newly-live twin turned out to be day-3 gated.
 *
 * There is a second, worse version of the same failure: tuning one side of a
 * live pair and forgetting the other (#149 hit exactly this and was caught
 * only because md-rattyfock.test.ts happened to pin it by hand, for one pair).
 * This file generalises that check to every pair.
 *
 * `md-rattyfock.test.ts` is deliberately left in place — it covers the same
 * pair with concrete literals and shop-purchase behaviour, which is a useful
 * complement to this structural sweep.
 */

/**
 * Every reskin pair, as `[baseId, prestigeId]`. Order is documentary only —
 * both directions are asserted — and which side is currently purchasable is
 * NOT encoded here, because that flips season to season and is exactly what
 * `SHOP_UNIT_POOL` owns.
 *
 * Add a row here when a new reskin ships. A pair whose two defs are meant to
 * DIVERGE (Draughtsman Moe broke off Blight-Witch's kit on 2026-08-13 and is
 * now a distinct unit that merely shares a body) does not belong in this list
 * — see the separate assertion below that keeps that distinction honest.
 */
const RESKIN_TWINS: ReadonlyArray<readonly [string, string]> = [
  ['warren-warden', 'md-rattyfock'],
  ['twilight-runt', 'gutter-gourmand'],
  ['slink-rat', 'mbp-rat'],
];

/** Fields that must match for a flip to be a zero-balance change. */
const parityOf = (u: UnitDef) => ({
  attack: u.attack,
  health: u.health,
  cost: u.cost,
  damageReduction: u.damageReduction,
  unlockDay: u.unlockDay,
  retireDay: u.retireDay,
  ability: u.ability,
});

describe('reskin twins stay numerically identical', () => {
  it('every declared twin id actually resolves', () => {
    // Guards against a rename silently emptying this whole file.
    for (const [a, b] of RESKIN_TWINS) {
      expect(UNIT_DEFS[a], `${a} missing from UNIT_DEFS`).toBeDefined();
      expect(UNIT_DEFS[b], `${b} missing from UNIT_DEFS`).toBeDefined();
    }
  });

  it.each(RESKIN_TWINS)(
    '%s and %s share stats, cost, gates and ability exactly',
    (aId, bId) => {
      // Deliberately compares the WHOLE parity object rather than field by
      // field, so a newly added UnitDef field that matters to balance has to
      // be consciously added to `parityOf` — a field nobody thought about is
      // the exact shape of the Gourmand/Twilight-Runt desync this file exists
      // to catch.
      expect(parityOf(UNIT_DEFS[aId])).toEqual(parityOf(UNIT_DEFS[bId]));
    }
  );

  it.each(RESKIN_TWINS)(
    'exactly one of %s / %s is purchasable in any given season',
    (aId, bId) => {
      // The core of the reskin contract: both live at once would double the
      // effective copies of one kit in the pool (and let a player merge
      // toward two separate ★3s of the same ability); neither live silently
      // deletes a capability, which is what `season-pool.test.ts` guards.
      const live = new Set(seasonUnitPool().map((u) => u.id));
      const liveSides = [aId, bId].filter((id) => live.has(id));
      expect(liveSides, `expected exactly one of ${aId}/${bId} in the pool`).toHaveLength(1);
    }
  );

  it('Draughtsman Moe and Blight-Witch share a body but NOT a kit', () => {
    // Moe began as a Blight-Witch reskin (issue #115, a tribute to RatMoe) and
    // would belong in RESKIN_TWINS above — except the 2026-08-13 rework split
    // her onto `poisonFrontEnemyWhileAlive` because the shared
    // `poisonAllEnemies` kit measured as a PvP outlier. This asserts that the
    // split is still real, so nobody "restores parity" by handing the
    // no-counterplay kit back (a change this rebalance's own first draft
    // proposed before reading the history).
    const moe = UNIT_DEFS['draughtsman-moe'];
    const witch = UNIT_DEFS['blight-witch'];
    expect(moe.ability?.effect.kind).toBe('poisonFrontEnemyWhileAlive');
    expect(witch.ability?.effect.kind).toBe('poisonAllEnemies');
    expect(moe.ability?.effect.kind).not.toBe(witch.ability?.effect.kind);
    // The tribute half that DOES still hold: same plague tribe.
    expect(moe.tribe).toBe(witch.tribe);
  });
});
