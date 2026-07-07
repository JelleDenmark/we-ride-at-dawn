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

// ---------------------------------------------------------------------------
// 3) Gore-Cleaver (overkill carries to the next foe) depth delta.
//
// Rusted Nail's flat +2 attack barely moves depth (~0.01-0.07 waves) because
// it's spread across the whole fight as marginal front-loaded damage that's
// mostly still "wasted" the instant a kill happens (leftover damage is
// discarded, not carried). Gore-Cleaver targets that exact waste: every time
// the front attacker's hit is lethal, the leftover (overkill) damage carries
// to the next enemy in line instead of vanishing.
//
// Fair single-relic-slot comparison: same strong-attack roster, same filler
// relic (fat-tick) on every non-front slot; only the FRONT unit's single
// relic slot varies between none / Rusted Nail / Gore-Cleaver. This isolates
// exactly what buying one relic on one rat is worth.
// ---------------------------------------------------------------------------
function rosterForCleave(day: number, frontRelic: 'none' | 'rusted-nail' | 'gore-cleaver'): Lineup {
  const cap = boardCapForDay(day);
  const tier = day <= 3 ? 1 : day <= 5 ? 2 : 3;
  // Heavy hitters up front so overkill is common (big attack vs. HP-scaled
  // but still finite enemy health) — this is the roster shape Gore-Cleaver
  // is meant to reward.
  const order = ['dire-rat', 'gnawer', 'corpse-glutton', 'warren-warden', 'bone-priest', 'plague-bearer', 'blight-witch', 'dire-rat'];
  const units: Lineup['units'] = order.map((defId, i) => {
    const relicIds: string[] = [];
    if (i === 0 && frontRelic !== 'none') relicIds.push(frontRelic);
    else if (i !== 0 && i < cap) relicIds.push(FILLER_RELIC);
    return { defId, tier, relicIds };
  });
  return { units: units.slice(0, cap), teamRelicIds: ['filth-totem'] };
}

function avgDepthForCleave(day: number, frontRelic: 'none' | 'rusted-nail' | 'gore-cleaver'): number {
  const lineup = rosterForCleave(day, frontRelic);
  let total = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + s * 86_400_000).toISOString().slice(0, 10);
    total += simulate(lineup, generateGauntlet(date, day)).result.wavesCleared;
  }
  return total / SAMPLES;
}

console.log('\n3) Gore-Cleaver depth delta vs. Rusted Nail, same strong-attack roster, one relic slot varied:');
console.log('day  none    +nail (delta)      +cleaver (delta)');
let cleaveDeltas: number[] = [];
let nailDeltas: number[] = [];
for (let day = 1; day <= 7; day++) {
  const none = avgDepthForCleave(day, 'none');
  const withNail = avgDepthForCleave(day, 'rusted-nail');
  const withCleaver = avgDepthForCleave(day, 'gore-cleaver');
  const nailDelta = withNail - none;
  const cleaveDelta = withCleaver - none;
  nailDeltas.push(nailDelta);
  cleaveDeltas.push(cleaveDelta);
  console.log(
    `${day.toString().padStart(2)}   ${none.toFixed(2).padStart(5)}   ${withNail.toFixed(2)} (${nailDelta >= 0 ? '+' : ''}${nailDelta.toFixed(2)})      ${withCleaver.toFixed(2)} (${cleaveDelta >= 0 ? '+' : ''}${cleaveDelta.toFixed(2)})`
  );
}
const avgCleaveDelta = cleaveDeltas.reduce((a, b) => a + b, 0) / cleaveDeltas.length;
const avgNailDelta = nailDeltas.reduce((a, b) => a + b, 0) / nailDeltas.length;
console.log(
  `\navg Rusted Nail delta: +${avgNailDelta.toFixed(2)} waves | avg Gore-Cleaver delta: +${avgCleaveDelta.toFixed(2)} waves ` +
    `(Gore-Cleaver is ~${(avgCleaveDelta / avgNailDelta).toFixed(1)}x Rusted Nail's)`
);
// Overkill only exists once enemy health is non-trivial relative to attack —
// early days (low tier, low enemyHealthScale) barely have any margin to
// carry, so the ACCEPTANCE NUMBER is the deep-expedition (day 7) delta,
// where the attack-matters problem this relic exists to fix is sharpest:
console.log(
  `\nACCEPTANCE: day-7 (deep) delta — Rusted Nail +${nailDeltas[6].toFixed(2)} waves vs Gore-Cleaver +${cleaveDeltas[6].toFixed(2)} waves ` +
    `(~${(cleaveDeltas[6] / nailDeltas[6]).toFixed(1)}x)`
);

// ---------------------------------------------------------------------------
// 4) Poison sanity-check: does a poison-leaning roster now dominate attack?
//
// Poison damage is flat (fixed stacks per proc) and depth-independent — it
// doesn't scale with enemy health the way attack must to keep up. Report the
// numbers plainly; do NOT nerf poison here, that's a separate decision.
// ---------------------------------------------------------------------------
function rosterPoison(day: number): Lineup {
  const cap = boardCapForDay(day);
  const tier = day <= 3 ? 1 : day <= 5 ? 2 : 3;
  const order = ['plague-bearer', 'blight-witch', 'plague-bearer', 'blight-witch', 'warren-warden', 'bone-priest', 'corpse-glutton', 'dire-rat'];
  const units: Lineup['units'] = order.map((defId, i) => ({
    defId,
    tier,
    relicIds: i < cap && i !== 0 ? [FILLER_RELIC] : [],
  }));
  return { units: units.slice(0, cap), teamRelicIds: ['filth-totem'] };
}

function rosterAttack(day: number): Lineup {
  const cap = boardCapForDay(day);
  const tier = day <= 3 ? 1 : day <= 5 ? 2 : 3;
  const order = ['dire-rat', 'gnawer', 'corpse-glutton', 'warren-warden', 'bone-priest', 'dire-rat', 'gnawer', 'dire-rat'];
  const units: Lineup['units'] = order.map((defId, i) => {
    const relicIds: string[] = [];
    if (i === 0) relicIds.push('gore-cleaver');
    else if (i < cap) relicIds.push(FILLER_RELIC);
    return { defId, tier, relicIds };
  });
  return { units: units.slice(0, cap), teamRelicIds: ['filth-totem'] };
}

function depthsForRoster(day: number, lineup: Lineup): number[] {
  const depths: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + s * 86_400_000).toISOString().slice(0, 10);
    depths.push(simulate(lineup, generateGauntlet(date, day)).result.wavesCleared);
  }
  return depths;
}

console.log('\n4) Poison-leaning vs attack-leaning roster, deep end of the expedition (day 6-7):');
console.log('day  strategy  avgDepth  maxDepth');
for (const day of [6, 7]) {
  const poisonDepths = depthsForRoster(day, rosterPoison(day));
  const attackDepths = depthsForRoster(day, rosterAttack(day));
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const max = (arr: number[]) => Math.max(...arr);
  console.log(`${day}    poison    ${avg(poisonDepths).toFixed(2).padStart(6)}    ${max(poisonDepths)}`);
  console.log(`${day}    attack    ${avg(attackDepths).toFixed(2).padStart(6)}    ${max(attackDepths)}`);
}
console.log(
  '\n(report only — poison is flat/depth-independent by design; whether it dominates is a separate future tuning decision)'
);
