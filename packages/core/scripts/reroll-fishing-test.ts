// One-off analysis: does a "picky" player (rerolls for premium units instead
// of settling for cheap ones) actually get starved out of that behavior by
// a higher REROLL_COST or lower DAILY_SCRAP? Tests the specific mechanism
// Jesper described: "with less starting scrap you'd buy out the shop rather
// than reroll to go deeper" — i.e. is reroll-fishing for premium units an
// abundant-scrap-only luxury, and which lever (reroll cost vs starting
// scrap) actually curbs it?
//
// Unlike scripts/snowball.ts's greedy policy (which settles for anything
// >= 0.9 value and barely rerolls), this policy is DELIBERATELY PICKY: it
// only buys units at/above a high value bar, and rerolls aggressively
// (bounded only by affordability) while scrap allows, falling back to
// "just buy the best affordable thing" once out of reroll budget or no
// premium pick has shown up after many tries.
import {
  newBuild,
  advanceAfterDawn,
  buyUnit,
  rerollShop,
  boardCapForDay,
  DAILY_SCRAP as REAL_DAILY_SCRAP,
  REROLL_COST as REAL_REROLL_COST,
  type BuildState,
} from '../src/shop';
import { UNIT_DEFS } from '../src/data/units';

const PREMIUM_BAR = 1.5; // only Warren-Warden-tier picks clear this
const ABILITY_BONUS = 2.5;
const MAX_FISH_REROLLS_PER_HOUR = 20; // effectively "as many as scrap allows"

function unitValue(defId: string): number {
  const def = UNIT_DEFS[defId];
  return (def.attack + def.health + (def.ability ? ABILITY_BONUS : 0)) / def.cost;
}

interface PickCounts {
  premium: number; // cost >= 6, value >= PREMIUM_BAR
  cheap: number; // cost <= 4
  rerolls: number;
}

function spendPicky(state: BuildState, rerollCost: number, counts: PickCounts): BuildState {
  let s = state;
  let rerolls = 0;
  for (;;) {
    const unitSlots = s.shop.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x): x is { slot: Extract<typeof x.slot, { kind: 'unit' }>; i: number } => x.slot.kind === 'unit');
    const affordable = unitSlots.filter(({ slot }) => UNIT_DEFS[slot.defId].cost <= s.scrap);
    const boardFull = s.board.length >= boardCapForDay(s.day) && s.bench.length >= 3;
    if (boardFull) break;

    const premiumPick = affordable.find(({ slot }) => unitValue(slot.defId) >= PREMIUM_BAR);
    if (premiumPick) {
      const res = buyUnit(s, premiumPick.i);
      if (res.ok) {
        s = res.state;
        counts.premium++;
        continue;
      }
    }

    // No premium pick available — keep fishing if we can still afford to
    // reroll AND still have enough scrap left over to buy *something*
    // afterward (don't reroll away every last scrap chasing a dream).
    if (rerolls < MAX_FISH_REROLLS_PER_HOUR && s.scrap > rerollCost + 1) {
      const res = rerollShop(s);
      if (res.ok) {
        s = res.state;
        rerolls++;
        counts.rerolls++;
        continue;
      }
    }

    // Give up fishing — buy the best affordable thing, even if cheap/mediocre.
    if (affordable.length > 0) {
      const best = affordable.reduce((a, b) => (unitValue(b.slot.defId) > unitValue(a.slot.defId) ? b : a));
      const res = buyUnit(s, best.i);
      if (res.ok) {
        s = res.state;
        if (UNIT_DEFS[best.slot.defId].cost <= 4) counts.cheap++;
        else counts.premium++;
        continue;
      }
    }
    break;
  }
  return s;
}

function runWeek(startDate: string, dailyScrap: number, rerollCost: number): PickCounts {
  const counts: PickCounts = { premium: 0, cheap: 0, rerolls: 0 };
  let s: BuildState = { ...newBuild(startDate), scrap: dailyScrap };
  for (let hour = 0; hour < 7 * 24; hour++) {
    if (hour > 0 && hour % 24 === 0) {
      const day = Math.floor(hour / 24) + 1;
      const date = new Date(Date.parse(`${startDate}T12:00:00Z`) + (day - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      s = advanceAfterDawn(s, date);
      s = { ...s, scrap: s.scrap + dailyScrap };
    }
    // rerollCost is a fixed constant in the real shop.ts (REROLL_COST); we
    // can't parameterize rerollShop's own cost here without editing source,
    // so this script reports rerolls performed and cheap/premium split at
    // the REAL current REROLL_COST — see the printed constants below, and
    // edit REROLL_COST in shop.ts + re-run to compare a different value.
    s = spendPicky(s, rerollCost, counts);
  }
  return counts;
}

const dates = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'];

function report(label: string, dailyScrap: number, rerollCost: number): void {
  let totalPremium = 0;
  let totalCheap = 0;
  let totalRerolls = 0;
  for (const d of dates) {
    const c = runWeek(d, dailyScrap, rerollCost);
    totalPremium += c.premium;
    totalCheap += c.cheap;
    totalRerolls += c.rerolls;
  }
  const cheapPct = ((totalCheap / (totalPremium + totalCheap)) * 100).toFixed(1);
  console.log(
    `${label}: premium ${(totalPremium / dates.length).toFixed(1)}, cheap ${(totalCheap / dates.length).toFixed(1)}, rerolls ${(totalRerolls / dates.length).toFixed(1)}, cheap% ${cheapPct}%`
  );
}

console.log(`Real constants: DAILY_SCRAP=${REAL_DAILY_SCRAP}, REROLL_COST=${REAL_REROLL_COST}`);
console.log('Note: rerollCost here only affects the affordability gate in this script\'s policy —');
console.log('the real rerollShop() cost is fixed by REROLL_COST in shop.ts regardless of this param,');
console.log('so this specifically isolates "how much scrap is available for rerolling", not the real');
console.log('per-reroll cost. Edit REROLL_COST in shop.ts directly to test that lever for real.\n');

console.log('Picky-fisher policy (only buys premium picks, rerolls aggressively otherwise), avg over 4 seeded weeks:\n');
for (const scrap of [24, 18, 12, 8, 6]) {
  report(`DAILY_SCRAP=${scrap}`, scrap, REAL_REROLL_COST);
}
