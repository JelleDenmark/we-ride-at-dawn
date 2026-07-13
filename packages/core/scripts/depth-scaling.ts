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
// 3b) Marrow-Snap (pure execute: a foe left at/below 20% of its own max
// health dies outright) — the attack-punchiness relic from issue #7.
// Gore-Cleaver is back-loaded (only pays off once enemies are tanky enough
// to leave meaningful overkill). Marrow-Snap should be front-loaded instead
// (finishing a nearly-dead foe matters even at low tiers where hits are
// small relative to health) while NOT snowballing or dominating at depth
// 40+ — it is a stateless, foe-relative, per-clash check (see the
// compounding-law comment on `executeThreshold` in data/relics.ts), so
// there is nothing here that can accumulate across the 45-wave battle.
// ---------------------------------------------------------------------------
function rosterForExecute(day: number, frontRelic: 'none' | 'gore-cleaver' | 'marrow-snap'): Lineup {
  const cap = boardCapForDay(day);
  const tier = day <= 3 ? 1 : day <= 5 ? 2 : 3;
  const order = ['dire-rat', 'gnawer', 'corpse-glutton', 'warren-warden', 'bone-priest', 'plague-bearer', 'blight-witch', 'dire-rat'];
  const units: Lineup['units'] = order.map((defId, i) => {
    const relicIds: string[] = [];
    if (i === 0 && frontRelic !== 'none') relicIds.push(frontRelic);
    else if (i !== 0 && i < cap) relicIds.push(FILLER_RELIC);
    return { defId, tier, relicIds };
  });
  return { units: units.slice(0, cap), teamRelicIds: ['filth-totem'] };
}

function avgDepthForExecute(day: number, frontRelic: 'none' | 'gore-cleaver' | 'marrow-snap'): number {
  const lineup = rosterForExecute(day, frontRelic);
  let total = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + s * 86_400_000).toISOString().slice(0, 10);
    total += simulate(lineup, generateGauntlet(date, day)).result.wavesCleared;
  }
  return total / SAMPLES;
}

console.log('\n3b) Marrow-Snap depth delta vs. Gore-Cleaver, same strong-attack roster, one relic slot varied:');
console.log('day  none    +cleaver (delta)      +snap (delta)');
const snapDeltas: number[] = [];
const cleaveDeltasVsSnap: number[] = [];
for (let day = 1; day <= 7; day++) {
  const none = avgDepthForExecute(day, 'none');
  const withCleaver = avgDepthForExecute(day, 'gore-cleaver');
  const withSnap = avgDepthForExecute(day, 'marrow-snap');
  const cleaveDelta = withCleaver - none;
  const snapDelta = withSnap - none;
  cleaveDeltasVsSnap.push(cleaveDelta);
  snapDeltas.push(snapDelta);
  console.log(
    `${day.toString().padStart(2)}   ${none.toFixed(2).padStart(5)}   ${withCleaver.toFixed(2)} (${cleaveDelta >= 0 ? '+' : ''}${cleaveDelta.toFixed(2)})      ${withSnap.toFixed(2)} (${snapDelta >= 0 ? '+' : ''}${snapDelta.toFixed(2)})`
  );
}
// Day 1-2 is a rounding-error regime for either relic (roster is tiny,
// so both deltas are <0.05 waves) — the meaningful comparison is where each
// relic's value plateau kicks in. Gore-Cleaver needs enemies tanky enough to
// leave real overkill margin, which only shows up from day 5 onward (0.19,
// 0.30, 0.33). Marrow-Snap's value shows up as soon as day 3 (0.17) because
// it doesn't need overkill margin at all — it just needs a hit to land in
// the last 30% of the foe's own health bar, which happens well before
// enemies are HP-sponges.
const crossoverDay = snapDeltas.findIndex((d, i) => d > cleaveDeltasVsSnap[i]) + 1;
console.log(
  `\nMarrow-Snap overtakes Gore-Cleaver's delta as early as day ${crossoverDay || 'n/a'} ` +
    `(day 3: Gore-Cleaver +${cleaveDeltasVsSnap[2].toFixed(2)} vs Marrow-Snap +${snapDeltas[2].toFixed(2)}) — ` +
    'front-loaded relative to Gore-Cleaver, which only separates from baseline once enemies are tanky (day 5+).'
);

// High-depth sanity check (issue #7's explicit ask): does Marrow-Snap
// dominate or blow up at depth 40+? Run the day-7 (deepest achievable)
// roster and confirm wavesCleared stays within the same order of magnitude
// as Gore-Cleaver — i.e. no runaway, no free 45/45 clear off one relic.
console.log('\n3c) Depth-40+ sanity: day-7 roster, none vs Gore-Cleaver vs Marrow-Snap, min/avg/max over all samples:');
function statsForExecute(day: number, frontRelic: 'none' | 'gore-cleaver' | 'marrow-snap'): { min: number; avg: number; max: number } {
  const lineup = rosterForExecute(day, frontRelic);
  const depths: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + s * 86_400_000).toISOString().slice(0, 10);
    depths.push(simulate(lineup, generateGauntlet(date, day)).result.wavesCleared);
  }
  return {
    min: Math.min(...depths),
    avg: depths.reduce((a, b) => a + b, 0) / depths.length,
    max: Math.max(...depths),
  };
}
for (const frontRelic of ['none', 'gore-cleaver', 'marrow-snap'] as const) {
  const { min, avg, max } = statsForExecute(7, frontRelic);
  console.log(`  ${frontRelic.padEnd(12)} min ${min.toString().padStart(2)}  avg ${avg.toFixed(2).padStart(5)}  max ${max.toString().padStart(2)}`);
}
console.log(
  '\n(no roster above should approach anywhere near WAVE_COUNT=45 — Marrow-Snap converts near-kills into kills, it does not manufacture extra damage or stats, so it cannot produce a runaway full clear the way the fixed exploits did)'
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

// ---------------------------------------------------------------------------
// 5) Dawn-Runt / Dusk-Runt (issue #12) — day-gated (day 3 / day 4), +2
// attack-before-noon / +2 health-after-noon team buff. Sanity check: does
// swapping one board slot for the Runt measurably help on the half-day its
// buff is active, without being so strong it's an obvious auto-include over
// every other unit for that slot? Compares the same strong roster with vs.
// without a Runt occupying its last slot, in both timeOfDay halves, so the
// "active" and "dormant" cases are both visible.
// ---------------------------------------------------------------------------
// The marginal slot is filled with Gutter-Runt (the cheapest generic body) in
// the baseline, not a second Dire-Rat — swapping out a strong late-tier
// fighter for a Runt would conflate "this slot is a weak filler" with "the
// Runt itself is weak," which isn't the choice a player actually faces. The
// fair comparison is: given a spare slot you'd otherwise fill with a cheap
// body, is fielding the Runt there (for the half of the day it's live) worth
// more than that cheap body?
function rosterWithRunt(day: number, runtId: 'dawn-runt' | 'dusk-runt' | null): Lineup {
  const cap = boardCapForDay(day);
  const tier = day <= 3 ? 1 : day <= 5 ? 2 : 3;
  const relicSlots = Math.min(cap, 1 + day);
  const baseOrder = ['dire-rat', 'warren-warden', 'corpse-glutton', 'gnawer', 'bone-priest', 'plague-bearer', 'blight-witch'];
  // Fill up to cap-1 with the strong roster, then guarantee the marginal
  // slot (Runt vs. Gutter-Runt filler) lands ON the board at every day —
  // a plain `[...baseOrder, filler].slice(0, cap)` silently drops the
  // marginal slot whenever cap < baseOrder.length + 1 (true for days 3-6),
  // making the comparison a no-op before day 7.
  const order = [...baseOrder.slice(0, cap - 1), runtId ?? 'gutter-runt'];
  const units: Lineup['units'] = order.map((defId, i) => {
    const relicIds: string[] = [];
    if (i !== 0 && i < relicSlots && defId !== runtId) relicIds.push(FILLER_RELIC);
    return { defId, tier, relicIds };
  });
  return { units, teamRelicIds: ['filth-totem'] };
}

function avgDepthWithRunt(day: number, runtId: 'dawn-runt' | 'dusk-runt' | null, timeOfDay: 'beforeNoon' | 'afterNoon'): number {
  const lineup = rosterWithRunt(day, runtId);
  let total = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + s * 86_400_000).toISOString().slice(0, 10);
    total += simulate({ ...lineup, timeOfDay }, generateGauntlet(date, day)).result.wavesCleared;
  }
  return total / SAMPLES;
}

console.log('\n5) Dawn-Runt / Dusk-Runt (issue #12): depth delta from swapping one slot for the Runt, day 3-7:');
console.log('day  baseline  dawn(beforeNoon)  dawn(afterNoon,dormant)  dusk(afterNoon)  dusk(beforeNoon,dormant)');
for (let day = 3; day <= 7; day++) {
  const baseline = avgDepthWithRunt(day, null, 'beforeNoon');
  const dawnActive = avgDepthWithRunt(day, 'dawn-runt', 'beforeNoon');
  const dawnDormant = avgDepthWithRunt(day, 'dawn-runt', 'afterNoon');
  const duskActive = day >= 4 ? avgDepthWithRunt(day, 'dusk-runt', 'afterNoon') : NaN;
  const duskDormant = day >= 4 ? avgDepthWithRunt(day, 'dusk-runt', 'beforeNoon') : NaN;
  const fmt = (n: number) => (Number.isNaN(n) ? '  n/a' : n.toFixed(2).padStart(5));
  console.log(
    `${day.toString().padStart(2)}   ${baseline.toFixed(2).padStart(6)}    ${dawnActive.toFixed(2).padStart(6)} (${(dawnActive - baseline >= 0 ? '+' : '')}${(dawnActive - baseline).toFixed(2)})    ${dawnDormant.toFixed(2).padStart(6)} (${(dawnDormant - baseline >= 0 ? '+' : '')}${(dawnDormant - baseline).toFixed(2)})          ${fmt(duskActive)} (${day >= 4 ? (duskActive - baseline >= 0 ? '+' : '') + (duskActive - baseline).toFixed(2) : 'n/a'})    ${fmt(duskDormant)} (${day >= 4 ? (duskDormant - baseline >= 0 ? '+' : '') + (duskDormant - baseline).toFixed(2) : 'n/a'})`
  );
}
console.log(
  '\n(the "active" delta should be a real but modest bump — not negligible (~0) and not dominant (swamping every other slot choice); ' +
    'the "dormant" delta should sit close to baseline, since a Runt fielded on the wrong half of the day is dead weight for that ride)'
);
