/**
 * THROWAWAY check (2026-08-07): in the real RatMoe-vs-Well-Dressed-Rat duel,
 * is poison's dominance driven by DEPTH (one victim tanking many ticks,
 * which decay curbs) or BREADTH (poisonAllEnemies hits every living enemy
 * at once, so 8 different victims each eat 2-4 ticks of near-full poison
 * before dying, which decay barely touches since the early ticks are still
 * high)? Groups poisonTick events by targetId to see how many ticks each
 * individual victim actually survived. Not wired into package.json.
 */
import { simulateDuel } from '../src/duel';
import type { Lineup } from '../src/data/units';
import { BOARD_CAP, COMBAT_CAP_BONUS } from '../src/sim';
import type { BattleEvent } from '../src/sim';

const CAP = BOARD_CAP;
const COMBAT_CAP = CAP + COMBAT_CAP_BONUS;

function board(defIds: string[], tier: number): Lineup {
  return { units: defIds.map((defId) => ({ defId, tier, relicIds: [] as string[] })), teamRelicIds: [], combatCap: COMBAT_CAP };
}

const ratMoe = board(
  ['md-rattyfock', 'steel-whisker', 'ward-weaver', 'ward-weaver', 'ward-weaver', 'gutter-gourmand', 'gutter-gourmand', 'draughtsman-moe'],
  3
);
const wellDressedRat = board(
  ['ward-weaver', 'grave-leech', 'press-kin', 'dire-rat', 'brood-mother', 'gutter-acolyte', 'draughtsman-moe', 'corpse-glutton'],
  3
);

const { events } = simulateDuel(ratMoe, wellDressedRat);
const sideOf = new Map<number, 'A' | 'B'>();
for (const e of events) {
  if (e.type === 'battleStart') for (const u of e.horde) sideOf.set(u.instanceId, 'A');
  if (e.type === 'waveStart') for (const u of e.enemies) sideOf.set(u.instanceId, 'B');
}

// Side B's Moe poisons side A. Group side-A poison ticks by which unit took them.
const byVictim = new Map<number, number[]>();
for (const e of events) {
  if (e.type !== 'poisonTick') continue;
  if (sideOf.get(e.targetId) !== 'A') continue;
  if (!byVictim.has(e.targetId)) byVictim.set(e.targetId, []);
  byVictim.get(e.targetId)!.push(e.amount);
}

console.log(`distinct side-A victims poisoned: ${byVictim.size}`);
let grandTotal = 0;
for (const [id, amounts] of byVictim) {
  const total = amounts.reduce((a, b) => a + b, 0);
  grandTotal += total;
  console.log(`  unit ${id}: ${amounts.length} ticks, amounts=[${amounts.join(',')}], total=${total}`);
}
console.log(`grand total poison dealt to side A: ${grandTotal}`);
console.log(`avg ticks survived per poisoned victim: ${(Array.from(byVictim.values()).reduce((a, v) => a + v.length, 0) / byVictim.size).toFixed(1)}`);
