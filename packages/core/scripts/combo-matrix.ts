/**
 * Exhaustive cross-unit combo matrix (issue #121).
 *
 * The isolated-swap scripts (all-unit-value, relic-value) hold everything
 * except one unit fixed to an ability-less control board, so they are
 * STRUCTURALLY blind to two-unit synergies: a kit whose payoff needs a
 * trigger some other kit generates (Corpse-Glutton eating Gnawer faints,
 * Bone-Priest re-raising a faint-payload unit, ...) reads as near-dead in a
 * vacuum. This script closes that hole by brute force: EVERY unordered pair
 * of units (self-pairs included — two copies of one unit is also a combo),
 * in EVERY pair placement that matters in the front-clash sim, measured with
 * the real simulate() across many independent seasons.
 *
 * Method: on a day-4 (cap 7) board of tier-1 Gutter-Runt fillers, place the
 * pair at tier 2 in each arrangement:
 *
 *   front:  [A, B, f, f, f, f, f]   (and B,A)   — both clash early
 *   back:   [f, f, f, f, f, A, B]   (and B,A)   — both survive/faint late
 *   split:  [A, f, f, f, f, f, B]   (and B,A)   — one tanks, one anchors
 *
 * Singles are measured the same way (front slot / back slot, best kept), so
 * the headline number is super-additivity:
 *
 *   synergy(A,B) = bestPair(A,B) - dA - dB      (all deltas vs the filler
 *                                                baseline; dX = best single
 *                                                placement of X alone)
 *
 * synergy ~ 0  -> the units just add up; the per-unit rankings already tell
 *                 the truth about them.
 * synergy >> 0 -> a real combo the per-unit rankings under-rate (the
 *                 Corpse-Glutton failure mode from the 2026-07-16 audit).
 * synergy << 0 -> anti-synergy / saturation (the pair competes for the same
 *                 finite payoff).
 *
 * Damage deltas are tracked alongside depth (same rationale as
 * all-unit-value §3: wavesCleared saturates; damageDealt is the continuous
 * signal that still separates "real work, currently overkill" from "dead").
 *
 * The sweep covers the FULL roster except the summon-only pup — including
 * units currently rotated out of the shop pool (blight-witch, md-rattyfock,
 * dawn/dusk-runt) — because rotation flips season to season and a synergy
 * discovered now informs the next rotation decision.
 *
 * Run from the repo root: npm run balance:combos
 * (or from packages/core:  npx tsx scripts/combo-matrix.ts)
 */
import { simulate } from '../src/sim';
import { generateGauntlet } from '../src/gauntlet';
import { UNIT_DEFS, type Lineup, type TimeOfDay } from '../src/data/units';
import { boardCapForDay } from '../src/shop';

const DAY = 4; // mid-expedition: cap 7, the point most pairs first coexist at t2
const TIER = 2;
const FILLER = 'gutter-runt';
/** Independent Monday-anchored seasons (one gauntlet each — see #41). */
const SEASONS: string[] = [];
{
  const base = Date.parse('2026-07-06T12:00:00Z');
  for (let i = 0; i < 40; i++) SEASONS.push(new Date(base + i * 7 * 86_400_000).toISOString().slice(0, 10));
}
/** Pairs whose synergy clears this many waves get the loud flag treatment,
 * same spirit as exploit-stress's threshold: not "interesting", "act on it". */
const FLAG_THRESHOLD = 1.0;

const IDS = Object.keys(UNIT_DEFS).filter((id) => id !== 'pup');
const CAP = boardCapForDay(DAY);

// timeOfDay-gated kits (dawn/dusk-runt's condition — twilight-runt's rework
// to the wave-keyed teamBuffByWave removed it from this set) are blended
// 50/50 across both half-days, like a real expedition sees; everything else
// skips the second sim for speed.
const TOD_SENSITIVE = new Set(['dawn-runt', 'dusk-runt']);

let SIM_CALLS = 0;
const gauntlets = SEASONS.map((d) => generateGauntlet(d, DAY));

interface Measure {
  waves: number;
  damage: number;
}

function measure(order: readonly string[]): Measure {
  const units: Lineup['units'] = order.map((defId) => ({
    defId,
    tier: defId === FILLER ? 1 : TIER,
    relicIds: [],
  }));
  const tods: (TimeOfDay | undefined)[] = order.some((id) => TOD_SENSITIVE.has(id))
    ? ['beforeNoon', 'afterNoon']
    : [undefined];
  let waves = 0;
  let damage = 0;
  for (const g of gauntlets) {
    for (const timeOfDay of tods) {
      SIM_CALLS++;
      const r = simulate({ units, teamRelicIds: [], timeOfDay }, g).result;
      waves += r.wavesCleared / tods.length;
      damage += r.damageDealt / tods.length;
    }
  }
  return { waves: waves / SEASONS.length, damage: damage / SEASONS.length };
}

function board(placed: Record<number, string>): string[] {
  return Array.from({ length: CAP }, (_, i) => placed[i] ?? FILLER);
}

const t0 = performance.now();
console.log('=== CROSS-UNIT COMBO MATRIX (issue #121) ===');
console.log(
  `${IDS.length} units -> ${(IDS.length * (IDS.length - 1)) / 2 + IDS.length} pairs x up to 6 arrangements, ` +
    `tier ${TIER} on a t1 ${FILLER} board, day ${DAY} (cap ${CAP}), ${SEASONS.length} seasons\n`
);

const baseline = measure(board({}));
console.log(`filler baseline: ${baseline.waves.toFixed(2)} waves, ${Math.round(baseline.damage)} damage\n`);

// Singles: best of front/back, reused for every pair containing the unit.
const singles = new Map<string, { d: number; dmg: number; pos: 'front' | 'back' }>();
for (const id of IDS) {
  const front = measure(board({ 0: id }));
  const back = measure(board({ [CAP - 1]: id }));
  const best = front.waves >= back.waves ? { m: front, pos: 'front' as const } : { m: back, pos: 'back' as const };
  singles.set(id, { d: best.m.waves - baseline.waves, dmg: best.m.damage - baseline.damage, pos: best.pos });
}

interface PairRow {
  a: string;
  b: string;
  pairDelta: number;
  dA: number;
  dB: number;
  synergy: number;
  synergyDmg: number;
  arrangement: string;
}

const rows: PairRow[] = [];
for (let i = 0; i < IDS.length; i++) {
  for (let j = i; j < IDS.length; j++) {
    const a = IDS[i];
    const b = IDS[j];
    const arrangements: { label: string; placed: Record<number, string> }[] = [
      { label: 'front A,B', placed: { 0: a, 1: b } },
      { label: 'back A,B', placed: { [CAP - 2]: a, [CAP - 1]: b } },
      { label: 'split A..B', placed: { 0: a, [CAP - 1]: b } },
    ];
    if (a !== b) {
      arrangements.push(
        { label: 'front B,A', placed: { 0: b, 1: a } },
        { label: 'back B,A', placed: { [CAP - 2]: b, [CAP - 1]: a } },
        { label: 'split B..A', placed: { 0: b, [CAP - 1]: a } }
      );
    }
    let best: { m: Measure; label: string } | null = null;
    for (const arr of arrangements) {
      const m = measure(board(arr.placed));
      if (!best || m.waves > best.m.waves || (m.waves === best.m.waves && m.damage > best.m.damage)) {
        best = { m, label: arr.label };
      }
    }
    const dA = singles.get(a)!;
    const dB = singles.get(b)!;
    const pairDelta = best!.m.waves - baseline.waves;
    rows.push({
      a,
      b,
      pairDelta,
      dA: dA.d,
      dB: dB.d,
      synergy: pairDelta - dA.d - dB.d,
      synergyDmg: best!.m.damage - baseline.damage - dA.dmg - dB.dmg,
      arrangement: best!.label,
    });
  }
}

rows.sort((x, y) => y.synergy - x.synergy);

const flagged = rows.filter((r) => r.synergy >= FLAG_THRESHOLD);
console.log(`--- FLAGGED: synergy >= +${FLAG_THRESHOLD.toFixed(1)} waves over the sum of parts (${flagged.length}) ---\n`);
const printRow = (r: PairRow) =>
  console.log(
    `${(r.a === r.b ? `${r.a} x2` : `${r.a} + ${r.b}`).padEnd(34)} pair ${(r.pairDelta >= 0 ? '+' : '') + r.pairDelta.toFixed(2).padStart(6)}` +
      `  parts ${(r.dA + r.dB >= 0 ? '+' : '') + (r.dA + r.dB).toFixed(2).padStart(6)}` +
      `  synergy ${(r.synergy >= 0 ? '+' : '') + r.synergy.toFixed(2).padStart(6)}` +
      `  dmgSyn ${(r.synergyDmg >= 0 ? '+' : '') + Math.round(r.synergyDmg).toString().padStart(6)}` +
      `  best: ${r.arrangement}`
  );
for (const r of flagged) printRow(r);
if (flagged.length === 0) console.log('(none)');

console.log('\n--- TOP 20 BY SYNERGY ---\n');
for (const r of rows.slice(0, 20)) printRow(r);

console.log('\n--- BOTTOM 5 (anti-synergy / saturation) ---\n');
for (const r of rows.slice(-5)) printRow(r);

console.log('\n--- SINGLES REFERENCE (best placement vs filler baseline) ---\n');
for (const [id, s] of [...singles.entries()].sort((x, y) => y[1].d - x[1].d)) {
  console.log(`${id.padEnd(16)} ${(s.d >= 0 ? '+' : '') + s.d.toFixed(2).padStart(6)} waves  (${s.pos})`);
}

console.log(
  `\n(${SIM_CALLS.toLocaleString()} sim calls in ${((performance.now() - t0) / 1000).toFixed(1)}s.` +
    ` Deltas are vs a t1 filler board, so magnitudes are context-relative; the RANKING and the` +
    ` synergy sign are the signal. Relic-dependent and 3+-unit combos remain out of scope.)`
);
