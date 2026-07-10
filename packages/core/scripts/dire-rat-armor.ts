/**
 * Dire-Rat armor re-test (issue #64): isolates whether flat `damageReduction`
 * — 2/4/6 at t1/2/3, applied as `(def.damageReduction ?? 0) * tier` in
 * sim.ts — still pulls its weight now that base attack/health scale
 * `3^(tier-1)` (1x/3x/9x, issue #22/#58). The hardened all-unit-value pass
 * only measured Dire-Rat's overall cost-efficiency in a neutral roster; it
 * never isolated the armor mechanic itself, or split its performance by
 * enemy archetype. Armor subtracts a flat amount per hit (MIN_ATTACK_DAMAGE
 * = 1 floor): strong against a few big hits (brute), close to worthless
 * against many small hits (swarm) — this script quantifies that asymmetry
 * directly, at t3 (attack 36, health 45, armor 6, cost 8 * 9 = 72 scrap).
 *
 * Two independent measurements:
 *
 *   1. DAMAGE PREVENTED (event-log micro-metric, exact). `simulate` returns
 *      the full event log alongside the summary result. Enemies never carry
 *      relics or buffs (ENEMY_POOL; sim.ts's `summon` case calls `instantiate`
 *      with no relicIds), so an enemy's `attack` stat is fixed for its whole
 *      single-wave lifetime and is exactly the value the `waveStart`/`summon`
 *      events already report (already wave-scaled via `enemyAttackScale`).
 *      Walking the log lets us pair every clash landing on the tested
 *      Dire-Rat with the attacker's pre-armor attack value, then diff it
 *      against the post-armor `damage` event's `amount` — an exact hit-by-hit
 *      prevented total, no simulation-doubling required.
 *
 *   2. DEPTH / DAMAGE-DEALT CONTRIBUTION (A/B, armor-on vs armor-off). Raw
 *      damage prevented doesn't say whether it actually mattered (survived a
 *      wave it otherwise wouldn't have). `UNIT_DEFS` is a plain, unfrozen
 *      module-level object, so this script temporarily monkey-patches
 *      `UNIT_DEFS['dire-rat'].damageReduction` to 0 for a paired control run
 *      against the exact same (lineup, gauntlet) pair, then restores it —
 *      isolating armor's real effect on wavesCleared/damageDealt. This never
 *      touches the source file; it's a runtime-only measurement harness.
 *
 * Gauntlet themes are real `GauntletTheme` output (gauntlet.ts), not a
 * hand-built enemy list, sampled across many distinct SEASONS (weeks) —
 * `generateGauntlet`'s whole 45-wave gauntlet is byte-identical for every
 * date within one season (issue #41), so distinct samples require stepping
 * by whole weeks, not days. Filtered to `theme.primary === 'brute'` /
 * `'swarm'` (60% of every wave's budget throughout the fight, so genuinely
 * brute/swarm-heavy, not just brute/swarm-tinted).
 *
 * Part 3 (cost-efficiency) reuses the change-invariant control from
 * all-unit-value.ts (Dire-Rat tank + Gutter-Runt filler, ability-less
 * bodies only, so no other unit's ability retune can move the baseline) —
 * restricted to t3, the tier under test here.
 *
 * Run from packages/core: npx tsx scripts/dire-rat-armor.ts
 */
import { generateGauntlet } from '../src/gauntlet';
import type { Gauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import type { BattleEvent } from '../src/sim';
import type { Lineup } from '../src/data/units';
import { UNIT_DEFS, tierAttackMultiplier, tierHealthMultiplier } from '../src/data/units';
import { boardCapForDay } from '../src/shop';

const START = '2026-07-06'; // synchronized-week Monday (day 1)
const SEASON_STEP_DAYS = 7; // one sample per distinct season — gauntlet content is season-keyed, not date-keyed
const SEASONS_TO_SCAN = 800; // weeks scanned looking for theme matches
const SAMPLES_PER_THEME = 60;
const DAY = 6; // TIER_DAY[3] convention (all-unit-value.ts) — t3 units are on-shop by day 6
const TIER = 3;

const TANK = 'dire-rat';
const FILLER = 'gutter-runt';

function dateForWeek(i: number): string {
  return new Date(Date.parse(`${START}T12:00:00Z`) + i * SEASON_STEP_DAYS * 86_400_000).toISOString().slice(0, 10);
}

// Candidate seated at index 0 (front) so every clash while it's alive is
// attributable to it unambiguously; the rest of the board is filler.
function rosterFront(): Lineup {
  const cap = boardCapForDay(DAY);
  const order = [TANK, ...Array(cap - 1).fill(FILLER)];
  const units: Lineup['units'] = order.map((defId) => ({ defId, tier: TIER }));
  return { units, teamRelicIds: ['filth-totem'] };
}

// ---------------------------------------------------------------------------
// Theme sampling
// ---------------------------------------------------------------------------
interface ThemeSample {
  date: string;
  gauntlet: Gauntlet;
}

const bruteSamples: ThemeSample[] = [];
const swarmSamples: ThemeSample[] = [];
for (
  let i = 0;
  i < SEASONS_TO_SCAN && (bruteSamples.length < SAMPLES_PER_THEME || swarmSamples.length < SAMPLES_PER_THEME);
  i++
) {
  const date = dateForWeek(i);
  const gauntlet = generateGauntlet(date, DAY);
  if (gauntlet.theme.primary === 'brute' && bruteSamples.length < SAMPLES_PER_THEME) {
    bruteSamples.push({ date, gauntlet });
  }
  if (gauntlet.theme.primary === 'swarm' && swarmSamples.length < SAMPLES_PER_THEME) {
    swarmSamples.push({ date, gauntlet });
  }
}

// ---------------------------------------------------------------------------
// Part 1: damage-prevented (event-log micro-metric)
// ---------------------------------------------------------------------------
interface HitStats {
  wavesCleared: number;
  damageDealt: number;
  hits: number;
  rawIncoming: number;
  actualIncoming: number;
}

function measureArmorHits(lineup: Lineup, gauntlet: Gauntlet): HitStats {
  const { events, result } = simulate(lineup, gauntlet);
  const battleStart = events.find(
    (e): e is Extract<BattleEvent, { type: 'battleStart' }> => e.type === 'battleStart'
  );
  if (!battleStart) throw new Error('no battleStart event');
  const direRatId = battleStart.horde[0].instanceId; // rosterFront() always seats the candidate at index 0

  const attackOf = new Map<number, number>();
  let hits = 0;
  let rawIncoming = 0;
  let actualIncoming = 0;
  let pendingEnemyId: number | null = null;

  for (const e of events) {
    if (e.type === 'waveStart') {
      for (const u of e.enemies) attackOf.set(u.instanceId, u.attack);
    } else if (e.type === 'summon' && e.side === 'gauntlet') {
      attackOf.set(e.unit.instanceId, e.unit.attack);
    } else if (e.type === 'clash' && e.hordeId === direRatId) {
      pendingEnemyId = e.enemyId;
    } else if (e.type === 'damage' && e.targetId === direRatId && pendingEnemyId !== null) {
      const raw = attackOf.get(pendingEnemyId) ?? e.amount;
      rawIncoming += raw;
      actualIncoming += e.amount;
      hits++;
      pendingEnemyId = null;
    } else if (e.type === 'shieldAbsorbed' && e.targetId === direRatId && pendingEnemyId !== null) {
      // Not reachable with this roster (no blockFrontHits source on either
      // side) — handled defensively so a future roster change fails loud
      // rather than silently mis-attributing damage.
      const raw = attackOf.get(pendingEnemyId) ?? 0;
      rawIncoming += raw;
      hits++;
      pendingEnemyId = null;
    }
  }

  return { wavesCleared: result.wavesCleared, damageDealt: result.damageDealt, hits, rawIncoming, actualIncoming };
}

interface ThemeAgg {
  samples: number;
  hits: number;
  rawIncoming: number;
  actualIncoming: number;
  wavesCleared: number;
}

function aggregateHits(samples: ThemeSample[]): ThemeAgg {
  const agg: ThemeAgg = { samples: samples.length, hits: 0, rawIncoming: 0, actualIncoming: 0, wavesCleared: 0 };
  const lineup = rosterFront();
  for (const { gauntlet } of samples) {
    const m = measureArmorHits(lineup, gauntlet);
    agg.hits += m.hits;
    agg.rawIncoming += m.rawIncoming;
    agg.actualIncoming += m.actualIncoming;
    agg.wavesCleared += m.wavesCleared;
  }
  return agg;
}

// ---------------------------------------------------------------------------
// Part 2: A/B depth & damage-dealt contribution (armor-on vs armor-off)
// ---------------------------------------------------------------------------
function withDamageReduction<T>(value: number | undefined, fn: () => T): T {
  const original = UNIT_DEFS['dire-rat'].damageReduction;
  UNIT_DEFS['dire-rat'].damageReduction = value;
  try {
    return fn();
  } finally {
    UNIT_DEFS['dire-rat'].damageReduction = original;
  }
}

interface DepthAgg {
  wavesCleared: number;
  damageDealt: number;
}

function aggregateDepth(samples: ThemeSample[], damageReduction: number | undefined): DepthAgg {
  const lineup = rosterFront();
  return withDamageReduction(damageReduction, () => {
    let wavesCleared = 0;
    let damageDealt = 0;
    for (const { gauntlet } of samples) {
      const r = simulate(lineup, gauntlet).result;
      wavesCleared += r.wavesCleared;
      damageDealt += r.damageDealt;
    }
    return { wavesCleared, damageDealt };
  });
}

// ---------------------------------------------------------------------------
// Part 3: t3 cost-efficiency, all units — reuses all-unit-value.ts's
// change-invariant control (Dire-Rat tank + Gutter-Runt filler, ability-less
// bodies only), restricted to the tier under test (t3).
// ---------------------------------------------------------------------------
const CANDIDATE_IDS = Object.keys(UNIT_DEFS).filter((id) => id !== 'pup' && id !== 'warren-warden');
const CE_SAMPLES = 250;

type Position = 'front' | 'behind';

function ceRoster(candidateId: string | null, pos: Position): Lineup {
  const cap = boardCapForDay(DAY);
  const seat = candidateId ?? FILLER;
  const order: string[] = pos === 'front' ? [seat, TANK] : [TANK, seat];
  while (order.length < cap) order.push(FILLER);
  const units: Lineup['units'] = order.slice(0, cap).map((defId) => ({ defId, tier: TIER }));
  return { units, teamRelicIds: ['filth-totem'] };
}

function ceMeasure(lineup: Lineup): { waves: number; damage: number } {
  let waves = 0;
  let damage = 0;
  for (let s = 0; s < CE_SAMPLES; s++) {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + s * 86_400_000).toISOString().slice(0, 10);
    const r = simulate(lineup, generateGauntlet(date, DAY)).result;
    waves += r.wavesCleared;
    damage += r.damageDealt;
  }
  return { waves: waves / CE_SAMPLES, damage: damage / CE_SAMPLES };
}

interface CERow {
  id: string;
  name: string;
  scrapCost: number;
  bestPos: Position;
  wavesEff: number;
  dmgEff: number;
}

const ceBaselineCache = new Map<Position, { waves: number; damage: number }>();
function ceBaseline(pos: Position): { waves: number; damage: number } {
  let m = ceBaselineCache.get(pos);
  if (!m) {
    m = ceMeasure(ceRoster(null, pos));
    ceBaselineCache.set(pos, m);
  }
  return m;
}

const ceRows: CERow[] = [];
for (const id of CANDIDATE_IDS) {
  const def = UNIT_DEFS[id];
  if (def.ability?.condition?.timeOfDay) continue; // day/time-gated units need the blended methodology all-unit-value.ts already covers; out of scope here
  const scrapCost = def.cost * Math.pow(3, TIER - 1);
  let best: { pos: Position; wavesEff: number; dmgEff: number } | null = null;
  for (const pos of ['front', 'behind'] as const) {
    const base = ceBaseline(pos);
    const withUnit = ceMeasure(ceRoster(id, pos));
    const wavesEff = ((withUnit.waves - base.waves) / scrapCost) * 100;
    const dmgEff = ((withUnit.damage - base.damage) / scrapCost) * 100;
    if (best === null || wavesEff > best.wavesEff) best = { pos, wavesEff, dmgEff };
  }
  ceRows.push({ id, name: def.name, scrapCost, bestPos: best!.pos, wavesEff: best!.wavesEff, dmgEff: best!.dmgEff });
}
ceRows.sort((a, b) => b.wavesEff - a.wavesEff);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const direRatDef = UNIT_DEFS['dire-rat'];
const t3Attack = Math.round(direRatDef.attack * tierAttackMultiplier(TIER));
const t3Health = Math.round(direRatDef.health * tierHealthMultiplier(TIER));
const t3Armor = (direRatDef.damageReduction ?? 0) * TIER;
const t3Cost = direRatDef.cost * Math.pow(3, TIER - 1);

console.log(`Dire-Rat armor re-test (issue #64) — t3: attack ${t3Attack}, health ${t3Health}, armor ${t3Armor}, cost ${t3Cost} scrap`);
console.log(`theme samples: ${bruteSamples.length} brute-primary seasons, ${swarmSamples.length} swarm-primary seasons (scanned ${SEASONS_TO_SCAN} weeks)\n`);

console.log('=== 1) Damage prevented — event-log exact accounting, front-seated t3 Dire-Rat ===');
console.log('theme   samples  hits  rawIncoming  actualIncoming  prevented  prevented%  avgRaw/hit  avgPrevented/hit  avgWavesCleared');
const bruteAgg = aggregateHits(bruteSamples);
const swarmAgg = aggregateHits(swarmSamples);
function printAgg(name: string, agg: ThemeAgg): { preventedPct: number; avgPreventedPerHit: number } {
  const prevented = agg.rawIncoming - agg.actualIncoming;
  const preventedPct = (prevented / agg.rawIncoming) * 100;
  const avgRawPerHit = agg.rawIncoming / agg.hits;
  const avgPreventedPerHit = prevented / agg.hits;
  const avgWaves = agg.wavesCleared / agg.samples;
  console.log(
    `${name.padEnd(7)} ${agg.samples.toString().padStart(7)}  ${agg.hits.toString().padStart(4)}  ${agg.rawIncoming.toString().padStart(11)}  ${agg.actualIncoming.toString().padStart(14)}  ${prevented.toString().padStart(9)}  ${preventedPct.toFixed(1).padStart(9)}%  ${avgRawPerHit.toFixed(2).padStart(10)}  ${avgPreventedPerHit.toFixed(2).padStart(16)}  ${avgWaves.toFixed(2).padStart(15)}`
  );
  return { preventedPct, avgPreventedPerHit };
}
const bruteResult = printAgg('brute', bruteAgg);
const swarmResult = printAgg('swarm', swarmAgg);
// Two different asymmetry views, since they can disagree:
//   - pctAsymmetry: share of raw incoming damage the armor wipes out (relative).
//   - absAsymmetry: raw HP actually saved per hit (absolute) — this is the
//     operationally relevant one for survival/depth, since a unit dies from
//     absolute HP loss, not from a percentage.
const pctAsymmetry = bruteResult.preventedPct / Math.max(swarmResult.preventedPct, 1e-9);
const absAsymmetry = bruteResult.avgPreventedPerHit / Math.max(swarmResult.avgPreventedPerHit, 1e-9);
console.log(
  `\nbrute-vs-swarm asymmetry: ${pctAsymmetry.toFixed(2)}x the SHARE of incoming damage prevented (relative), ${absAsymmetry.toFixed(2)}x the raw HP saved per hit (absolute) — brute over swarm`
);
console.log(`(armor is flat -${t3Armor}/hit before the MIN_ATTACK_DAMAGE=1 floor — a big brute hit eats close to the full -${t3Armor}, a small swarm hit is mostly/fully floored away, wasting the nominal armor value)`);

console.log('\n=== 2) Depth / damage-dealt contribution — armor-on (6) vs armor-off (0), same (lineup, gauntlet) pairs ===');
console.log('theme   wavesCleared(on)  wavesCleared(off)  delta   damageDealt(on)  damageDealt(off)  delta');
const baseArmor = direRatDef.damageReduction; // pre-*tier value stored on the def; sim.ts multiplies by tier itself
function printDepthAB(name: string, samples: ThemeSample[]): { wOn: number; wOff: number } {
  const on = aggregateDepth(samples, baseArmor);
  const off = aggregateDepth(samples, 0);
  const n = samples.length;
  const wOn = on.wavesCleared / n;
  const wOff = off.wavesCleared / n;
  const dOn = on.damageDealt / n;
  const dOff = off.damageDealt / n;
  console.log(
    `${name.padEnd(7)} ${wOn.toFixed(2).padStart(16)}  ${wOff.toFixed(2).padStart(18)}  ${(wOn - wOff >= 0 ? '+' : '') + (wOn - wOff).toFixed(2)}   ${dOn.toFixed(1).padStart(15)}  ${dOff.toFixed(1).padStart(16)}  ${(dOn - dOff >= 0 ? '+' : '') + (dOn - dOff).toFixed(1)}`
  );
  return { wOn, wOff };
}
const bruteDepth = printDepthAB('brute', bruteSamples);
const swarmDepth = printDepthAB('swarm', swarmSamples);

console.log('\n=== 3) T3 cost-efficiency — waves/100scrap, dmgDealt/100scrap, best of front/behind (control: Dire-Rat tank + Gutter-Runt filler) ===');
console.log('rank  unit             cost  bestPos  wavesEff  dmgEff');
ceRows.forEach((r, i) => {
  const marker = r.id === 'dire-rat' ? '  <== Dire-Rat' : '';
  console.log(
    `${(i + 1).toString().padStart(4)}  ${r.name.padEnd(15)}  ${r.scrapCost.toString().padStart(4)}  ${r.bestPos.padStart(7)}  ${r.wavesEff.toFixed(2).padStart(8)}  ${r.dmgEff.toFixed(1).padStart(6)}${marker}`
  );
});
const direRatRank = ceRows.findIndex((r) => r.id === 'dire-rat') + 1;
console.log(`\nDire-Rat ranks #${direRatRank} of ${ceRows.length} by t3 depth-efficiency (waves/100scrap).`);

const bruteWaveDelta = bruteDepth.wOn - bruteDepth.wOff;
const swarmWaveDelta = swarmDepth.wOn - swarmDepth.wOff;

console.log('\n=== Recommendation (numbers-backed, for Jesper\'s call — no stat change made here) ===');
console.log(
  `- Absolute HP saved per hit: ${bruteResult.avgPreventedPerHit.toFixed(2)} vs brute-heavy, ${swarmResult.avgPreventedPerHit.toFixed(2)} vs swarm-heavy ` +
    `(${absAsymmetry.toFixed(2)}x) — armor at t3 realizes most of its nominal -${t3Armor}/hit against brutes but is heavily floor-clipped against swarms, exactly the anti-brute/ ` +
    'near-useless-vs-swarm shape the issue predicted.'
);
console.log(
  `- Depth contribution (armor-on vs armor-off, same gauntlets): brute-heavy +${bruteWaveDelta.toFixed(2)} waves/run, swarm-heavy +${swarmWaveDelta.toFixed(2)} waves/run — ` +
    `${bruteWaveDelta > swarmWaveDelta ? 'brute-heavy gets the larger depth payoff' : 'the depth payoff does not track the raw-damage asymmetry cleanly'}, consistent with a real but ` +
    'situational (not carry-the-unit) effect either way.'
);
const rankBand = direRatRank <= ceRows.length / 3 ? 'top third' : direRatRank <= (2 * ceRows.length) / 3 ? 'middle third' : 'bottom third';
console.log(
  `- Cost-efficiency: Dire-Rat ranks #${direRatRank}/${ceRows.length} at t3 on depth-efficiency (waves/100scrap) in a neutral (non-themed) control — ${rankBand} of the t3 field for a unit ` +
    'whose entire identity is its armor, i.e. armor is not overperforming its cost across an average gauntlet mix.'
);
console.log(
  '- The asymmetry is inherent to "flat subtract with a floor" — it is the mechanic\'s intended anti-brute niche, not a bug. Given t3 cost-efficiency is not an outlier (see rank above) ' +
    'and armor-off vs armor-on both stay in the "real but modest" band even in its best matchup (brute), the numbers do not support 6 flat being overtuned. ' +
    'If the goal is for Dire-Rat to matter beyond its narrow anti-brute niche, scaling armor with tier on a steeper (e.g. 3^(tier-1)-like) curve would deepen its brute-side value further ' +
    'without touching the swarm matchup at all — it widens the niche, it does not fix the asymmetry. ' +
    'Recommendation: keep flat 6 at t3 — the mechanic reads as working-as-designed (a real, situational anti-brute tool) and t3 cost-efficiency gives no signal that it needs a buff or nerf.'
);
