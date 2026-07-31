/**
 * PvP cross-unit COMBO matrix (issue #154) — the two-unit-synergy companion to
 * pvp-unit-matrix.ts, RELIC-FREE.
 *
 * The singles/spam script is structurally blind to pair synergies, exactly like
 * all-unit-value is on the depth side (see combo-matrix.ts's header): its spam
 * lens is 8 copies of ONE unit, and its marginal lens swaps ONE unit into a
 * board of Dire-Rats. A kit whose payoff needs a PARTNER therefore reads as
 * dead. The textbook case (Jesper, 2026-07-31): Squeak-Sensei's `buffSummoned`
 * only fires on `allySummoned`, and Brood-Mother is the summon engine that
 * generates those events — neither does much beside a Dire-Rat, but together
 * Sensei pumps every broodling the cascade spawns. This script closes that hole
 * by brute force: EVERY unordered pair of units, in every placement that
 * matters, measured through the real duel engine.
 *
 * Method (mirrors combo-matrix.ts, but the metric is a DUEL not a gauntlet):
 * the reference is a full board of 8x Dire-Rat (strong, change-invariant — its
 * only trait is passive armor; same zero-line as pvp-unit-matrix lens B). We
 * swap the pair into the reference and duel it against the untouched reference;
 * the score is the survivor-health margin (healthA - healthB, the league's own
 * tiebreak quantity). Boards carry the realistic combatCap = board + summon
 * headroom, so summon cascades aren't throttled (the bug that made the singles
 * script understate Brood/Rat-Piper before this was fixed).
 *
 *   arrangements: front [A,B,dr,dr,...]  back [...,dr,A,B]  split [A,dr,...,B]
 *                 (and the B,A mirror of each when A != B) — best kept.
 *
 *   single(X) = best of front-slot / back-slot swap of X alone   (the lens-B number)
 *   pair(A,B) = best arrangement of the two swapped in
 *   synergy   = pair(A,B) - single(A) - single(B)
 *
 * synergy ~ 0  -> the two just add up; the singles tell the whole story.
 * synergy >> 0 -> a real combo the singles under-rate (Brood + Sensei).
 * synergy << 0 -> anti-synergy: they compete for the same finite payoff / seat.
 *
 * The loudest flag is "COMBO UNLOCKS A WIN": the pair beats the reference while
 * NEITHER unit does alone — the pair is a duel-viable build the singles score
 * as two losers. Determinism: duels have no RNG, so every number is exact.
 *
 * Run from the repo root:  npm run pvp:combos
 * (or from packages/core:  npx tsx scripts/pvp-combo-matrix.ts)
 */
import { simulateDuel } from '../src/duel';
import { UNIT_DEFS, type Lineup } from '../src/data/units';
import { BOARD_CAP, COMBAT_CAP_BONUS } from '../src/sim';
import { MAX_TIER } from '../src/shop';

const CAP = BOARD_CAP;
const COMBAT_CAP = CAP + COMBAT_CAP_BONUS; // real full-board summon headroom (see header)
const TANK = 'dire-rat';
const IDS = Object.keys(UNIT_DEFS).filter((id) => UNIT_DEFS[id].cost > 0);
const nameOf = (id: string) => UNIT_DEFS[id].name;

/** A reference board (8x Dire-Rat) with the given slots overridden. */
function board(placed: Record<number, string>, tier: number): Lineup {
  const units = Array.from({ length: CAP }, (_, i) => ({ defId: placed[i] ?? TANK, tier, relicIds: [] as string[] }));
  return { units, teamRelicIds: [], combatCap: COMBAT_CAP };
}

/** Survivor-health margin of `placed` against the untouched 8x Dire-Rat
 * reference: >0 the swapped board wins on margin, and `won` is the hard W/L. */
function versusReference(placed: Record<number, string>, tier: number): { diff: number; won: boolean } {
  const { result } = simulateDuel(board(placed, tier), board({}, tier));
  return { diff: result.healthA - result.healthB, won: result.winner === 'a' };
}

interface Single {
  diff: number;
  won: boolean;
}
interface PairRow {
  a: string;
  b: string;
  pairDiff: number;
  pairWon: boolean;
  synergy: number;
  arrangement: string;
  unlocks: boolean; // pair wins, neither single does
}

for (let tier = 1; tier <= MAX_TIER; tier++) {
  // Singles: best of a front-slot / back-slot swap (the lens-B measurement).
  const singles = new Map<string, Single>();
  for (const id of IDS) {
    const f = versusReference({ 0: id }, tier);
    const b = versusReference({ [CAP - 1]: id }, tier);
    singles.set(id, f.diff >= b.diff ? f : b);
  }

  const rows: PairRow[] = [];
  for (let i = 0; i < IDS.length; i++) {
    for (let j = i; j < IDS.length; j++) {
      const a = IDS[i];
      const b = IDS[j];
      const arrangements: { label: string; placed: Record<number, string> }[] = [
        { label: 'front A,B', placed: { 0: a, 1: b } },
        { label: 'back A,B', placed: { [CAP - 2]: a, [CAP - 1]: b } },
        { label: 'split A..B', placed: { 0: a, [CAP - 1]: b } },
      ];
      if (a !== b) {
        arrangements.push(
          { label: 'front B,A', placed: { 0: b, 1: a } },
          { label: 'back B,A', placed: { [CAP - 2]: b, [CAP - 1]: a } },
          { label: 'split B..A', placed: { 0: b, [CAP - 1]: a } }
        );
      }
      let best: { diff: number; won: boolean; label: string } | null = null;
      for (const arr of arrangements) {
        const m = versusReference(arr.placed, tier);
        if (!best || m.diff > best.diff) best = { ...m, label: arr.label };
      }
      const dA = singles.get(a)!;
      const dB = singles.get(b)!;
      rows.push({
        a,
        b,
        pairDiff: best!.diff,
        pairWon: best!.won,
        synergy: best!.diff - dA.diff - dB.diff,
        arrangement: best!.label,
        unlocks: best!.won && !dA.won && !dB.won,
      });
    }
  }

  rows.sort((x, y) => y.synergy - x.synergy);

  const label = (r: PairRow) => (r.a === r.b ? `${nameOf(r.a)} x2` : `${nameOf(r.a)} + ${nameOf(r.b)}`);
  const printRow = (r: PairRow) =>
    console.log(
      `${label(r).padEnd(34)} pair ${(r.pairDiff >= 0 ? '+' : '') + r.pairDiff}`.padEnd(52) +
        `synergy ${(r.synergy >= 0 ? '+' : '') + r.synergy}`.padEnd(16) +
        `${r.pairWon ? 'WIN ' : 'loss'}  best: ${r.arrangement}`
    );

  console.log(`\n############ TIER ${tier} ############`);

  const unlocks = rows.filter((r) => r.unlocks).sort((x, y) => y.pairDiff - x.pairDiff);
  console.log(`--- COMBO UNLOCKS A WIN: pair beats the reference, neither unit does alone (${unlocks.length}) ---`);
  if (unlocks.length === 0) console.log('(none)');
  for (const r of unlocks) printRow(r);

  console.log('\n--- TOP 15 BY SYNERGY (super-additive over the sum of the two singles) ---');
  for (const r of rows.slice(0, 15)) printRow(r);

  console.log('\n--- BOTTOM 5 (anti-synergy / saturation) ---');
  for (const r of rows.slice(-5)) printRow(r);
}

console.log(
  `\n(Relic-free, no cost normalization; survDiff scale grows with tier so compare RANKINGS, ` +
    `not raw numbers across tiers. synergy is vs the two units' own lens-B singles. ` +
    `Follow-up: the relic layer, and 3+-unit engines remain out of scope.)`
);
