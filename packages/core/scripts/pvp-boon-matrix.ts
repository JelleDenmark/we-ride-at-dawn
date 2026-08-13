/**
 * Daily-boon PvP matrix (issue #184, methodology from #186).
 *
 * WHY THIS DOES NOT LOOK LIKE THE OTHER MATRICES
 *
 * `pvp-unit-matrix` and `pvp-relic-matrix` measure an entity against a fixed
 * panel of hand-authored opponents. That works for a unit, whose value is a
 * property of the unit. It does not work for a boon, for two reasons #186
 * spells out:
 *
 *  1. Boons made ORDERING strategically live — Drag, Buried, Silence, Bulwark
 *     and Rearguard all read `units[0]` or `units[n-1]`. The hand-authored
 *     comps were written as COMPOSITIONS; nobody chose their orderings.
 *     Measure a positional boon against them and you measure an accident of
 *     how someone typed an array.
 *
 *  2. "How strong is Drag" has no answer. It is devastating against a board
 *     with a backline attacker and nothing against a two-rat board. A mean
 *     hides exactly the variance that decides whether a boon is healthy, so
 *     the output is a DISTRIBUTION and the bar is stated as overlap.
 *
 * TWO FIELDS, because one is not enough:
 *
 *  A. RANDOM ORDER — avoids inheriting a fixture's ordering convention.
 *  B. TANK FIRST — the same compositions sorted by effective health.
 *
 * Field A alone is a straw board for positional boons: a real player leads
 * with their toughest rat, and against a randomly-ordered line Buried can
 * promote a BETTER rat than the one it demotes, which makes it read as a trap
 * when it is really being measured against something nobody would field.
 * Positional boons are judged on field B. A boon that only works against
 * sloppy ordering does not work.
 *
 * Determinism: a duel has no RNG (see `simulateDuel`) and the population comes
 * from a fixed seed, so every number is exact. Re-running proves nothing;
 * changing SEED (env BOON_SEED) checks a conclusion is not one population's
 * artifact.
 *
 * WHAT THIS CANNOT MEASURE, stated rather than silently averaged:
 *
 *  - `deep-scout` is EXCLUDED. Its whole value is information the sim cannot
 *    act on, because nothing here models a player adapting to what they saw.
 *    A number for it would be a lie of zero.
 *  - `silence` is measured but must not be judged on its median — it is
 *    read-dependent, so its spread is the finding.
 *  - `echo` is CONDITIONAL by design (owner call: a player with no summoner
 *    picks something else), so a population-wide row understates it by
 *    construction. It gets its own field, C, and sits out the dominance check.
 */
import { UNIT_DEFS, type Lineup, type LineupUnit } from '../src/data/units';
import { RELIC_DEFS } from '../src/data/relics';
import { seasonUnitPool, MAX_TIER } from '../src/shop';
import { simulateDuel } from '../src/duel';
import { BOON_DEFS, HELD_BOONS } from '../src/boons';
import { xorshift128 } from '../src/prng';
import { fnv1a } from '../src/seed';

const POPULATION = 30;
const SEED = process.env.BOON_SEED ?? 'boon-matrix-v1';
const UNMEASURABLE = new Set(['deep-scout']);
const READ_DEPENDENT = new Set(['silence']);
const CONDITIONAL = new Set(['echo']);

const rng = xorshift128(fnv1a(SEED));
const pool = seasonUnitPool();
const unitRelics = Object.values(RELIC_DEFS).filter((r) => r.scope === 'unit');
const teamRelics = Object.values(RELIC_DEFS).filter((r) => r.scope === 'team');

/**
 * A plausible board: 3-8 rats, tiers skewed to 1-2, about a third carrying a
 * relic.
 *
 * The first draft handed out NO relics, which quietly made one boon
 * unmeasurable: A Body First exists largely to spend the enemy's first-hit
 * relic bonus (Glass Shard) on a worthless body, and against a relic-free
 * field that mechanic can never fire. It measured as dead weight for a reason
 * that was an artifact of the fixture, not a property of the boon.
 */
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

const summonerBoards = ordered.filter((b) =>
  b.units.some((u) => {
    const e = UNIT_DEFS[u.defId]?.ability?.effect.kind;
    return e === 'summon' || e === 'summonScaledPup' || e === 'maintainSummons';
  })
);

/** League points a duel is worth to side A (win 3, draw 1). */
const pointsA = (r: { winner: 'a' | 'b' | 'draw' }): number =>
  r.winner === 'a' ? 3 : r.winner === 'draw' ? 1 : 0;

interface Row {
  id: string;
  name: string;
  perBoard: number[];
  better: number;
  worse: number;
  pairs: number;
}

function measure(boonId: string, field: Lineup[]): Row {
  const perBoard: number[] = [];
  let better = 0;
  let worse = 0;
  let pairs = 0;
  for (const a of field) {
    let gained = 0;
    let n = 0;
    for (const b of field) {
      if (a === b) continue;
      const d =
        pointsA(simulateDuel(a, b, boonId, null).result) - pointsA(simulateDuel(a, b).result);
      gained += d;
      n++;
      pairs++;
      if (d > 0) better++;
      else if (d < 0) worse++;
    }
    perBoard.push(n > 0 ? gained / n : 0);
  }
  const def = BOON_DEFS[boonId] ?? HELD_BOONS[boonId];
  return { id: boonId, name: def.name, perBoard, better, worse, pairs };
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};
const f = (n: number): string => (n >= 0 ? '+' : '') + n.toFixed(3);
const line = (r: Row, tag = ''): string =>
  `  ${(r.name + tag).padEnd(20)}${f(pct(r.perBoard, 0.25)).padEnd(9)}${f(pct(r.perBoard, 0.5)).padEnd(9)}${f(pct(r.perBoard, 0.75)).padEnd(9)}${String(r.better).padEnd(9)}${r.worse}`;

const measurable = Object.keys(BOON_DEFS).filter((id) => !UNMEASURABLE.has(id));

function table(label: string, field: Lineup[]): Row[] {
  const rows = measurable.map((id) => measure(id, field));
  console.log(`\n${label} — ${field.length} boards, ${rows[0].pairs} duels per boon`);
  console.log('  boon                p25      median   p75      helped   hurt');
  console.log('  ' + '-'.repeat(64));
  for (const r of [...rows].sort((x, y) => pct(y.perBoard, 0.5) - pct(x.perBoard, 0.5))) {
    console.log(line(r, READ_DEPENDENT.has(r.id) ? ' *' : CONDITIONAL.has(r.id) ? ' +' : ''));
  }
  return rows;
}

console.log(`\nDaily boon matrix — seed "${SEED}". Points gained per duel (win 3, draw 1).`);
console.log('Spread is across BOARDS, not seeds — a duel has no RNG.');

table('A. RANDOM ORDER (composition only)', boards);
const rows = table('B. TANK FIRST (deliberate order — judge positional boons here)', ordered);

console.log('\n  * read-dependent: judge on spread, not median.');
console.log('  + conditional: see field C.');
for (const id of UNMEASURABLE) {
  console.log(`  ${BOON_DEFS[id].name}: EXCLUDED — no sim surface; its value is information`);
  console.log('    the sim cannot act on, because nothing models a player adapting.');
}

if (!BOON_DEFS.echo) {
  console.log(`
C. ECHO: HELD out of the pool — measured dead on two populations.`);
  console.log('  Kept in HELD_BOONS with its tests; restoring it means giving it');
  console.log('  a reason to be worth a pick, not just moving the entry back.');
} else if (summonerBoards.length >= 3) {
  const echo = measure('echo', summonerBoards);
  console.log(
    `\nC. ECHO on summoner boards only — ${summonerBoards.length} boards, ${echo.pairs} duels`
  );
  console.log(line(echo));
  console.log('  Conditional by design; the population-wide row understates it.');
} else {
  console.log(`\nC. ECHO: only ${summonerBoards.length} summoner boards — too few to measure.`);
}

// The bar per #186 is overlap, not magnitude: a boon whose p25 clears another's
// p75 is a pick you take without thinking, which is how a choice collapses into
// a tax on whoever misread it. Judged on field B; Echo sits out as conditional.
console.log('\nDominance check on field B (p25 of one vs p75 of another):');
let dominant = 0;
for (const hi of rows) {
  for (const lo of rows) {
    if (hi.id === lo.id || CONDITIONAL.has(hi.id) || CONDITIONAL.has(lo.id)) continue;
    if (pct(hi.perBoard, 0.25) > pct(lo.perBoard, 0.75)) {
      console.log(
        `  ! ${hi.name} p25 ${f(pct(hi.perBoard, 0.25))} > ${lo.name} p75 ${f(pct(lo.perBoard, 0.75))}`
      );
      dominant++;
    }
  }
}
if (dominant === 0) console.log('  none — no boon strictly outranks another.');
console.log('');
