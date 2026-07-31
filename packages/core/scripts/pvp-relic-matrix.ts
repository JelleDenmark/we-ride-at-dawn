/**
 * PvP relic value matrix (issue #154) — the relic companion to
 * pvp-unit-matrix.ts, and the input for the owner's "cut relics down, maybe to
 * a single shop slot" decision (2026-07-31).
 *
 * Every relic was tuned against the 45-wave depth ladder, and a duel is ONE
 * wave (`currentWave === 1`, sim.ts) — which quietly guts the wave-keyed ones:
 *   - Glass Shard's bonus IS the wave number, so it's +1 in a duel (dead).
 *   - The "once per wave" vs "once per battle" distinction that separated Glass
 *     Shard from Tail-Charm collapses — one wave is one battle, so any
 *     first-hit / once-per relic fires exactly once regardless.
 * Meanwhile flat stats (Rusted Nail, the team buffs) and the tempo relics
 * (Marrow-Snap execute, Gore-Cleaver cleave) pay off in full in a single clash.
 * This measures all of that under the rules the league actually uses.
 *
 * Method (relic analog of pvp-unit-matrix lens B): the reference is a full
 * board of 8x Dire-Rat (strong, change-invariant, carries the realistic
 * combatCap). For each relic we add ONE copy — a unit relic on the best of the
 * front/behind Dire-Rat carrier, a team relic on the whole board — and duel
 * that board against the untouched reference. The score is survivor-health
 * margin (healthA - healthB, the league's own tiebreak) plus the hard W/L.
 * A relic that can't win a duel it's the only differentiator in is a relic the
 * PvP league would never miss.
 *
 * Front vs behind matters for the same reason relic-value.ts documents: Glass
 * Shard, Gore-Cleaver and Marrow-Snap are read only off the live FRONT unit's
 * relics each tick, and Weeping Boil / Tail-Charm need the carrier to actually
 * take lethal damage — all of which only happens up front. Best of the two kept.
 *
 * Determinism: duels have no RNG, so every number is exact. Cost is printed but
 * NOT normalized into the headline (a team relic legitimately buffs all 8
 * bodies) — compare within scope, and read this next to the PvE all-relic-value
 * report to keep/cut a relic on BOTH axes at once, never one in isolation.
 *
 * Run from the repo root:  npm run pvp:relics
 * (or from packages/core:  npx tsx scripts/pvp-relic-matrix.ts)
 */
import { simulateDuel } from '../src/duel';
import { RELIC_DEFS } from '../src/data/relics';
import { type Lineup } from '../src/data/units';
import { BOARD_CAP, COMBAT_CAP_BONUS } from '../src/sim';
import { MAX_TIER } from '../src/shop';

const CAP = BOARD_CAP;
const COMBAT_CAP = CAP + COMBAT_CAP_BONUS;
const TANK = 'dire-rat';
const RELIC_IDS = Object.keys(RELIC_DEFS);

/** Reference board: 8x Dire-Rat, optionally with `teamRelic` board-wide and
 * `unitRelic` on the carrier at slot `carrier`. */
function board(tier: number, opts: { unitRelic?: string; carrier?: number; teamRelic?: string } = {}): Lineup {
  const units = Array.from({ length: CAP }, (_, i) => ({
    defId: TANK,
    tier,
    relicIds: opts.unitRelic && i === opts.carrier ? [opts.unitRelic] : ([] as string[]),
  }));
  return { units, teamRelicIds: opts.teamRelic ? [opts.teamRelic] : [], combatCap: COMBAT_CAP };
}

function versusReference(withRelic: Lineup, tier: number): { diff: number; won: boolean } {
  const { result } = simulateDuel(withRelic, board(tier));
  return { diff: result.healthA - result.healthB, won: result.winner === 'a' };
}

interface RelicRow {
  id: string;
  diff: number;
  won: boolean;
  pos: 'front' | 'behind' | 'team';
}

console.log('=== PvP RELIC MATRIX (issue #154) — one relic added to an 8x Dire-Rat board, dueled vs the bare board ===');
console.log(`${RELIC_IDS.length} relics, tiers 1..${MAX_TIER}. Deterministic. survDiff>0 & WIN = the relic alone can carry the duel.\n`);

for (let tier = 1; tier <= MAX_TIER; tier++) {
  const rows: RelicRow[] = RELIC_IDS.map((id) => {
    const def = RELIC_DEFS[id];
    if (def.scope === 'team') {
      const m = versusReference(board(tier, { teamRelic: id }), tier);
      return { id, diff: m.diff, won: m.won, pos: 'team' as const };
    }
    const front = versusReference(board(tier, { unitRelic: id, carrier: 0 }), tier);
    const behind = versusReference(board(tier, { unitRelic: id, carrier: CAP - 1 }), tier);
    return front.diff >= behind.diff
      ? { id, diff: front.diff, won: front.won, pos: 'front' as const }
      : { id, diff: behind.diff, won: behind.won, pos: 'behind' as const };
  });

  rows.sort((a, b) => b.diff - a.diff);

  console.log(`############ TIER ${tier} ############`);
  console.log('relic                 scope  cost  result  survDiff  slot');
  for (const r of rows) {
    const def = RELIC_DEFS[r.id];
    const sd = (r.diff >= 0 ? '+' : '') + r.diff;
    const outcome = r.won ? 'WIN ' : r.diff === 0 ? 'draw' : 'loss';
    console.log(
      `${def.name.padEnd(21)} ${def.scope.padEnd(5)} ${String(def.cost).padStart(4)}  ${outcome}  ${sd.padStart(8)}  ${r.pos}`
    );
  }
  console.log('');
}

console.log(
  `(A team relic legitimately buffs all 8 bodies, so it outscores a single unit relic by construction — ` +
    `compare WITHIN scope. Glass Shard is the wave-scaling casualty (+1 in a one-wave duel). ` +
    `Read alongside PvE all-relic-value before cutting any relic.)`
);
