/**
 * Twilight-Runt two-halves balance probe (issue #110's required balance
 * gate). `all-unit-value.ts` blends timeOfDay-gated units 50/50 across
 * their before/after-noon halves — useful for ranking a unit against the
 * rest of the roster, but it cannot tell "both halves pull their weight"
 * apart from "one strong half is propping up one dead half," which is
 * exactly the risk #110 flags: health generally outvalues attack in this
 * sim, so a naive symmetric split risks making the morning (attack) mode a
 * dead card again, just moved from unit-choice (Dawn-Runt vs Dusk-Runt) to
 * timing-choice (ride before vs after noon).
 *
 * This script reuses all-unit-value.ts's change-invariant control (an
 * ability-less Dire-Rat tank + Gutter-Runt fillers, tiered up with the
 * candidate) and reports Twilight-Runt's beforeNoon and afterNoon
 * contributions SEPARATELY, at each tier, instead of blending them.
 *
 * === Issue #110 fixed-hour-Trial follow-up ("Option 1") ===
 * #120 moved the Boss Trial to a fixed 20:00 CET fight (= `afterNoon`,
 * always). Because the Trial scores raw damage
 * (`boss-trial.ts`'s `simulateBossTrial`) and a health grant is a linear
 * one-time HP cushion against the Trial's exponentially-escalating boss, a
 * pure-health `afterNoon` half converts to EXACTLY +0 Trial score on a
 * maxed board (measured in #110/#120: 4486 -> 4486, no change at all) —
 * structural, not a small-numbers problem; see the discussion on #110 for
 * the full derivation. Option 1 is the cheapest fix: give each half a small
 * floor in the OTHER stat so neither branch is a hard zero anywhere, without
 * touching the engine or the ability's trigger/shape. The section below
 * extends this probe with a Trial-score column so the floor is picked from
 * real data, not a guess — see `runTrialComparison()` further down.
 *
 * Run from packages/core: npx tsx scripts/twilight-runt-probe.ts
 */
import { generateGauntlet } from '../src/gauntlet';
import { simulate, BOARD_CAP } from '../src/sim';
import { UNIT_DEFS } from '../src/data/units';
import type { Lineup, TimeOfDay } from '../src/data/units';
import { boardCapForDay } from '../src/shop';
import { simulateBossTrial } from '../src/boss-trial';

const START = '2026-07-06'; // synchronized-week Monday (day 1), same as all-unit-value.ts
const SAMPLES = 250;

const CANDIDATE = 'twilight-runt';
const TANK = 'dire-rat';
const FILLER = 'gutter-runt';
const TIER_DAY: Record<number, number> = { 1: 2, 2: 4, 3: 6 };

type Position = 'front' | 'behind';

function roster(candidateId: string | null, tier: number, day: number, pos: Position, timeOfDay?: TimeOfDay): Lineup {
  const cap = boardCapForDay(day);
  const seat = candidateId ?? FILLER;
  const order: string[] = pos === 'front' ? [seat, TANK] : [TANK, seat];
  while (order.length < cap) order.push(FILLER);
  const units: Lineup['units'] = order.slice(0, cap).map((defId) => ({ defId, tier }));
  return { units, teamRelicIds: ['filth-totem'], timeOfDay };
}

interface Measure {
  waves: number;
  damage: number;
}

function measure(lineup: Lineup, day: number): Measure {
  let waves = 0;
  let damage = 0;
  for (let s = 0; s < SAMPLES; s++) {
    const date = new Date(Date.parse(`${START}T12:00:00Z`) + s * 86_400_000).toISOString().slice(0, 10);
    const r = simulate(lineup, generateGauntlet(date, day)).result;
    waves += r.wavesCleared;
    damage += r.damageDealt;
  }
  return { waves: waves / SAMPLES, damage: damage / SAMPLES };
}

const baselineCache = new Map<string, Measure>();
function baseline(tier: number, day: number, pos: Position): Measure {
  const key = `${tier}|${pos}`;
  let m = baselineCache.get(key);
  if (!m) {
    m = measure(roster(null, tier, day, pos), day);
    baselineCache.set(key, m);
  }
  return m;
}

interface HalfRow {
  tier: number;
  scrapCost: number;
  bestPos: Position;
  wavesEff: number;
  dmgEff: number;
}

function measureHalf(tier: number, timeOfDay: TimeOfDay): HalfRow {
  const day = TIER_DAY[tier];
  const scrapCost = 4 * Math.pow(3, tier - 1); // Twilight-Runt cost: 4
  let best: HalfRow | null = null;
  for (const pos of ['front', 'behind'] as Position[]) {
    const base = baseline(tier, day, pos);
    const withUnit = measure(roster(CANDIDATE, tier, day, pos, timeOfDay), day);
    const wavesEff = ((withUnit.waves - base.waves) / scrapCost) * 100;
    const dmgEff = ((withUnit.damage - base.damage) / scrapCost) * 100;
    if (best === null || wavesEff > best.wavesEff) best = { tier, scrapCost, bestPos: pos, wavesEff, dmgEff };
  }
  return best!;
}

console.log(`Twilight-Runt two-halves probe (issue #110) — ${SAMPLES} dates/measure, tiers at days ${TIER_DAY[1]}/${TIER_DAY[2]}/${TIER_DAY[3]}`);
console.log(`control: ${TANK} tank + ${FILLER} fillers (ability-less, change-invariant); best of front/behind reported`);
console.log('current placeholder magnitudes: beforeNoon +3atk/+1hp, afterNoon +1atk/+2hp (both PENDING sign-off — issue #110 Option 1 floor, see candidate sweep below)\n');

console.log('=== DEPTH efficiency — waves/100scrap, best position, per half ===');
console.log('tier   beforeNoon(atk)         afterNoon(hp)           gap (before - after)');
for (let tier = 1; tier <= 3; tier++) {
  const before = measureHalf(tier, 'beforeNoon');
  const after = measureHalf(tier, 'afterNoon');
  const gap = before.wavesEff - after.wavesEff;
  console.log(
    `T${tier}     ${before.wavesEff.toFixed(2).padStart(6)} (${before.bestPos[0].toUpperCase()})           ` +
    `${after.wavesEff.toFixed(2).padStart(6)} (${after.bestPos[0].toUpperCase()})           ` +
    `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}`
  );
}

console.log('\n=== DAMAGE efficiency — damageDealt/100scrap, best-by-depth position, per half ===');
console.log('tier   beforeNoon(atk)   afterNoon(hp)');
for (let tier = 1; tier <= 3; tier++) {
  const before = measureHalf(tier, 'beforeNoon');
  const after = measureHalf(tier, 'afterNoon');
  console.log(`T${tier}     ${before.dmgEff.toFixed(2).padStart(8)}      ${after.dmgEff.toFixed(2).padStart(8)}`);
}

/**
 * === Option 1 candidate sweep (#110 fixed-hour-Trial follow-up) ===
 *
 * Everything below mutates `UNIT_DEFS['twilight-runt'].ability` in place —
 * this is a read-only analysis script, never imported by app code, so
 * clobbering the live registry entry for the duration of the run is safe.
 * The unit def is restored to its shipped magnitudes at the end so the
 * process exit state matches what's on disk (matters if this script is ever
 * chained with other probes in one process).
 *
 * For each candidate we report TWO things side by side, because #110's own
 * risk note is that fixing the Trial and preserving the ride-mode asymmetry
 * pull in opposite directions:
 *   - Ride-mode DEPTH efficiency (waves/100scrap), same metric as the sweep
 *     above — the floor must not dilute afterNoon's T2/T3 depth win into
 *     mediocrity, and must not make beforeNoon's health floor start
 *     rivaling afterNoon's dominant stat.
 *   - Boss Trial totalDamage, at a fixed `timeOfDay`, on three representative
 *     boards (T1 small / T2 mid / T3 maxed, mirroring the composition style
 *     of `boss-trial-probe.ts`) — this is the number that was a hard `0` at
 *     T1/T3 under afterNoon before this change.
 */
const originalAbility = UNIT_DEFS['twilight-runt'].ability!;

interface Candidate {
  name: string;
  beforeNoon: { attack: number; health: number };
  afterNoon: { attack: number; health: number };
}

const CANDIDATES: Candidate[] = [
  {
    name: 'shipped (baseline) beforeNoon{3,0} afterNoon{0,2}',
    beforeNoon: { attack: 3, health: 0 },
    afterNoon: { attack: 0, health: 2 },
  },
  {
    name: 'A: minimal floor, afterNoon only  beforeNoon{3,0} afterNoon{1,2}',
    beforeNoon: { attack: 3, health: 0 },
    afterNoon: { attack: 1, health: 2 },
  },
  {
    name: 'B: symmetric +1 floor both halves beforeNoon{3,1} afterNoon{1,2}',
    beforeNoon: { attack: 3, health: 1 },
    afterNoon: { attack: 1, health: 2 },
  },
  {
    name: 'C: aggressive floor (erosion check) beforeNoon{3,1} afterNoon{2,2}',
    beforeNoon: { attack: 3, health: 1 },
    afterNoon: { attack: 2, health: 2 },
  },
];

function setCandidate(c: Candidate) {
  UNIT_DEFS['twilight-runt'].ability = {
    trigger: 'startOfBattle',
    effect: { kind: 'teamBuffByTime', beforeNoon: c.beforeNoon, afterNoon: c.afterNoon },
  };
}

const TRIAL_RELICS = [
  'gore-cleaver', 'rusted-nail', 'fat-tick', 'fat-tick',
  'fat-tick', 'fat-tick', 'fat-tick', 'fat-tick',
];

function trialBoard(order: string[], tier: number, relics: boolean): Lineup {
  const units = order
    .slice(0, BOARD_CAP)
    .map((defId, i) => ({ defId, tier, relicIds: relics ? [TRIAL_RELICS[i]] : [] }));
  return { units, teamRelicIds: relics ? ['filth-totem'] : [] };
}

// Representative boards at T1 (small, no relics), T2 (mid, relics), T3
// (maxed 8-unit, best relics) — same composition style as
// `boss-trial-probe.ts`'s "weak"/"mid"/"maxed attacker" boards, with
// Twilight-Runt occupying one seat instead of a filler.
const TRIAL_BOARDS: { label: string; tier: number; order: string[]; relics: boolean }[] = [
  { label: 'T1 small', tier: 1, order: [CANDIDATE, FILLER], relics: false },
  { label: 'T2 mid', tier: 2, order: [CANDIDATE, TANK, 'warren-warden', 'corpse-glutton', 'bone-priest'], relics: true },
  {
    label: 'T3 maxed',
    tier: 3,
    order: [CANDIDATE, TANK, 'warren-warden', 'corpse-glutton', 'gnawer', 'bone-priest', 'press-kin', 'md-rattyfock'],
    relics: true,
  },
];

function measureTrial(board: { tier: number; order: string[]; relics: boolean }, timeOfDay: TimeOfDay): number {
  const lineup = { ...trialBoard(board.order, board.tier, board.relics), timeOfDay };
  return simulateBossTrial(lineup).totalDamage;
}

console.log('\n\n=== Option 1 candidate sweep — ride-mode depth eff. vs Boss Trial score, per candidate ===');
for (const c of CANDIDATES) {
  setCandidate(c);
  console.log(`\n--- ${c.name} ---`);

  console.log('  ride DEPTH eff. (waves/100scrap)   beforeNoon(atk)   afterNoon(hp)   gap');
  for (let tier = 1; tier <= 3; tier++) {
    const before = measureHalf(tier, 'beforeNoon');
    const after = measureHalf(tier, 'afterNoon');
    const gap = before.wavesEff - after.wavesEff;
    console.log(
      `  T${tier}                                    ${before.wavesEff.toFixed(2).padStart(6)}            ` +
      `${after.wavesEff.toFixed(2).padStart(6)}          ${gap >= 0 ? '+' : ''}${gap.toFixed(2)}`
    );
  }

  // DAMAGE efficiency, not just depth — this is the metric that catches
  // "erosion" specifically: if afterNoon's attack floor makes it also
  // competitive on damage/100scrap, it stops being a distinct timing choice
  // and starts being a strictly-better half (good at both depth AND damage),
  // which is the failure mode Option 1's own risk note warns about.
  console.log('  ride DAMAGE eff. (dmg/100scrap)     beforeNoon(atk)   afterNoon(hp)   afterNoon as % of beforeNoon');
  for (let tier = 1; tier <= 3; tier++) {
    const before = measureHalf(tier, 'beforeNoon');
    const after = measureHalf(tier, 'afterNoon');
    const pct = (after.dmgEff / before.dmgEff) * 100;
    console.log(
      `  T${tier}                                    ${before.dmgEff.toFixed(2).padStart(8)}          ` +
      `${after.dmgEff.toFixed(2).padStart(8)}        ${pct.toFixed(1)}%`
    );
  }

  console.log('  Boss Trial totalDamage              beforeNoon(atk)   afterNoon(hp)');
  for (const board of TRIAL_BOARDS) {
    const before = measureTrial(board, 'beforeNoon');
    const after = measureTrial(board, 'afterNoon');
    console.log(`  ${board.label.padEnd(9)}                          ${String(before).padStart(6)}            ${String(after).padStart(6)}`);
  }
}

// Restore the shipped def so the process's in-memory registry matches disk.
UNIT_DEFS['twilight-runt'].ability = originalAbility;
