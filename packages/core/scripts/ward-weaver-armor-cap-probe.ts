/**
 * THROWAWAY probe (2026-08-08) for the "does Ward-Weaver's grantArmor need a
 * per-side stacking cap, the way poison got one (#116)" question. Follows the
 * same conventions as pvp-acolyte-vs-moe-probe.ts / poison-decay-sweep.ts:
 * real live boards (pvp_boards_public, season 2026-08-03.2, RatMoe /
 * Well-Dressed-Rat), simulateDuel, no relics (isolates the unit-kit
 * question). Not wired into package.json.
 *
 * Part 1: mechanism check — does grantArmor actually stack additively across
 * N independent Ward-Weaver casters? Uses a clean, unfloored probe (T3 only,
 * where the numbers don't get swallowed by MIN_ATTACK_DAMAGE) so the
 * increments can be read directly off real 'damage' events instead of just
 * re-deriving the code's own arithmetic.
 *
 * Part 2: floor threshold — at T1/T2/T3, how many Ward-Weaver casters does
 * it take before a REAL attacker's hit on a Dire-Rat-fronted board gets
 * floored to MIN_ATTACK_DAMAGE=1? Sweeps N=0..3 against several real unit
 * attackers (own tier-scaled attack only, no buffs) so this is about the
 * armor side, not a specific buffed board.
 *
 * Part 3: does it matter for a REAL matchup? RatMoe (the live board that
 * actually runs 3x Ward-Weaver) vs Well-Dressed-Rat (real live opponent,
 * runs 1x Ward-Weaver itself), sweeping RatMoe's own Ward-Weaver count
 * 0/1/2/3 (swapping the non-present copies for filler Dire-Rat, keeping
 * board size constant) to see whether going from N=1 to N=3 changes the
 * duel outcome/margin/length at all once it's a real opponent, not a
 * synthetic stress board — same check the poison-cap re-test (#155,
 * wrad-pvp-season1-meta 2026-08-07) used before concluding a cap was/wasn't
 * a lever.
 */
import { simulateDuel } from '../src/duel';
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

function firstDamageAmount(events: BattleEvent[], targetId: number): number | undefined {
  for (const e of events) {
    if (e.type === 'damage' && e.targetId === targetId) return e.amount;
  }
  return undefined;
}

console.log('=== PART 1: does grantArmor stack additively across N casters? (T3, unfloored) ===\n');
console.log('Defender: [dire-rat(front), ward-weaver x N, filler...]  Attacker: [dire-rat] alone.');
console.log('dire-rat base damageReduction=2/tier (own armor, constant); wardArmorForTier(T3)=6/caster.\n');
for (const N of [0, 1, 2, 3]) {
  const defenders = ['dire-rat', ...Array.from({ length: N }, () => 'ward-weaver'), ...Array.from({ length: Math.max(0, CAP - 1 - N) }, () => 'dire-rat')];
  const defBoard = board(defenders, 3);
  const atkBoard = board(['dire-rat'], 3);
  const { events } = simulateDuel(defBoard, atkBoard);
  // side A is horde -> front defender is the first unit instantiated (instanceId assigned in order).
  const battleStart = events.find((e) => e.type === 'battleStart');
  const frontId = battleStart && battleStart.type === 'battleStart' ? battleStart.horde[0].instanceId : undefined;
  const dealt = frontId !== undefined ? firstDamageAmount(events, frontId) : undefined;
  console.log(`N=${N} ward-weaver: first-hit dealt to front dire-rat = ${dealt}`);
}

console.log('\n=== PART 2: floor threshold — N ward-weavers vs real (unbuffed, tier-scaled) attackers ===\n');
const realAttackers = ['dire-rat', 'md-rattyfock', 'grave-leech', 'draughtsman-moe', 'press-kin', 'gutter-acolyte'];
for (const tier of [1, 2, 3]) {
  console.log(`-- Tier ${tier} --`);
  for (const atkId of realAttackers) {
    const line: string[] = [];
    for (const N of [0, 1, 2, 3]) {
      const defenders = ['dire-rat', ...Array.from({ length: N }, () => 'ward-weaver'), ...Array.from({ length: Math.max(0, CAP - 1 - N) }, () => 'dire-rat')];
      const defBoard = board(defenders, tier);
      const atkBoard = board([atkId], tier);
      const { events } = simulateDuel(defBoard, atkBoard);
      const battleStart = events.find((e) => e.type === 'battleStart');
      const frontId = battleStart && battleStart.type === 'battleStart' ? battleStart.horde[0].instanceId : undefined;
      const dealt = frontId !== undefined ? firstDamageAmount(events, frontId) : undefined;
      const floored = dealt === 1 ? '*' : ' ';
      line.push(`N=${N}:${String(dealt).padStart(3)}${floored}`);
    }
    console.log(`  ${atkId.padEnd(16)} ${line.join('  ')}`);
  }
}
console.log('\n(* = floored to MIN_ATTACK_DAMAGE=1; attacker stats are base tier-scaled only, no relics/buffs)');

console.log('\n=== PART 3: real matchup — RatMoe (N ward-weaver) vs Well-Dressed-Rat (real live opponent) ===\n');
// Real live boards (pvp_boards_public, season 2026-08-03.2, per wrad-pvp-season1-meta.md
// and pvp-acolyte-vs-moe-probe.ts / poison-decay-sweep.ts). RatMoe's front is md-rattyfock,
// not a ward-weaver itself; ward-weaver copies are elsewhere in the array (all:true reach
// makes position irrelevant to the grant, only to who clashes).
function ratMoeWithN(n: number, tier: number): Lineup {
  const wards = Array.from({ length: n }, () => 'ward-weaver');
  const filler = Array.from({ length: 3 - n }, () => 'dire-rat');
  return board(['md-rattyfock', 'steel-whisker', ...wards, ...filler, 'gutter-gourmand', 'gutter-gourmand', 'draughtsman-moe'], tier);
}
const wellDressedRat3 = board(
  ['ward-weaver', 'grave-leech', 'press-kin', 'dire-rat', 'brood-mother', 'gutter-acolyte', 'draughtsman-moe', 'corpse-glutton'],
  3
);
for (const N of [0, 1, 2, 3]) {
  const ratMoe = ratMoeWithN(N, 3);
  const { events, result } = simulateDuel(ratMoe, wellDressedRat3);
  const ticks = events.filter((e) => e.type === 'clash').length;
  console.log(
    `N=${N} ward-weaver  winner=${result.winner.padEnd(5)} healthA(ratmoe)=${String(result.healthA).padStart(4)} ` +
      `healthB(wdr)=${String(result.healthB).padStart(4)} diff=${String(result.healthA - result.healthB).padStart(5)} clashTicks=${ticks}`
  );
}
