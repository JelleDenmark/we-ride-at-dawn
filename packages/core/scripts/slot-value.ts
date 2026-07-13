/**
 * Buyable horde-slot pricing report (issue #70): derives the scrap cost of
 * purchasing an extra board slot beyond the constant `BOARD_FLOOR`, up to the
 * hard `BOARD_CAP = 8` ceiling.
 *
 * Post-#70, `boardCapForDay` no longer grows with the day — every slot beyond
 * `BOARD_FLOOR` is purchase-only, for the whole expedition. That means a
 * slot's value is no longer "how much sooner did I get to a cap I'd reach for
 * free anyway" (the pre-#70 methodology); it's "how much depth does this seat
 * add for every single day of the week, forever, since nothing replaces it
 * for free." So this script sims a strong, actively-improving roster
 * (tiers/relics growing with the day) at each board size 5..8 across all 7
 * days and converts the FULL wave-depth delta into scrap via
 * SCRAP_PER_DEPTH (1 scrap per wave, per hourly ride, x24 rides/day) — there
 * is no "natural cap" baseline to subtract out anymore, unlike the pre-#70
 * version of this script.
 *
 * Run: npx tsx scripts/slot-value.ts   (from packages/core)
 */
import { generateGauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import type { Lineup } from '../src/data/units';
import { BOARD_FLOOR, scrapForDepth, DAILY_SCRAP, SLOT_PRICES } from '../src/shop';
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

// Purchased slots are additive to the constant floor (min-capped at
// BOARD_CAP): effectiveCap(s) = min(8, BOARD_FLOOR + s). A slot bought on
// day 1 keeps paying off every day of the week — there's no natural cap
// left to "catch up" to it, so ALL of a slot's depth delta is attributable
// to the purchase, every day, until the sum hits BOARD_CAP.
const MAX_SLOTS = BOARD_CAP - BOARD_FLOOR; // 8 - 5 = 3 purchasable slots

console.log('1) avgDepth per day at each purchased-slot count s (effectiveCap = min(8, BOARD_FLOOR + s)):');
console.log('day  floor   s=0     s=1     s=2     s=3');
const depthTable: number[][] = []; // depthTable[day-1][s]
for (let day = 1; day <= 7; day++) {
  const row: number[] = [];
  for (let s = 0; s <= MAX_SLOTS; s++) {
    row.push(avgDepthForCap(day, Math.min(BOARD_CAP, BOARD_FLOOR + s)));
  }
  depthTable.push(row);
  console.log(
    `${day}    ${BOARD_FLOOR}       ${row.map((d) => d.toFixed(2).padStart(6)).join('  ')}`
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
  let value = 0;
  for (let day = 1; day <= 7; day++) {
    sumDelta += depthTable[day - 1][s] - depthTable[day - 1][s - 1];
    // Income delta is #90-aware: the extra waves this seat unlocks sit at the
    // TOP of the run (the deepest band), where scrapForDepth diminishes them —
    // so value the seat by the actual income gap between the two absolute
    // depths (x24 rides/day), not flat waves x SCRAP_PER_DEPTH.
    value += (scrapForDepth(depthTable[day - 1][s]) - scrapForDepth(depthTable[day - 1][s - 1])) * 24;
  }
  ladder.push({ slot: s, value });
  console.log(`${s}      ${sumDelta.toFixed(2).padStart(6)}                 ${value.toFixed(0)}`);
}

// 3) The per-slot marginal values above are LUMPY and order-dependent: which
// specific unit lands in each newly-opened seat is fixed by `ORDER` (a
// deliberate simplification — a real player chooses what fills a new slot,
// this script can't), so e.g. "slot 2 adds Blight-Witch" happening to be a
// much bigger depth swing than "slot 1 adds Plague-Bearer" or "slot 3 adds
// Gutter-Runt" is an artifact of that fixed roster order, not a real signal
// that slot 2 should cost 5x slot 1. Pricing directly off these marginals
// (as the pre-#70 version of this script did) would produce an erratic,
// order-dependent ladder. Instead, use the AGGREGATE value — the full climb
// from BOARD_FLOOR (5) to BOARD_CAP (8), bought day 1 and held the whole
// week — as the anchor for how big the total sink should be, and spread that
// budget across a smooth, strictly-increasing, steep ladder by hand (each
// slot roughly ~1.7-2x the previous), rather than chasing the noisy
// per-slot deltas slot by slot.
const totalWeeklyValue = ladder.reduce((a, l) => a + l.value, 0);
console.log(
  `\n3) Aggregate weekly scrap-equivalent value of the FULL climb (5->8, bought day 1, held all week): ${totalWeeklyValue.toFixed(0)} scrap`
);
console.log(
  `   (for scale: this is ${(totalWeeklyValue / DAILY_SCRAP).toFixed(1)}x DAILY_SCRAP=${DAILY_SCRAP} — the aggregate value of a full board across`
);
console.log(`    a whole week of hourly rides dwarfs one day's stipend, as expected; not a pricing target by itself.)`);

console.log('\n4) Chosen SLOT_PRICES ladder (hand-set, steep, strictly increasing — see src/shop.ts SLOT_PRICES doc):');
{
  let total = 0;
  for (let i = 0; i < SLOT_PRICES.length; i++) {
    total += SLOT_PRICES[i];
    console.log(`  slot ${i + 1}: price ${SLOT_PRICES[i]}  (running total to reach ${BOARD_FLOOR + i + 1}: ${total})`);
  }
  console.log(
    `  full climb (5->8) costs ${total} scrap total vs. the ${totalWeeklyValue.toFixed(0)}-scrap aggregate weekly value derived above` +
      ` (${((total / totalWeeklyValue) * 100).toFixed(0)}% of it) — priced BELOW raw value so it's earnable, not a value-neutral wall.`
  );
}
