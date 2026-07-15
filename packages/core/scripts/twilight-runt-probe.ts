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
 * Run from packages/core: npx tsx scripts/twilight-runt-probe.ts
 */
import { generateGauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import type { Lineup, TimeOfDay } from '../src/data/units';
import { boardCapForDay } from '../src/shop';

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
console.log('current placeholder magnitudes: beforeNoon +3atk/+0hp, afterNoon +0atk/+2hp (both PENDING sign-off)\n');

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
