/**
 * Scratch: A Body First against a population that can actually trigger it.
 *
 * The boon exists largely to spend the enemy front's FIRST-HIT relic bonus
 * (Glass Shard: +4 and ignores armor) on a worthless body. The general
 * population puts a first-hit relic on a board's front about 5% of the time
 * (33% relic chance x 1 of 7 unit relics), so the shipped matrix has never
 * measured that mechanic — it measures the chump-body and line-shift effects
 * only.
 *
 * This is the field-C treatment the design bank says Barren/Stripped/First
 * Blood still need, applied to A Body First: same boards, but every front
 * carries Glass Shard. Echo is measured alongside on the same fields, since
 * the open question is whether A Body First is Echo-shaped.
 */
import { UNIT_DEFS, type Lineup, type LineupUnit } from '../src/data/units';
import { RELIC_DEFS } from '../src/data/relics';
import { seasonUnitPool, MAX_TIER } from '../src/shop';
import { simulateDuel } from '../src/duel';
import { xorshift128 } from '../src/prng';
import { fnv1a } from '../src/seed';

const SEED = process.env.BOON_SEED ?? 'boon-matrix-v1';
const rng = xorshift128(fnv1a(SEED));
const pool = seasonUnitPool();
const unitRelics = Object.values(RELIC_DEFS).filter((r) => r.scope === 'unit');
const teamRelics = Object.values(RELIC_DEFS).filter((r) => r.scope === 'team');

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
    teamRelics.length > 0 && rng.int(100) < 40 ? [teamRelics[rng.int(teamRelics.length)].id] : undefined;
  return teamRelicIds
    ? { units, combatCap: units.length + 2, teamRelicIds }
    : { units, combatCap: units.length + 2 };
}

const effHealth = (u: LineupUnit): number => (UNIT_DEFS[u.defId]?.health ?? 0) * (u.tier ?? 1);
const tankFirst = (b: Lineup): Lineup => ({
  ...b,
  units: [...b.units].sort((x, y) => effHealth(y) - effHealth(x)),
});

const base = Array.from({ length: 30 }, randomBoard).map(tankFirst);

/** Same boards, every front given Glass Shard. */
const glassFront: Lineup[] = base.map((b) => ({
  ...b,
  units: b.units.map((u, i) => (i === 0 ? { ...u, relicIds: ['glass-shard'] } : u)),
}));

/** Same boards, every board given a summoner at the back (Echo's field C). */
const summonerIds = Object.values(UNIT_DEFS)
  .filter((d) => {
    const k = d.ability?.effect.kind;
    return k === 'summon' || k === 'summonScaledPup' || k === 'maintainSummons';
  })
  .map((d) => d.id);
const summonerField: Lineup[] = base.map((b, i) => ({
  ...b,
  units: [...b.units, { defId: summonerIds[i % summonerIds.length], tier: 1 }],
  combatCap: b.units.length + 3,
}));

const pointsA = (r: { winner: 'a' | 'b' | 'draw' }): number =>
  r.winner === 'a' ? 3 : r.winner === 'draw' ? 1 : 0;

function measure(boonId: string, field: Lineup[]): { mean: number; helped: number; hurt: number; n: number } {
  let total = 0;
  let helped = 0;
  let hurt = 0;
  let n = 0;
  for (const a of field) {
    for (const b of field) {
      if (a === b) continue;
      const d = pointsA(simulateDuel(a, b, boonId, null).result) - pointsA(simulateDuel(a, b).result);
      total += d;
      n++;
      if (d > 0) helped++;
      else if (d < 0) hurt++;
    }
  }
  return { mean: total / n, helped, hurt, n };
}

console.log(`Seed "${SEED}". Points per duel (win 3, draw 1). Tank-first ordering throughout.\n`);
const fields: Array<[string, Lineup[]]> = [
  ['general population', base],
  ['every front has Glass Shard', glassFront],
  ['every board has a summoner', summonerField],
];

console.log(`${'field'.padEnd(30)} ${'boon'.padEnd(14)}  mean      helped  hurt`);
console.log('-'.repeat(72));
for (const [label, field] of fields) {
  for (const boonId of ['a-body-first', 'echo']) {
    const r = measure(boonId, field);
    const sign = r.mean >= 0 ? '+' : '';
    console.log(
      `${label.padEnd(30)} ${boonId.padEnd(14)}  ${sign}${r.mean.toFixed(3).padEnd(8)}  ` +
        `${String(r.helped).padStart(4)}    ${String(r.hurt).padStart(4)}   (of ${r.n})`
    );
  }
  console.log();
}
