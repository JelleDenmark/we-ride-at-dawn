/**
 * All-unit cost-efficiency report (hardened). Measures what one copy of each
 * buyable unit is worth, per scrap actually spent to reach its tier, so units
 * can be ranked against each other across star levels.
 *
 * This version fixes three methodology gaps found in the first pass (see the
 * 2026-07-10 session): a contaminated control roster, single-position
 * measurement, and a depth-only metric that hides saturating effects.
 *
 * --- 1. CHANGE-INVARIANT CONTROL ROSTER ----------------------------------
 * The control (every slot except the one under test) is built ONLY from
 * ability-less bodies: a Dire-Rat front tank + Gutter-Runt fillers, all at
 * the candidate's tier. Neither has a triggered `Effect` — Dire-Rat's armor
 * is passive `damageReduction`, Gutter-Runt has nothing — so NO retune of
 * ability scaling (issues #58/#59 and friends) can move the baseline. That's
 * the bug the first pass had: its control contained Gnawer/Corpse-Glutton/
 * Blight-Witch/Plague-Bearer, so changing those units' ability curves shifted
 * the baseline itself, and a candidate's before/after delta drifted for
 * reasons that had nothing to do with the candidate (Gnawer read 0.4 -> 0.3
 * purely because the control's own Gnawer got stronger). A neutral control
 * makes before/after comparisons trustworthy.
 *
 * The Dire-Rat tank is tiered up with the candidate so the control actually
 * survives deep enough for a real multi-wave fight — a tier-1 tank on a day-6
 * board dies instantly and collapses the measurement to noise.
 *
 * --- 2. POSITIONAL COVERAGE ----------------------------------------------
 * Value is positional. A unit is measured in BOTH slots that matter:
 *   - "behind": tank front, candidate at slot 1 (auras, buffs-behind, and
 *     death-gated abilities that fire once the front collapses onto it).
 *   - "front": candidate at slot 0, tank at slot 1 (the candidate actually
 *     clashes — so `afterAttack` effects like Blight-Witch's poison fire, and
 *     the unit takes damage / can faint on its own terms).
 * The better of the two positions is reported, with an F/B marker, because a
 * player places a unit where it's best. The first pass tested one fixed slot
 * and silently under-measured every attack-triggered or front-reliant unit.
 *
 * --- 3. DAMAGE METRIC ALONGSIDE DEPTH ------------------------------------
 * Depth-delta saturates: once a unit's contribution is enough to clear a wave
 * in time, extra contribution is invisible to `wavesCleared` (this is exactly
 * why bumping poison stacks in #59 moved depth by ~0. See the poison probe in
 * that session). So `damageDealt` delta is reported too — a continuous signal
 * that still separates "does real work but it's currently overkill" from
 * "genuinely dead weight."
 *
 * Time-sensitive units are blended 50/50 across the before/after-noon halves,
 * since a real expedition sees both. This covers BOTH shapes: `condition.
 * timeOfDay` gates (Dawn-Runt/Dusk-Runt) and `teamBuffByTime` (Twilight-Runt),
 * whose time branch lives inside the effect with no top-level condition.
 *
 * Run from packages/core: npx tsx scripts/all-unit-value.ts
 */
import { generateGauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import type { Lineup, TimeOfDay } from '../src/data/units';
import { UNIT_DEFS } from '../src/data/units';
import { boardCapForDay, seasonUnitPool } from '../src/shop';

const START = '2026-07-06'; // synchronized-week Monday (day 1)
const SAMPLES = 250;

// Change-invariant control: only ability-less bodies (see header, gap 1).
const TANK = 'dire-rat';
const FILLER = 'gutter-runt';

// Measure exactly what a player can obtain this season — issue #127: a
// hand-copied exclusion list here went stale when #115 retired Rattyfock and
// brought Warren-Warden back, so the tier list measured a non-purchasable
// unit and skipped a purchasable one. Deriving from the shop's own pool
// can't drift. Gutter-Runt is retired but appended anyway: it's the control
// filler, so it reads ~0 by construction — the roster's explicit zero-line.
const CANDIDATE_IDS = [...seasonUnitPool().map((u) => u.id), FILLER];
const TIER_DAY: Record<number, number> = { 1: 2, 2: 4, 3: 6 };

type Position = 'front' | 'behind';

/**
 * Board with the candidate (or a Gutter-Runt, for the baseline) placed at the
 * given position, everything else an ability-less body at `tier`.
 *   front:  [candidate, tank, filler, filler, ...]
 *   behind: [tank, candidate, filler, filler, ...]
 */
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

// Blend 50/50 across the two day-halves for any time-sensitive unit; plain
// measure otherwise. Time sensitivity comes in TWO shapes and both need the
// blend: a `condition.timeOfDay` gate (Dawn/Dusk-Runt — active one half,
// dormant the other), and `teamBuffByTime` (Twilight-Runt — different buff
// each half, chosen inside the effect with NO top-level condition). Detecting
// only the condition shape made Twilight-Runt fall through to a measurement
// with `timeOfDay` unset, where sim.ts applies NEITHER half — the unit read
// as a total no-op (~0, rank 18-19/19) purely as a tooling artifact.
function measureUnit(candidateId: string | null, tier: number, day: number, pos: Position, timeSensitive: boolean): Measure {
  if (!timeSensitive) return measure(roster(candidateId, tier, day, pos), day);
  const am = measure(roster(candidateId, tier, day, pos, 'beforeNoon'), day);
  const pm = measure(roster(candidateId, tier, day, pos, 'afterNoon'), day);
  return { waves: (am.waves + pm.waves) / 2, damage: (am.damage + pm.damage) / 2 };
}

interface Row {
  id: string;
  name: string;
  tier: number;
  scrapCost: number;
  bestPos: Position;
  wavesEff: number; // waves per 100 scrap, better position
  dmgEff: number; // damage per 100 scrap, same (better-by-waves) position
}

// Baselines depend only on (tier, position) — cache them.
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

const rows: Row[] = [];
for (const id of CANDIDATE_IDS) {
  const def = UNIT_DEFS[id];
  const timeSensitive =
    def.ability?.condition?.timeOfDay !== undefined || def.ability?.effect.kind === 'teamBuffByTime';
  for (let tier = 1; tier <= 3; tier++) {
    const day = TIER_DAY[tier];
    const scrapCost = def.cost * Math.pow(3, tier - 1);
    const positions: Position[] = ['front', 'behind'];
    let best: { pos: Position; wavesEff: number; dmgEff: number } | null = null;
    for (const pos of positions) {
      const base = baseline(tier, day, pos);
      const withUnit = measureUnit(id, tier, day, pos, timeSensitive);
      const wavesEff = ((withUnit.waves - base.waves) / scrapCost) * 100;
      const dmgEff = ((withUnit.damage - base.damage) / scrapCost) * 100;
      if (best === null || wavesEff > best.wavesEff) best = { pos, wavesEff, dmgEff };
    }
    rows.push({ id, name: def.name, tier, scrapCost, bestPos: best!.pos, wavesEff: best!.wavesEff, dmgEff: best!.dmgEff });
  }
}

// Rank within each tier by depth efficiency, computed (never by hand).
const rank = new Map<string, number>();
for (let tier = 1; tier <= 3; tier++) {
  rows
    .filter((r) => r.tier === tier)
    .sort((a, b) => b.wavesEff - a.wavesEff)
    .forEach((r, i) => rank.set(`${tier}|${r.name}`, i + 1));
}

console.log(`all-unit cost-efficiency (hardened) — ${SAMPLES} dates/measure, tiers at days ${TIER_DAY[1]}/${TIER_DAY[2]}/${TIER_DAY[3]}`);
console.log(`control: ${TANK} tank + ${FILLER} fillers (ability-less, change-invariant); best of front/behind reported\n`);

console.log('=== DEPTH efficiency — waves/100scrap, best position (F=front, B=behind), #rank in tier ===');
console.log('unit             T1  eff(pos#)      T2  eff(pos#)      T3  eff(pos#)     trend');
for (const id of CANDIDATE_IDS) {
  const name = UNIT_DEFS[id].name;
  const rs = rows.filter((r) => r.id === id).sort((a, b) => a.tier - b.tier);
  const cells = rs.map((r) => {
    const p = r.bestPos === 'front' ? 'F' : 'B';
    return `${r.wavesEff.toFixed(1).padStart(5)}(${p}${rank.get(`${r.tier}|${r.name}`)})`;
  });
  const v = rs.map((r) => r.wavesEff);
  const trend =
    name === 'Gutter Runt' ? 'zero-line (control filler)' : v[2] > v[0] ? 'rising' : v[2] < v[0] ? 'falling' : 'flat';
  console.log(`${name.padEnd(15)}  ${rs[0].scrapCost.toString().padStart(3)} ${cells[0]}   ${rs[1].scrapCost.toString().padStart(3)} ${cells[1]}   ${rs[2].scrapCost.toString().padStart(3)} ${cells[2]}   ${trend}`);
}

console.log('\n=== DAMAGE efficiency — damageDealt/100scrap at each unit\'s best-by-depth position (saturation-proof signal) ===');
console.log('unit               T1       T2       T3');
for (const id of CANDIDATE_IDS) {
  const name = UNIT_DEFS[id].name;
  const rs = rows.filter((r) => r.id === id).sort((a, b) => a.tier - b.tier);
  console.log(`${name.padEnd(15)}  ${rs.map((r) => r.dmgEff.toFixed(1).padStart(7)).join('  ')}`);
}
