/**
 * All-relic cost-efficiency report. Measures what one copy of each relic in
 * RELIC_DEFS is worth, per scrap spent, using the same hardened methodology
 * as `all-unit-value.ts` (see that file's header for the full rationale —
 * change-invariant control, positional coverage, damage-alongside-depth).
 * Built for issue #68: there was no dedicated relic test, only three spot
 * checks buried in `depth-scaling.ts` (rusted-nail, gore-cleaver,
 * marrow-snap).
 *
 * --- CONTROL ROSTER --------------------------------------------------------
 * Same change-invariant control as all-unit-value.ts: a Dire-Rat front tank
 * (passive `damageReduction`, no triggered ability) + Gutter-Runt fillers
 * (no ability at all), tiered up with the day under test. Neither unit has
 * an `Effect`, so no ability-curve retune can move the baseline out from
 * under a before/after relic comparison.
 *
 * The relic under test is attached to a Gutter-Runt "candidate" body — not
 * to the tank — so the measurement isolates the relic's own contribution
 * rather than mixing it with Dire-Rat's armor. Team-scope relics don't need
 * a carrier at all; they're added to `teamRelicIds` and apply to the whole
 * board directly (see sim.ts's `teamAttack`/`teamHealth`/`teamHealPerTick`).
 *
 * --- POSITIONAL / CONDITIONAL COVERAGE -------------------------------------
 * Unit-scope relics are measured in BOTH slots that matter, exactly like
 * all-unit-value.ts's unit measurement:
 *   - "front": candidate at slot 0, tank at slot 1 — the candidate actually
 *     clashes each tick.
 *   - "behind": tank front, candidate at slot 1 — the candidate only clashes
 *     once the tank falls.
 * The better of the two is reported (F/B marker). This isn't a cosmetic
 * sweep — per sim.ts, several relics are read ONLY off the current front
 * unit's `relics` array each tick (`bonusOf(front)` for Glass Shard's
 * firstHitBonus, the `cleaveOverkill` check, the `executeThreshold` check),
 * so a relic silently measured "behind" a tank that never dies would read
 * as dead weight for reasons that have nothing to do with the relic:
 *   - glass-shard   (+3 first hit/wave)   pays off in FRONT — only the live
 *     front unit's bonus is ever added to an outgoing swing.
 *   - gore-cleaver   (overkill spill)      pays off in FRONT — only checked
 *     against `front.relics`.
 *   - marrow-snap    (execute ≤30% hp)     pays off in FRONT — same check.
 *   - weeping-boil   (on-faint AoE)        pays off in FRONT — the carrier
 *     has to actually die to proc it, and only the front unit takes lethal
 *     attack damage with any regularity.
 *   - tail-charm     (cheat death once)    pays off in FRONT for the same
 *     reason — a back-line unit that never clashes never needs the save.
 * Reusing the same front/behind sweep as all-unit-value.ts (rather than
 * hand-picking a slot per relic) means every one of these lands in its
 * payoff position automatically, and the F/B marker in the output records
 * where each relic scored best.
 *
 * --- DAMAGE METRIC ALONGSIDE DEPTH -----------------------------------------
 * Depth-delta saturates once a relic's contribution is enough to just clear
 * a wave in time; extra contribution beyond that is invisible to
 * `wavesCleared`. `damageDealt` delta is reported alongside depth for the
 * same reason as all-unit-value.ts: it separates "measurable but currently
 * overkill" from "genuinely dead weight."
 *
 * Run from packages/core: npx tsx scripts/relic-value.ts
 */
import { generateGauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import type { Lineup } from '../src/data/units';
import { RELIC_DEFS } from '../src/data/relics';
import { boardCapForDay } from '../src/shop';

const START = '2026-07-06'; // synchronized-week Monday (day 1), same as all-unit-value.ts
const SAMPLES = 250;

const RELIC_IDS = Object.keys(RELIC_DEFS);

// Change-invariant control: only ability-less bodies (see header).
const TANK = 'dire-rat';
const FILLER = 'gutter-runt';
const TIER_DAY: Record<number, number> = { 1: 2, 2: 4, 3: 6 };

type Position = 'front' | 'behind';

/**
 * Board with the candidate (a Gutter-Runt, carrying `unitRelicId` if given)
 * placed at the given position, everything else an ability-less body at
 * `tier`. `teamRelicId`, if given, is applied to the whole board.
 *   front:  [candidate(+relic), tank, filler, filler, ...]
 *   behind: [tank, candidate(+relic), filler, filler, ...]
 * With no `unitRelicId`/`teamRelicId` this is the bare zero-line control —
 * identical in shape to all-unit-value.ts's `roster(null, ...)`, just
 * without that script's baked-in filth-totem (this script needs a
 * completely relic-free baseline since filth-totem/forgotten-backpack are
 * themselves under test here).
 */
function roster(unitRelicId: string | null, teamRelicId: string | null, tier: number, day: number, pos: Position): Lineup {
  const cap = boardCapForDay(day);
  const candidate = { defId: FILLER, tier, relicIds: unitRelicId ? [unitRelicId] : [] };
  const tank = { defId: TANK, tier, relicIds: [] as string[] };
  const order: Lineup['units'] = pos === 'front' ? [candidate, tank] : [tank, candidate];
  while (order.length < cap) order.push({ defId: FILLER, tier, relicIds: [] });
  return {
    units: order.slice(0, cap),
    teamRelicIds: teamRelicId ? [teamRelicId] : [],
  };
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

// Baselines (no relic at all) depend only on (tier, position) — cache them.
// Shared by both unit-scope and team-scope relic measurements below, since
// a bare control roster doesn't care which kind of relic will be compared
// against it.
const baselineCache = new Map<string, Measure>();
function baseline(tier: number, day: number, pos: Position): Measure {
  const key = `${tier}|${pos}`;
  let m = baselineCache.get(key);
  if (!m) {
    m = measure(roster(null, null, tier, day, pos), day);
    baselineCache.set(key, m);
  }
  return m;
}

interface Row {
  id: string;
  name: string;
  scope: 'unit' | 'team';
  cost: number;
  tier: number;
  bestPos: Position | 'n/a'; // team-scope relics aren't positional
  wavesEff: number; // waves per 100 scrap, better position (unit-scope) or whole-board (team-scope)
  dmgEff: number; // damage per 100 scrap, same position as wavesEff
}

const rows: Row[] = [];
for (const id of RELIC_IDS) {
  const def = RELIC_DEFS[id];
  for (let tier = 1; tier <= 3; tier++) {
    const day = TIER_DAY[tier];
    if (def.scope === 'team') {
      // Team relics apply to the whole board regardless of layout — no
      // front/behind split needed. Use the canonical tank-front layout.
      const base = baseline(tier, day, 'behind');
      const withRelic = measure(roster(null, id, tier, day, 'behind'), day);
      const wavesEff = ((withRelic.waves - base.waves) / def.cost) * 100;
      const dmgEff = ((withRelic.damage - base.damage) / def.cost) * 100;
      rows.push({ id, name: def.name, scope: def.scope, cost: def.cost, tier, bestPos: 'n/a', wavesEff, dmgEff });
    } else {
      const positions: Position[] = ['front', 'behind'];
      let best: { pos: Position; wavesEff: number; dmgEff: number } | null = null;
      for (const pos of positions) {
        const base = baseline(tier, day, pos);
        const withRelic = measure(roster(id, null, tier, day, pos), day);
        const wavesEff = ((withRelic.waves - base.waves) / def.cost) * 100;
        const dmgEff = ((withRelic.damage - base.damage) / def.cost) * 100;
        if (best === null || wavesEff > best.wavesEff) best = { pos, wavesEff, dmgEff };
      }
      rows.push({ id, name: def.name, scope: def.scope, cost: def.cost, tier, bestPos: best!.pos, wavesEff: best!.wavesEff, dmgEff: best!.dmgEff });
    }
  }
}

// Rank within each tier by depth efficiency, computed (never by hand).
const rank = new Map<string, number>();
for (let tier = 1; tier <= 3; tier++) {
  rows
    .filter((r) => r.tier === tier)
    .sort((a, b) => b.wavesEff - a.wavesEff)
    .forEach((r, i) => rank.set(`${tier}|${r.id}`, i + 1));
}

console.log(`all-relic cost-efficiency — ${SAMPLES} dates/measure, tiers at days ${TIER_DAY[1]}/${TIER_DAY[2]}/${TIER_DAY[3]}`);
console.log(`control: ${TANK} tank + ${FILLER} fillers (ability-less, change-invariant); unit-scope relics report best of front/behind\n`);

console.log('=== DEPTH efficiency — waves/100scrap, best position for unit-scope (F=front, B=behind, -=team-scope), #rank in tier ===');
console.log('relic                scope  cost  T1  eff(pos#)      T2  eff(pos#)      T3  eff(pos#)     trend');
for (const id of RELIC_IDS) {
  const def = RELIC_DEFS[id];
  const rs = rows.filter((r) => r.id === id).sort((a, b) => a.tier - b.tier);
  const cells = rs.map((r) => {
    const p = r.bestPos === 'front' ? 'F' : r.bestPos === 'behind' ? 'B' : '-';
    return `${r.wavesEff.toFixed(1).padStart(5)}(${p}${rank.get(`${r.tier}|${r.id}`)})`;
  });
  const v = rs.map((r) => r.wavesEff);
  const trend = v[2] > v[0] ? 'rising' : v[2] < v[0] ? 'falling' : 'flat';
  console.log(`${def.name.padEnd(20)}  ${def.scope.padEnd(5)}  ${def.cost.toString().padStart(3)}  ${cells[0]}   ${cells[1]}   ${cells[2]}   ${trend}`);
}

// CAVEAT: sim.ts's `damageDealt` (see `totalDamage`/`damageThisWave`) only
// accumulates the front unit's normal per-tick clash damage (`damageOut`
// at line ~559). It does NOT count damage from resolveDeaths's on-faint AoE
// (Weeping Boil), Marrow-Snap's execute finishing blow, or Gore-Cleaver's
// overkill spillover — none of those `applyDamage` calls feed
// `damageThisWave`. So for these three relics dmgEff is not "how much this
// relic hurts" — a faster off-books kill means fewer *normal* clashes get
// logged, which can even make dmgEff read negative despite the relic
// clearing more waves (see wavesEff, which IS a trustworthy signal for
// them). Read wavesEff as primary for weeping-boil/gore-cleaver/marrow-snap;
// dmgEff is the trustworthy metric for the rest (rusted-nail, glass-shard,
// fat-tick, tail-charm, filth-totem, forgotten-backpack all deal/keep their
// value inside the counted clash path).
console.log('\n=== DAMAGE efficiency — damageDealt/100scrap at each relic\'s best-by-depth position (saturation-proof signal) ===');
console.log('relic                 T1       T2       T3');
for (const id of RELIC_IDS) {
  const def = RELIC_DEFS[id];
  const rs = rows.filter((r) => r.id === id).sort((a, b) => a.tier - b.tier);
  console.log(`${def.name.padEnd(20)}  ${rs.map((r) => r.dmgEff.toFixed(1).padStart(7)).join('  ')}`);
}

// Overall rank (across all tiers, mean waves/100scrap) — flags for Jesper.
console.log('\n=== OVERALL (mean waves/100scrap across T1-T3) — flag dead-weight (~0 or negative) and dominant (outlier-high) relics ===');
const overall = RELIC_IDS.map((id) => {
  const rs = rows.filter((r) => r.id === id);
  const meanWaves = rs.reduce((s, r) => s + r.wavesEff, 0) / rs.length;
  const meanDmg = rs.reduce((s, r) => s + r.dmgEff, 0) / rs.length;
  return { id, name: RELIC_DEFS[id].name, scope: RELIC_DEFS[id].scope, cost: RELIC_DEFS[id].cost, meanWaves, meanDmg };
}).sort((a, b) => b.meanWaves - a.meanWaves);
overall.forEach((r, i) => {
  console.log(`${(i + 1).toString().padStart(2)}. ${r.name.padEnd(20)} ${r.scope.padEnd(5)} cost ${r.cost.toString().padStart(2)}   waves/100scrap ${r.meanWaves.toFixed(2).padStart(6)}   dmg/100scrap ${r.meanDmg.toFixed(1).padStart(7)}`);
});
