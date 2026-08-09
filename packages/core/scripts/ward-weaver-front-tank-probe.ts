/**
 * THROWAWAY follow-up probe (2026-08-08): PART 3 of
 * ward-weaver-armor-cap-probe.ts swaps Ward-Weaver copies for Dire-Rat
 * filler to sweep N, but that's confounded — Dire-Rat (atk4, own armor) is
 * a much stronger attacker than Ward-Weaver (atk1) once it becomes the new
 * front after md-rattyfock dies, so the whole-board health margin mixes
 * "armor effect" with "attacker-identity effect". This probe isolates just
 * the armor effect on RatMoe's actual real front unit (md-rattyfock, index 0
 * in every N variant, so its identity never changes) by summing 'damage'
 * events targeting it specifically until it falls, for N=0..3.
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

function ratMoeWithN(n: number, tier: number): Lineup {
  const wards = Array.from({ length: n }, () => 'ward-weaver');
  const filler = Array.from({ length: 3 - n }, () => 'dire-rat');
  return board(['md-rattyfock', 'steel-whisker', ...wards, ...filler, 'gutter-gourmand', 'gutter-gourmand', 'draughtsman-moe'], tier);
}
const wellDressedRat3 = board(
  ['ward-weaver', 'grave-leech', 'press-kin', 'dire-rat', 'brood-mother', 'gutter-acolyte', 'draughtsman-moe', 'corpse-glutton'],
  3
);

console.log('=== Total damage taken by RatMoe\'s real front unit (md-rattyfock, T3) while it holds front, vs Well-Dressed-Rat ===\n');
for (const N of [0, 1, 2, 3]) {
  const ratMoe = ratMoeWithN(N, 3);
  const { events } = simulateDuel(ratMoe, wellDressedRat3);
  const battleStart = events.find((e) => e.type === 'battleStart');
  const mdId = battleStart && battleStart.type === 'battleStart' ? battleStart.horde[0].instanceId : undefined;
  let totalDamage = 0;
  let hits = 0;
  let survived = true;
  for (const e of events) {
    if (e.type === 'damage' && e.targetId === mdId) {
      totalDamage += e.amount;
      hits++;
      if (e.remainingHealth <= 0) survived = false;
    }
  }
  console.log(`N=${N} ward-weaver: md-rattyfock took ${hits} hits, total ${totalDamage} dmg, avg/hit ${(totalDamage / (hits || 1)).toFixed(1)}, ${survived ? 'SURVIVED as front' : 'DIED'}`);
}
