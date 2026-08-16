/**
 * THROWAWAY sweep (2026-08-07): find a poison-decay shape that curbs the
 * PvP-duel-length poison exploit (see moe-poison-share-probe.ts — poison is
 * 41.5% of a solo Moe's duel damage vs 1.8% in PvE, because poison never
 * decays and ticks at full stack value for the unit's whole remaining life)
 * WITHOUT gutting her PvE contribution (already mediocre/declining by tier
 * per wrad-pvp-season1-meta.md) or collateral-damaging small-stack poison
 * sources like Plague-Bearer.
 *
 * The decay shape (flat vs halving) was swept manually (edit sim.ts,
 * re-run) — this script just reports the metrics for whatever
 * `POISON_DECAY_ENABLED` is currently set to, so the same numbers are
 * comparable run to run. See that constant's doc comment in sim.ts for the
 * final derivation. Not wired into package.json.
 */
import { simulateDuel } from '../src/duel';
import { simulate } from '../src/sim';
import { generateGauntlet } from '../src/gauntlet';
import { type Lineup } from '../src/data/units';
import { BOARD_CAP, COMBAT_CAP_BONUS, POISON_DECAY_ENABLED } from '../src/sim';
import type { BattleEvent } from '../src/sim';

const CAP = BOARD_CAP;
const COMBAT_CAP = CAP + COMBAT_CAP_BONUS;

function board(defIds: string[], tier: number): Lineup {
  return {
    units: defIds.map((defId) => ({ defId, tier, relicIds: [] as string[] })),
    teamRelicIds: [],
    combatCap: COMBAT_CAP,
  };
}

function outgoingSplitBySide(events: BattleEvent[]) {
  const sideOf = new Map<number, 'A' | 'B'>();
  for (const e of events) {
    if (e.type === 'battleStart') for (const u of e.horde) sideOf.set(u.instanceId, 'A');
    if (e.type === 'waveStart') for (const u of e.enemies) sideOf.set(u.instanceId, 'B');
    if (e.type === 'summon') sideOf.set(e.unit.instanceId, e.side === 'horde' ? 'A' : 'B');
    if (e.type === 'revive') sideOf.set(e.unit.instanceId, e.side === 'horde' ? 'A' : 'B');
  }
  const out = { A: { poison: 0, attack: 0 }, B: { poison: 0, attack: 0 } };
  for (const e of events) {
    if (e.type !== 'poisonTick' && e.type !== 'damage') continue;
    const targetSide = sideOf.get(e.targetId);
    if (!targetSide) continue;
    const dealerSide = targetSide === 'A' ? 'B' : 'A';
    if (e.type === 'poisonTick') out[dealerSide].poison += e.amount;
    else out[dealerSide].attack += e.amount;
  }
  return out;
}

const ratMoe = board(
  ['md-rattyfock', 'steel-whisker', 'ward-weaver', 'ward-weaver', 'ward-weaver', 'gutter-gourmand', 'gutter-gourmand', 'draughtsman-moe'],
  3
);
const wellDressedRat = board(
  ['ward-weaver', 'grave-leech', 'press-kin', 'dire-rat', 'brood-mother', 'gutter-acolyte', 'draughtsman-moe', 'corpse-glutton'],
  3
);
const soloMoe = board(['draughtsman-moe', 'dire-rat', 'dire-rat', 'dire-rat', 'dire-rat', 'dire-rat', 'dire-rat', 'dire-rat'], 3);
const direRatWall = board(Array.from({ length: 8 }, () => 'dire-rat'), 3);
const acolyteCounter = board(
  ['gutter-acolyte', 'gutter-acolyte', 'dire-rat', 'dire-rat', 'dire-rat', 'dire-rat', 'dire-rat', 'dire-rat'],
  3
);

console.log(`=== POISON_DECAY_ENABLED = ${POISON_DECAY_ENABLED} ===\n`);

console.log('-- PvP isolated: solo-Moe vs Dire-Rat wall --');
{
  const { result, events } = simulateDuel(soloMoe, direRatWall);
  const s = outgoingSplitBySide(events).A;
  const total = s.poison + s.attack;
  console.log(
    `winner=${result.winner} healthA=${result.healthA} healthB=${result.healthB} poison=${s.poison} attack=${s.attack} poisonShare=${((s.poison / total) * 100).toFixed(1)}%`
  );
}

console.log('\n-- PvP real board: RatMoe vs Well-Dressed-Rat --');
{
  const { result, events } = simulateDuel(ratMoe, wellDressedRat);
  const split = outgoingSplitBySide(events);
  const totalA = split.A.poison + split.A.attack;
  const totalB = split.B.poison + split.B.attack;
  console.log(`winner=${result.winner} healthA=${result.healthA} healthB=${result.healthB}`);
  console.log(`  side A (RatMoe) poisonShare=${((split.A.poison / totalA) * 100).toFixed(1)}%`);
  console.log(`  side B (WellDressedRat) poisonShare=${((split.B.poison / totalB) * 100).toFixed(1)}%`);
}

console.log('\n-- PvP counter check: does the Acolyte counter-board now actually beat RatMoe? --');
{
  const { result } = simulateDuel(acolyteCounter, ratMoe);
  console.log(`winner=${result.winner} healthA(acolyte)=${result.healthA} healthB(ratmoe)=${result.healthB} diff=${result.healthA - result.healthB}`);
}

console.log('\n-- PvE: solo-Moe board across 30 seeded full gauntlets --');
{
  let totalPoison = 0;
  let totalAttack = 0;
  let totalWaves = 0;
  for (let day = 1; day <= 30; day++) {
    const date = `2026-0${1 + (day % 9)}-${String(1 + (day % 28)).padStart(2, '0')}`;
    const gauntlet = generateGauntlet(date, day);
    const { events, result } = simulate(soloMoe, gauntlet);
    const split = outgoingSplitBySide(events);
    totalPoison += split.A.poison;
    totalAttack += split.A.attack;
    totalWaves += result.wavesCleared;
  }
  const total = totalPoison + totalAttack;
  console.log(`wavesCleared(sum)=${totalWaves} poison=${totalPoison} attack=${totalAttack} poisonShare=${((totalPoison / total) * 100).toFixed(1)}%`);
}
