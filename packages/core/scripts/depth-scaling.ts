/**
 * Depth-scaling balance report: proves the two properties the wave-depth
 * enemy-stat-scaling change (see sim.ts's enemyHealthScale/enemyAttackScale)
 * is meant to guarantee:
 *
 *   1. Achievable depth for a strong, roster-growing player rises
 *      monotonically across the 7-day expedition, peaking on day 7 — never
 *      an early-day sweet spot, since the leaderboard metric is max depth
 *      over the whole week.
 *   2. An attack-buffing relic (Rusted Nail, +2 attack) now measurably
 *      improves max depth, where before this change it produced ~0 delta
 *      (combat overkill was entirely wasted against low, non-scaling
 *      enemy HP).
 *
 * Run from the repo root: npm run balance:depth
 */
import { generateGauntlet, difficultyForDay } from '../src/gauntlet';
import { simulate } from '../src/sim';
import type { Lineup } from '../src/data/units';
import { boardCapForDay } from '../src/shop';

const START = '2026-07-06'; // a synchronized-week Monday (day 1)
const SAMPLES = 400; // dates averaged per day, to smooth per-date theme noise

// Ordered front-to-back. Represents a strong, actively-improving player:
// board size follows the real boardCapForDay curve; tiers and relics grow
// smoothly with the day (merges + relic buys funded by rising idle scrap),
// front-loaded onto the units that actually matter in combat.
const ORDER = [
  'dire-rat', 'warren-warden', 'corpse-glutton', 'gnawer',
  'bone-priest', 'plague-bearer', 'blight-witch', 'dire-rat',
];
// fat-tick (+1/+2, heals every tick) has a live-battle effect on any slot,
// unlike glass-shard (one-time) or weeping-boil (only procs on faint) —
// keeps the roster's growth signal free of "wasted relic" artifacts.
const FILLER_RELIC = 'fat-tick';

function rosterForDay(day: number, withRustedNail: boolean): Lineup {
  const cap = boardCapForDay(day);
  const tier = day <= 3 ? 1 : day <= 5 ? 2 : 3;
  const relicSlots = Math.min(cap, 1 + day); // grows every day: 2,3,4,5,6,7,8

  const units: Lineup['units'] = ORDER.map((defId, i) => {
    const relicIds: string[] = [];
    if (withRustedNail && i === 0) relicIds.push('rusted-nail');
    else if (i < relicSlots && i !== 0) relicIds.push(FILLER_RELIC);
    return { defId, tier, relicIds };
  });
  return { units: units.slice(0, cap), teamRelicIds: ['filth-totem'] };
}

function avgDepthForDay(day: number, withNail: boolean): number {
  const lineup = rosterForDay(day, withNail);
  let total = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + s * 86_400_000).toISOString().slice(0, 10);
    total += simulate(lineup, generateGauntlet(date, day)).result.wavesCleared;
  }
  return total / SAMPLES;
}

console.log(`depth-scaling report — ${SAMPLES} dates per day, roster from ${START}\n`);

console.log('difficultyForDay (day-scaling is the SECONDARY, modest lever):');
for (let d = 1; d <= 7; d++) console.log(`  day ${d}: ${difficultyForDay(d).toFixed(3)}x`);
console.log('');

console.log('1) Achievable depth per expedition day (strong, growing roster):');
console.log('day  boardCap  tier  relicSlots  avgDepth');
const depths: number[] = [];
for (let day = 1; day <= 7; day++) {
  const tier = day <= 3 ? 1 : day <= 5 ? 2 : 3;
  const relicSlots = Math.min(boardCapForDay(day), 1 + day);
  const depth = avgDepthForDay(day, false);
  depths.push(depth);
  console.log(
    `${day.toString().padStart(2)}   ${boardCapForDay(day).toString().padStart(6)}    ${tier}     ${relicSlots.toString().padStart(3)}         ${depth.toFixed(2)}`
  );
}
const monotonic = depths.every((d, i) => i === 0 || d >= depths[i - 1] - 1e-6);
const peakDay = depths.indexOf(Math.max(...depths)) + 1;
console.log(`monotonic non-decreasing: ${monotonic}, peak day: ${peakDay}\n`);

console.log('2) Rusted Nail (+2 atk on the front unit) depth delta, per day:');
console.log('day  without  with    delta');
let allPositive = true;
for (let day = 1; day <= 7; day++) {
  const without = avgDepthForDay(day, false);
  const withNail = avgDepthForDay(day, true);
  const delta = withNail - without;
  if (delta <= 0) allPositive = false;
  console.log(
    `${day.toString().padStart(2)}   ${without.toFixed(2).padStart(7)}  ${withNail.toFixed(2).padStart(6)}  ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`
  );
}
console.log(`\nRusted Nail delta positive on every expedition day: ${allPositive}`);
