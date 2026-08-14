/**
 * Magnitude sweep for the three tunable-amount boons from the 2026-08-15
 * promotion (Rust, Barren, Antidote) — issue #184, methodology from #186 and
 * `pvp-boon-matrix.ts`.
 *
 * `pvp-boon-matrix.ts` measures whatever magnitude is currently hardcoded in
 * `BOON_DEFS`; it was never built to compare candidates against each other.
 * This script tries several candidate magnitudes per boon, in place, and
 * reports the same distribution `pvp-boon-matrix.ts` does for each — plus a
 * dominance check against the OTHER twelve boons at their shipped values, so
 * a candidate that would make one of them strictly outrank the field shows up
 * the same way Guardian's 4-vs-2 dominance finding did originally.
 *
 * Stripped and First Blood have no tunable amount (Stripped removes ALL
 * relics; First Blood is a priority flag, not a magnitude) — not swept here.
 *
 * Mutates `BOON_DEFS[id].effect` in place between runs and restores the
 * shipped value at the end. This process exits after printing, so the
 * mutation never outlives the script regardless — the restore is purely so a
 * REPL or --watch run doesn't see a stale value while this runs.
 */
import { UNIT_DEFS, type Lineup, type LineupUnit } from '../src/data/units';
import { RELIC_DEFS } from '../src/data/relics';
import { seasonUnitPool, MAX_TIER } from '../src/shop';
import { simulateDuel } from '../src/duel';
import { BOON_DEFS } from '../src/boons';
import { xorshift128 } from '../src/prng';
import { fnv1a } from '../src/seed';

const POPULATION = 30;
const SEED = process.env.BOON_SEED ?? 'boon-matrix-v1';
// Same conditional set pvp-boon-matrix.ts uses — excluded from the dominance
// check for the same reason: a population-wide row understates them by
// construction, so a "violation" against one of these would be a fixture
// artifact, not a finding about the SWEPT boon.
const CONDITIONAL = new Set(['echo', 'barren', 'stripped', 'first-blood']);
const UNMEASURABLE = new Set(['deep-scout']);

const rng = xorshift128(fnv1a(SEED));
const pool = seasonUnitPool();
const unitRelics = Object.values(RELIC_DEFS).filter((r) => r.scope === 'unit');
const teamRelics = Object.values(RELIC_DEFS).filter((r) => r.scope === 'team');

// Identical to pvp-boon-matrix.ts's randomBoard — duplicated rather than
// imported (that script doesn't export it) so the two stay independently
// readable; keep them in sync by hand if the fixture shape ever changes.
function randomBoard(): Lineup {
  const size = 3 + rng.int(6);
  const units: LineupUnit[] = [];
  for (let i = 0; i < size; i++) {
    const def = pool[rng.int(pool.length)];
    const roll = rng.int(100);
    const tier = roll < 55 ? 1 : roll < 85 ? 2 : MAX_TIER;
    const relicIds = rng.int(100) < 33 ? [unitRelics[rng.int(unitRelics.length)].id] : undefined;
    units.push(relicIds ? { defId: def.id, tier, relicIds } : { defId: def.id, tier });
  }
  const teamRelicIds =
    teamRelics.length > 0 && rng.int(100) < 40
      ? [teamRelics[rng.int(teamRelics.length)].id]
      : undefined;
  return teamRelicIds
    ? { units, combatCap: units.length + 2, teamRelicIds }
    : { units, combatCap: units.length + 2 };
}

const boards = Array.from({ length: POPULATION }, randomBoard);
const effHealth = (u: LineupUnit): number => (UNIT_DEFS[u.defId]?.health ?? 0) * (u.tier ?? 1);
const ordered: Lineup[] = boards.map((b) => ({
  ...b,
  units: [...b.units].sort((x, y) => effHealth(y) - effHealth(x)),
}));

const pointsA = (r: { winner: 'a' | 'b' | 'draw' }): number =>
  r.winner === 'a' ? 3 : r.winner === 'draw' ? 1 : 0;

interface Row {
  id: string;
  perBoard: number[];
  better: number;
  worse: number;
}

function measure(boonId: string, field: Lineup[]): Row {
  const perBoard: number[] = [];
  let better = 0;
  let worse = 0;
  for (const a of field) {
    let gained = 0;
    let n = 0;
    for (const b of field) {
      if (a === b) continue;
      const d =
        pointsA(simulateDuel(a, b, boonId, null).result) - pointsA(simulateDuel(a, b).result);
      gained += d;
      n++;
      if (d > 0) better++;
      else if (d < 0) worse++;
    }
    perBoard.push(n > 0 ? gained / n : 0);
  }
  return { id: boonId, perBoard, better, worse };
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};
const f = (n: number): string => (n >= 0 ? '+' : '') + n.toFixed(3);

// The other twelve at their SHIPPED values, field B — same field
// pvp-boon-matrix.ts judges non-read-dependent boons on. Computed once,
// outside the sweep loop, since nothing here changes them.
const fieldRows = Object.keys(BOON_DEFS)
  .filter((id) => !UNMEASURABLE.has(id))
  .map((id) => measure(id, ordered));

function sweepOne(id: string, candidates: number[], setAmount: (v: number) => void): void {
  const def = BOON_DEFS[id];
  const original = JSON.parse(JSON.stringify(def.effect));
  console.log(`\n=== ${def.name} (${id}) ===`);
  console.log('  amount   p25(A)   med(A)   p75(A)   p25(B)   med(B)   p75(B)   helped(B) hurt(B)  dominance');
  console.log('  ' + '-'.repeat(96));
  for (const v of candidates) {
    setAmount(v);
    const rowA = measure(id, boards);
    const rowB = measure(id, ordered);
    const p25B = pct(rowB.perBoard, 0.25);
    const p75B = pct(rowB.perBoard, 0.75);
    const violations: string[] = [];
    if (!CONDITIONAL.has(id)) {
      for (const other of fieldRows) {
        if (other.id === id || CONDITIONAL.has(other.id)) continue;
        const otherP75 = pct(other.perBoard, 0.75);
        const otherP25 = pct(other.perBoard, 0.25);
        if (p25B > otherP75) violations.push(`beats ${other.id} p75 ${f(otherP75)}`);
        if (otherP25 > p75B) violations.push(`beaten by ${other.id} p25 ${f(otherP25)}`);
      }
    }
    console.log(
      `  ${String(v).padEnd(9)}` +
        `${f(pct(rowA.perBoard, 0.25)).padEnd(9)}${f(pct(rowA.perBoard, 0.5)).padEnd(9)}${f(pct(rowA.perBoard, 0.75)).padEnd(9)}` +
        `${f(p25B).padEnd(9)}${f(pct(rowB.perBoard, 0.5)).padEnd(9)}${f(p75B).padEnd(9)}` +
        `${String(rowB.better).padEnd(10)}${String(rowB.worse).padEnd(9)}` +
        (violations.length ? '! ' + violations.join('; ') : 'clean')
    );
  }
  def.effect = original;
}

console.log(`\nMagnitude sweep — seed "${SEED}". Points gained per duel (win 3, draw 1).`);
console.log('Dominance column checks the candidate at that row against the OTHER twelve boons at their shipped values (field B).');

sweepOne('rust', [2, 4, 6, 8, 10], (v) => {
  BOON_DEFS.rust.effect = { kind: 'sapArmorAll', amount: v };
});
sweepOne('barren', [0, 1, 2, 3, 4], (v) => {
  BOON_DEFS.barren.effect = { kind: 'capSummonHeadroom', headroom: v };
});
sweepOne('antidote', [1, 2, 3], (v) => {
  BOON_DEFS.antidote.effect = { kind: 'poisonNegation', amount: v };
});
console.log('\n  Antidote note: POISON_RESIST_CAP = 3, cap-not-sum, so amounts above 3 are');
console.log('  identical to 3 — nothing to sweep past the cap.\n');
