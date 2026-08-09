/**
 * THROWAWAY probe for issue #155 — does an Acolyte-equipped board actually
 * beat/draw/lose to a REALISTIC Moe board, and by how much?
 *
 * v2 (2026-08-07): the original version of this probe pitted the Acolyte
 * board against `8x Draughtsman-Moe`. That is not a valid stress test —
 * `poisonAllEnemies` is capped PER SIDE at `poisonStacksForTier(3)` = 5
 * (sim.ts, issue #116's multi-caster cap), so 8x Moe deals exactly the same
 * total poison as a single Moe, and the other 7 slots are dead weight with
 * their signature ability entirely clipped. That is not a board anyone
 * plays. Real live boards (pulled 2026-08-07 from `pvp_boards_public`,
 * season `2026-08-03.2`) run exactly ONE Draughtsman-Moe inside a synergy
 * core. This version uses one such real board verbatim (season leader
 * "RatMoe", 2026-08-06 snapshot) instead of a spam board, so the poison
 * pressure being tested is what a real opponent can actually field.
 *
 * Not wired into package.json; not part of the regular pvp:* suite. Run
 * directly with `npx tsx scripts/pvp-acolyte-vs-moe-probe.ts` from
 * packages/core. Follows the same APIs/conventions as pvp-unit-matrix.ts /
 * pvp-relic-matrix.ts (simulateDuel, BOARD_CAP/COMBAT_CAP_BONUS, no relics
 * — relics are omitted here too, same as v1, to isolate the unit-kit
 * question from the relic layer).
 *
 * POISON_RESIST_CAP itself is NOT swept by this script — it's a compiled
 * constant imported by sim.ts, so sweeping it means editing
 * `data/units.ts` and re-running between each value (done manually for the
 * 2026-08-07 re-analysis: cap ∈ {3, 4, 5} at T2 and T3, recorded in the
 * handoff/GitHub comment, not automated here to keep this script simple).
 */
import { simulateDuel } from '../src/duel';
import { type Lineup } from '../src/data/units';
import { BOARD_CAP, COMBAT_CAP_BONUS } from '../src/sim';

const CAP = BOARD_CAP;
const COMBAT_CAP = CAP + COMBAT_CAP_BONUS;

function board(defIds: string[], tier: number): Lineup {
  return {
    units: defIds.map((defId) => ({ defId, tier, relicIds: [] as string[] })),
    teamRelicIds: [],
    combatCap: COMBAT_CAP,
  };
}

function acolyteBoard(n: number, tier: number): Lineup {
  const units = [
    ...Array.from({ length: n }, () => 'gutter-acolyte'),
    ...Array.from({ length: CAP - n }, () => 'dire-rat'),
  ];
  return board(units, tier);
}

// Real live board, "RatMoe" (season 2026-08-03.2, pvp_boards_public,
// updated_at 2026-08-06T17:43:58Z) — the exact composition the memory file
// (wrad-pvp-season1-meta.md) calls out as the live top-board synergy core
// (MD-Rattyfock / Ward-Weaver / Draughtsman-Moe together). ONE Moe, not
// eight. Relic IDs stripped (see file header — relics out of scope here).
function realisticMoeBoard(tier: number): Lineup {
  return board(
    [
      'md-rattyfock',
      'steel-whisker',
      'ward-weaver',
      'ward-weaver',
      'ward-weaver',
      'gutter-gourmand',
      'gutter-gourmand',
      'draughtsman-moe',
    ],
    tier
  );
}

console.log('=== Acolyte-equipped board vs a REAL live Moe synergy-core board (issue #155 probe v2) ===\n');

for (const tier of [1, 2, 3]) {
  console.log(`---- Tier ${tier} ----`);
  const moe = realisticMoeBoard(tier);
  let baseline = 0;
  for (const n of [0, 1, 2, 3]) {
    const acolytes = acolyteBoard(n, tier);
    const { result } = simulateDuel(acolytes, moe);
    const diff = result.healthA - result.healthB;
    if (n === 0) baseline = diff;
    const swing = diff - baseline;
    console.log(
      `N=${n} Acolyte  winner=${result.winner.padEnd(5)} healthA(acolyte-side)=${String(result.healthA).padStart(5)} ` +
        `healthB(moe)=${String(result.healthB).padStart(5)} diff=${String(diff).padStart(6)}  swing-vs-N0=${(swing >= 0 ? '+' : '') + swing}`
    );
  }
  console.log('');
}
