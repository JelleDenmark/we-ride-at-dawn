/**
 * THROWAWAY probe (2026-08-07): what SHARE of Draughtsman-Moe's SIDE's
 * outgoing damage is poison, in a PvP duel vs across a full PvE gauntlet
 * run? Tests the owner's hypothesis that PvP fights run long enough for
 * poison (a per-clash-tick DoT) to matter much more than it does in PvE.
 *
 * Side attribution: `battleStart.horde` lists side-A instanceIds,
 * `waveStart.enemies` lists side-B instanceIds (true for both gauntlet mode
 * — fresh enemies per wave — and duel mode, where side B is carried as
 * "enemies" for the wave loop, see BattleMode's doc comment in sim.ts).
 * "Side A's outgoing damage" = damage/poisonTick events whose targetId is
 * a side-B unit (and vice versa). Not wired into package.json.
 */
import { simulateDuel } from '../src/duel';
import { simulate } from '../src/sim';
import { generateGauntlet } from '../src/gauntlet';
import { type Lineup } from '../src/data/units';
import { BOARD_CAP, COMBAT_CAP_BONUS } from '../src/sim';
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
    if (e.type === 'summon') for (const u of [e.unit]) sideOf.set(u.instanceId, e.side === 'horde' ? 'A' : 'B');
    if (e.type === 'revive') sideOf.set(e.unit.instanceId, e.side === 'horde' ? 'A' : 'B');
  }
  const out = { A: { poison: 0, attack: 0 }, B: { poison: 0, attack: 0 } };
  for (const e of events) {
    if (e.type !== 'poisonTick' && e.type !== 'damage') continue;
    const targetSide = sideOf.get(e.targetId);
    if (!targetSide) continue; // unattributed (shouldn't happen for tracked units)
    const dealerSide = targetSide === 'A' ? 'B' : 'A';
    if (e.type === 'poisonTick') out[dealerSide].poison += e.amount;
    else out[dealerSide].attack += e.amount;
  }
  return out;
}

function shareLine(label: string, s: { poison: number; attack: number }) {
  const total = s.poison + s.attack;
  const share = total > 0 ? (s.poison / total) * 100 : 0;
  console.log(`  ${label}: poison=${s.poison} attack=${s.attack} total=${total} poisonShare=${share.toFixed(1)}%`);
}

const ratMoe = board(
  ['md-rattyfock', 'steel-whisker', 'ward-weaver', 'ward-weaver', 'ward-weaver', 'gutter-gourmand', 'gutter-gourmand', 'draughtsman-moe'],
  3
);
const wellDressedRat = board(
  ['ward-weaver', 'grave-leech', 'press-kin', 'dire-rat', 'brood-mother', 'gutter-acolyte', 'draughtsman-moe', 'corpse-glutton'],
  3
);
// Isolated single-Moe board (7 filler Dire-Rats), same shape used by the
// corrected PvP probe, vs a neutral no-poison opponent — cleanest read on
// what fraction of ONE Moe's own side's output is her poison.
const soloMoe = board(['draughtsman-moe', 'dire-rat', 'dire-rat', 'dire-rat', 'dire-rat', 'dire-rat', 'dire-rat', 'dire-rat'], 3);
const direRatWall = board(Array.from({ length: 8 }, () => 'dire-rat'), 3);

console.log('=== PvP duel: poison share of each side\'s outgoing damage ===');
console.log('RatMoe vs WellDressedRat (both run 1 Moe):');
shareLine('side A (RatMoe)', outgoingSplitBySide(simulateDuel(ratMoe, wellDressedRat).events).A);
shareLine('side B (WellDressedRat)', outgoingSplitBySide(simulateDuel(ratMoe, wellDressedRat).events).B);

console.log("\nIsolated: solo-Moe-plus-filler vs Dire-Rat wall (no poison on B):");
const isolatedDuel = outgoingSplitBySide(simulateDuel(soloMoe, direRatWall).events);
shareLine('side A (solo Moe)', isolatedDuel.A);

console.log('\n=== PvE: same solo-Moe board across the full gauntlet (30 seeded runs), poison share of horde\'s outgoing damage ===');
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
const pveTotal = totalPoison + totalAttack;
console.log(`waves cleared (sum)=${totalWaves} poison=${totalPoison} attack=${totalAttack} total=${pveTotal} poisonShare=${((totalPoison / pveTotal) * 100).toFixed(1)}%`);
