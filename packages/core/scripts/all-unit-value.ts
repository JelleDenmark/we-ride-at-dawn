/**
 * Per-unit, per-tier cost-efficiency report: waves cleared per 100 scrap
 * actually spent reaching that tier (issue #58).
 *
 * Methodology mirrors the "UNIT VALUE RANKING" section of snowball.ts
 * (`depthWithFiller`): swap a single candidate unit into one slot of an
 * otherwise all-gutter-runt board, at a representative mid-expedition day,
 * and measure the depth delta versus the same board with the slot left as
 * a filler gutter-runt. Tested at BOTH the front and back slot (position is
 * a real lever — faint/allyFaint-triggered units often want the back), and
 * the better of the two is reported.
 *
 * The scrap cost for a given tier is the REAL cost of getting there via
 * merging, not the sticker price: 3 copies of tier N -> 1 copy of tier N+1,
 * so tier T costs `unit.cost * 3^(tier-1)` (1x / 3x / 9x) — same curve as
 * `tierAttackMultiplier`/`tierHealthMultiplier` (issue #22), which is
 * exactly the mismatch issue #58 fixes for buffBehind/buffAdjacent/teamBuff.
 *
 * waves/100scrap = depthDelta / mergeCost * 100.
 *
 * Run: npx tsx scripts/all-unit-value.ts   (from packages/core)
 */
import { generateGauntlet } from '../src/gauntlet';
import { simulate } from '../src/sim';
import { UNIT_DEFS } from '../src/data/units';
import { boardCapForDay } from '../src/shop';

const UNIT_TEST_DAY = 4;
const SAMPLES = 150;
const TEST_DATES: string[] = [];
{
  const base = Date.parse('2026-07-06T12:00:00Z');
  for (let i = 0; i < SAMPLES; i++) TEST_DATES.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Dawn-Runt/Dusk-Runt only fire on one half of the day — average across both
// halves so their reported value isn't an artifact of picking a favorable
// timeOfDay (a real player sees both halves over an expedition).
function depthWithFiller(swapDefId: string | null, tier: number, pos: 'front' | 'back'): number {
  const filler = 'gutter-runt';
  const cap = boardCapForDay(UNIT_TEST_DAY);
  const slot = pos === 'front' ? 0 : cap - 1;
  const units = Array.from({ length: cap }, (_, i) => ({
    defId: i === slot && swapDefId ? swapDefId : filler,
    tier: i === slot && swapDefId ? tier : 1,
    relicIds: [] as string[],
  }));
  const timeOfDays = ['beforeNoon', 'afterNoon'] as const;
  const deltas = timeOfDays.map((timeOfDay) => {
    const lineup = { units, teamRelicIds: [] as string[], timeOfDay };
    const ds = TEST_DATES.map((d) => simulate(lineup, generateGauntlet(d, UNIT_TEST_DAY)).result.wavesCleared);
    return avg(ds);
  });
  return avg(deltas);
}

const fillerBaseline = depthWithFiller(null, 1, 'front');

const CANDIDATES = ['md-rattyfock', 'warren-warden', 'press-kin', 'gnawer', 'dawn-runt', 'dusk-runt'];

console.log(
  `all-unit-value report — day ${UNIT_TEST_DAY} (cap ${boardCapForDay(UNIT_TEST_DAY)}), baseline (all gutter-runt) ${fillerBaseline.toFixed(3)}, ${SAMPLES} dates x 2 timeOfDay halves\n`
);
console.log('unit             tier  cost  mergeCost  Δ depth   waves/100scrap');
for (const id of CANDIDATES) {
  const def = UNIT_DEFS[id];
  if (!def) {
    console.log(`${id.padEnd(15)}  (not found in UNIT_DEFS)`);
    continue;
  }
  for (let tier = 1; tier <= 3; tier++) {
    const mergeCost = def.cost * Math.pow(3, tier - 1);
    const front = depthWithFiller(id, tier, 'front') - fillerBaseline;
    const back = depthWithFiller(id, tier, 'back') - fillerBaseline;
    const delta = Math.max(front, back);
    const per100 = (delta / mergeCost) * 100;
    console.log(
      `${id.padEnd(15)}  ${tier}     ${String(def.cost).padStart(3)}   ${String(mergeCost).padStart(7)}   ${(delta >= 0 ? '+' : '') + delta.toFixed(3).padStart(6)}   ${per100.toFixed(2)}`
    );
  }
}
