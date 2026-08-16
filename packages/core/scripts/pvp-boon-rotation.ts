/** Scratch: rotation quality of the LIVE `boonsFor`, now that it carries the
 * no-consecutive-repeat rule. Complements boon-rotation.ts, which models pool
 * SIZE against the older unfiltered draw. */
import { BOON_DEFS, BOONS_PER_DAY, BOON_FIRST_DATE, boonsFor } from '../src/boons';
import { weekdayFor } from '../src/shop';

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEKS = 520;
const pool = Object.keys(BOON_DEFS).length;

let distinct = 0;
let never = 0;
let thrice = 0;
let adjacentRepeats = 0;
let boundaryRepeats = 0;
let pairs = 0;
let boundaries = 0;
let identicalTrioWeeks = 0;
let gapTwoRepeats = 0;
let gapTwoPairs = 0;

for (let w = 0; w < WEEKS; w++) {
  const start = addDays(BOON_FIRST_DATE, w * 7);
  const days = Array.from({ length: 7 }, (_, d) => boonsFor(addDays(start, d)).map((b) => b.id));
  const counts = new Map<string, number>();
  for (const trio of days) for (const id of trio) counts.set(id, (counts.get(id) ?? 0) + 1);

  distinct += counts.size;
  never += pool - counts.size;
  thrice += [...counts.values()].filter((c) => c >= 3).length;

  for (let d = 1; d < 7; d++) {
    const overlap = days[d].filter((id) => days[d - 1].includes(id)).length;
    adjacentRepeats += overlap;
    pairs++;
  }
  for (let d = 2; d < 7; d++) {
    gapTwoRepeats += days[d].filter((id) => days[d - 2].includes(id)).length;
    gapTwoPairs++;
  }
  // Same three cards twice in one season, at any gap.
  const keys = days.map((t) => [...t].sort().join('|'));
  if (new Set(keys).size < keys.length) identicalTrioWeeks++;

  // Sunday of this week -> Monday of the next: the one pair the rule allows.
  const sunday = boonsFor(addDays(start, 6)).map((b) => b.id);
  const nextMonday = boonsFor(addDays(start, 7)).map((b) => b.id);
  boundaryRepeats += nextMonday.filter((id) => sunday.includes(id)).length;
  boundaries++;
}

console.log(`Live pool ${pool}, ${BOONS_PER_DAY}/day, over ${WEEKS} seasons\n`);
console.log(`  distinct boons seen per season   ${(distinct / WEEKS).toFixed(1)} / ${pool}`);
console.log(`  never seen in a season           ${(never / WEEKS).toFixed(1)}`);
console.log(`  offered 3+ times in a season     ${(thrice / WEEKS).toFixed(1)}`);
console.log(`  adjacent-day repeats (in-season) ${(adjacentRepeats / pairs).toFixed(3)}  <- the rule`);
console.log(`  repeats across a 1-day gap       ${(gapTwoRepeats / gapTwoPairs).toFixed(2)}`);
console.log(`  Sun->Mon repeats (allowed)       ${(boundaryRepeats / boundaries).toFixed(2)}`);
console.log(`  seasons repeating a WHOLE trio   ${((100 * identicalTrioWeeks) / WEEKS).toFixed(1)}%`);

// How much of the season does a given weekday's offer depend on? Sanity that
// the recursion depth really is bounded by weekday.
const probe = addDays(BOON_FIRST_DATE, 6);
console.log(`\n  weekday of ${probe} = ${weekdayFor(probe)} (recursion depth ${weekdayFor(probe) - 1})`);
