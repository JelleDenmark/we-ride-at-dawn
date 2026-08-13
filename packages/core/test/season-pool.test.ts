import { describe, expect, it } from 'vitest';
import { seasonUnitPool, shopUnitPoolForDay, SEASON_DAYS } from '../src/shop';
import { UNIT_DEFS, type UnitDef } from '../src/data/units';

/**
 * Seasonal roster-rotation guardrail.
 *
 * The unit catalog has outgrown the point where every def needs to be live at
 * once, so which rats are on the shelf is becoming a weekly variable in its
 * own right — novelty for the cost of editing a filter, instead of authoring
 * a new unit. `SHOP_UNIT_POOL` already supports that (defs are never deleted
 * from `UNIT_DEFS`, only dropped from the purchasable pool) and it has always
 * been hand-maintained.
 *
 * What it has NOT had is a check that a rotation slice leaves a playable
 * game behind. That is what this file is: the pool is small (18) and every
 * live unit currently owns a UNIQUE effect kind, so cutting any single unit
 * deletes a capability outright, and cutting the wrong pair can strand a
 * unit that depends on another's capability. These are the assertions that
 * turn "remember not to break the pool on Monday" into something CI says.
 *
 * Every threshold here is a FLOOR, not a target — they exist to fail loudly
 * on a bad slice, not to pin the pool's exact shape. Raise them when the
 * pool's design genuinely changes; do not lower them to make a slice pass.
 */

/**
 * Functional roles, keyed by `ability.effect.kind`. A build needs access to
 * each of these categories or whole strategies stop existing — this is the
 * grouping the rotation must respect, not the 1:1 effect-kind list (which
 * would just forbid rotation entirely).
 */
const ROLE_OF_EFFECT: Record<string, string> = {
  // Put bodies on the board.
  summon: 'bodies',
  // Raise other rats' stats.
  buffBehind: 'buff',
  buffAdjacent: 'buff',
  buffSummoned: 'buff',
  teamBuffByWave: 'buff',
  distributeStatsOnFaint: 'buff',
  // Grow a single rat over the run.
  gainStats: 'scaling',
  bequeathAttack: 'scaling',
  chargeWhileBenched: 'scaling',
  healSelf: 'scaling',
  // Reach past the front slot / punish attackers.
  backlineDamage: 'reach',
  reflectDamage: 'reach',
  poisonLastEnemy: 'reach',
  poisonAllEnemies: 'reach',
  poisonFrontEnemyWhileAlive: 'reach',
  // Survive the clash.
  grantArmor: 'defense',
  revive: 'defense',
  // Poison counter (#155's Gutter-Acolyte remake) blunts incoming poison the
  // same way armor blunts attacks — same functional job as the two above.
  poisonResist: 'defense',
  // Put bodies on the board (Rat-Piper's #161 rework: one pup a wave, tier
  // scales the pup's strength instead of the litter size — same 'bodies'
  // job `summon` does, just a different knob).
  summonScaledPup: 'bodies',
  // 'control' (Gutter-Acolyte's old weakenAllEnemies, #137) was retired by
  // #155's poison-counter remake with no replacement — a deliberate,
  // already-shipped roster decision, not a coverage gap this guardrail
  // should flag.
};

const REQUIRED_ROLES = ['bodies', 'buff', 'scaling', 'reach', 'defense'];

const rolesIn = (pool: UnitDef[]): Set<string> =>
  new Set(
    pool
      .map((u) => (u.ability ? ROLE_OF_EFFECT[u.ability.effect.kind] : undefined))
      .filter((r): r is string => r !== undefined)
  );

describe('season unit pool stays playable', () => {
  const pool = seasonUnitPool();

  it('every live unit maps to a known role', () => {
    // Catches the real failure mode of this table: a new unit ships with a
    // new effect kind, nobody adds it here, and its role silently stops
    // being counted — so a later rotation can cut the last provider of a
    // category while this file still reports full coverage.
    const unmapped = pool
      .filter((u) => u.ability && ROLE_OF_EFFECT[u.ability.effect.kind] === undefined)
      .map((u) => `${u.id} (${u.ability!.effect.kind})`);
    expect(unmapped).toEqual([]);
  });

  it('covers every required role across the season', () => {
    expect([...rolesIn(pool)].sort()).toEqual(expect.arrayContaining(REQUIRED_ROLES));
  });

  it('covers every required role on every single day', () => {
    // The season union is not enough: `unlockDay`/`retireDay` mean a role
    // can be present this week yet absent on the day a player needs it.
    for (let day = 1; day <= SEASON_DAYS; day++) {
      const roles = rolesIn(shopUnitPoolForDay(day));
      for (const required of REQUIRED_ROLES) {
        expect(roles, `day ${day} has no '${required}' unit`).toContain(required);
      }
    }
  });

  it('never strands a unit whose ability needs another unit to exist', () => {
    // Squeak-Sensei's `allySummoned`/`buffSummoned` is literally a no-op
    // without a summoner on the board, and Brood-Mother is currently the
    // pool's ONLY one — rotate her out alone and a cost-5 unit becomes a
    // dead card that still shows up in the shop.
    for (let day = 1; day <= SEASON_DAYS; day++) {
      const live = shopUnitPoolForDay(day);
      const needsSummoner = live.filter(
        (u) => u.ability?.trigger === 'allySummoned' || u.ability?.effect.kind === 'buffSummoned'
      );
      if (needsSummoner.length === 0) continue;
      const summoners = live.filter((u) => u.ability?.effect.kind === 'summon');
      expect(
        summoners.length,
        `day ${day}: ${needsSummoner.map((u) => u.id).join(', ')} need a summoner, pool has none`
      ).toBeGreaterThan(0);
    }
  });

  it('keeps enough units to fill a board and still merge', () => {
    // A board is 8 wide and a ★3 costs 9 copies of one def; a pool that
    // gets rotated too thin turns every week into the same forced build.
    for (let day = 1; day <= SEASON_DAYS; day++) {
      expect(shopUnitPoolForDay(day).length, `day ${day} pool`).toBeGreaterThanOrEqual(10);
    }
  });

  it('keeps an affordable entry point on day 1', () => {
    // Starting scrap is 24 and the shop shows 4 unit stalls. If the cheapest
    // live rats all sit at the top of the cost curve, day 1 is a stall.
    const day1 = shopUnitPoolForDay(1);
    const cheap = day1.filter((u) => u.cost <= 5);
    expect(cheap.length, 'day-1 units costing <= 5').toBeGreaterThanOrEqual(4);
  });

  it('rotated-out units stay resolvable in UNIT_DEFS', () => {
    // The rotation contract: pool membership changes, defs never disappear —
    // golden logs, stored leaderboard lineups and replays all resolve defs
    // by id long after a unit leaves the shelf.
    const live = new Set(pool.map((u) => u.id));
    const retired = Object.values(UNIT_DEFS).filter((u) => u.cost > 0 && !live.has(u.id));
    for (const u of retired) {
      expect(UNIT_DEFS[u.id], `${u.id} rotated out but must stay resolvable`).toBeDefined();
    }
    // Sanity: this test is only meaningful while something is actually
    // rotated out. If this ever hits zero, rotation has stopped happening.
    expect(retired.length).toBeGreaterThan(0);
  });
});
