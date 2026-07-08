/**
 * Buyable horde-slot pricing report (issue #9): derives the scrap cost of
 * purchasing an extra board slot beyond the day's natural `boardCapForDay`,
 * up to the hard `BOARD_CAP = 8` ceiling.
 *
 * Methodology mirrors `depth-scaling.ts`: a strong, actively-improving roster
 * (tiers/relics growing with the day) is simmed across many dates, comparing
 * avgDepth at a given board size N versus N+1. The wave-depth delta is then
 * converted into scrap terms via SCRAP_PER_DEPTH (1 scrap per wave, per
 * hourly ride) so a slot's price can be justified against how many hours of
 * extra income it takes to "earn back" — the ladder should make each slot a
 * genuine late-game sink (a multi-day payback), not a snowballing early buy.
 *
 * Run: npx tsx scripts/slot-value.ts   (from packages/core)
 */
import { generateGauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import type { Lineup } from '../src/data/units';
import { boardCapForDay, SCRAP_PER_DEPTH } from '../src/shop';
import { BOARD_CAP } from '../src/sim';

const START = '2026-07-06'; // synchronized-week Monday (day 1)
const SAMPLES = 400;

// Same roster shape as depth-scaling.ts's strong-player model, extended to
// fill all 8 possible slots (BOARD_CAP) so a purchased slot always has a
// plausible unit to seat.
const ORDER = [
  'dire-rat', 'warren-warden', 'corpse-glutton', 'gnawer',
  'bone-priest', 'plague-bearer', 'blight-witch', 'gutter-runt',
];
const FILLER_RELIC = 'fat-tick';

function rosterForCap(day: number, cap: number): Lineup {
  const tier = day <= 3 ? 1 : day <= 5 ? 2 : 3;
  const relicSlots = Math.min(cap, 1 + day);
  const units: Lineup['units'] = ORDER.slice(0, cap).map((defId, i) => ({
    defId,
    tier,
    relicIds: i < relicSlots && i !== 0 ? [FILLER_RELIC] : [],
  }));
  return { units, teamRelicIds: ['filth-totem'], combatCap: cap + 2 };
}

function avgDepthForCap(day: number, cap: number): number {
  const lineup = rosterForCap(day, cap);
  let total = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + s * 86_400_000).toISOString().slice(0, 10);
    total += simulate(lineup, generateGauntlet(date, day)).result.wavesCleared;
  }
  return total / SAMPLES;
}

console.log(`slot-value report — ${SAMPLES} dates per day/cap, roster from ${START}\n`);

// Purchased slots are additive to whatever the day's natural cap currently
// is (min-capped at BOARD_CAP): effectiveCap(day, s) = min(8, boardCapForDay(day) + s).
// So a slot bought on day 1 keeps paying off every day of the week, not just
// until the natural cap catches up to some fixed target — it's a persistent
// +1 (or +2, +3) on top of the day's own cap, until the sum hits BOARD_CAP.
const MAX_SLOTS = BOARD_CAP - boardCapForDay(1); // 8 - 5 = 3 purchasable slots

console.log('1) avgDepth per day at each purchased-slot count s (effectiveCap = min(8, boardCapForDay(day) + s)):');
console.log('day  natCap  s=0     s=1     s=2     s=3');
const depthTable: number[][] = []; // depthTable[day-1][s]
for (let day = 1; day <= 7; day++) {
  const nat = boardCapForDay(day);
  const row: number[] = [];
  for (let s = 0; s <= MAX_SLOTS; s++) {
    row.push(avgDepthForCap(day, Math.min(BOARD_CAP, nat + s)));
  }
  depthTable.push(row);
  console.log(
    `${day}    ${nat}       ${row.map((d) => d.toFixed(2).padStart(6)).join('  ')}`
  );
}

// 2) Marginal value of the Nth purchased slot (transition s-1 -> s), summed
// across all 7 days (x24 hourly rides) — the total scrap-equivalent value of
// owning that slot for an entire expedition, bought on day 1 and held.
console.log('\n2) Total scrap value of owning the Nth purchased slot for the whole week (bought day 1, x24 rides/day):');
console.log('slot#  sumDeltaWaves(7 days)  scrapValue(x24)');
const ladder: { slot: number; value: number }[] = [];
for (let s = 1; s <= MAX_SLOTS; s++) {
  let sumDelta = 0;
  for (let day = 1; day <= 7; day++) sumDelta += depthTable[day - 1][s] - depthTable[day - 1][s - 1];
  const value = sumDelta * SCRAP_PER_DEPTH * 24;
  ladder.push({ slot: s, value });
  console.log(`${s}      ${sumDelta.toFixed(2).padStart(6)}                 ${value.toFixed(0)}`);
}

// 3) Suggested price ladder. These numbers show each additional slot keeps
// roughly the same (even slightly rising, since day-4/6's deltas are bigger
// once tiers step up) week-long scrap value — nowhere near "pays for itself
// in an hour" territory (DAILY_SCRAP=24, so even the day-1 slot's full WEEK
// value is only ~1.5x one day's stipend). That means a price near the raw
// value is already a fair, non-snowballing sink: round up slightly per slot
// and keep the ladder strictly increasing so each successive slot (rarer
// board real-estate, nearer the hard BOARD_CAP) costs more.
console.log('\n3) Suggested price ladder (rounded up from derived weekly value, strictly increasing):');
let prevCost = 0;
for (const l of ladder) {
  let cost = Math.ceil(l.value / 4) * 4; // round up to nearest 4 scrap
  if (cost <= prevCost) cost = prevCost + 4;
  console.log(`  slot ${l.slot}: derived weekly value ${l.value.toFixed(0)} scrap -> price ${cost}`);
  prevCost = cost;
}
