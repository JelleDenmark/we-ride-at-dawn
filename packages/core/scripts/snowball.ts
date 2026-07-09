/**
 * Week-long economy snowball simulation.
 *
 * Models an idle player through a full 7-day (168-hour) expedition using the
 * REAL income -> spend -> depth loop from the live game (see App.svelte's
 * idle heartbeat effect, which this mirrors):
 *
 *   each hour: earn depth * SCRAP_PER_DEPTH scrap for that hour's ride
 *              (simulate() against generateGauntlet(date, day, hour))
 *   at dawn (every 24 rides): interestFor(scrap) is added, then
 *              advanceAfterDawn() rolls the day forward (board/bench/relics
 *              carry, shop refreshes, boardCapForDay grows)
 *   between rides: a GREEDY SPEND POLICY spends available scrap via the
 *              real buyUnit/buyRelic/rerollShop/combineAll shop functions.
 *
 * Answers the question: does a modest early-game edge (extra starting
 * scrap, or a luckier early merge) compound into a widening depth/bank gap
 * by day 7 (a snowball), or does the wave-depth enemy scaling damp it back
 * toward parity (convergence)?
 *
 * Run from the repo root: npm run snowball
 * (or from packages/core:  npx tsx scripts/snowball.ts)
 */
import {
  newBuild,
  advanceAfterDawn,
  buyUnit,
  buyRelic,
  rerollShop,
  interestFor,
  lineupFromBuild,
  boardCapForDay,
  DAILY_SCRAP,
  SCRAP_PER_DEPTH,
  SEASON_DAYS,
  type BuildState,
} from '../src/shop';
import { simulate } from '../src/sim';
import { generateGauntlet } from '../src/gauntlet';
import { UNIT_DEFS } from '../src/data/units';
import { RELIC_DEFS } from '../src/data/relics';

const HOURS_PER_DAY = 24;
const TOTAL_HOURS = SEASON_DAYS * HOURS_PER_DAY; // 168

// ---------------------------------------------------------------------------
// Greedy spend policy — a proxy for a decent, not-optimal, player.
//
// Every hour (after that hour's ride is credited), the policy gets one shot
// to spend the bank:
//   1. Prefer completing a merge: if any owned board defId has exactly 2
//      copies and the shop sells a 3rd, buy it (merges are the single
//      biggest per-scrap power spike — a free tier-up).
//   2. Otherwise buy the best-value AFFORDABLE unit in the shop, ranked by
//      (attack + health) / cost with a flat bonus for having a combat
//      ability (summons/poison/buffs/revive all add value a raw stat ratio
//      misses). Ties broken by lower cost (prefer cheap value now over
//      saving for later — a real idle player doesn't bank scrap on principle).
//   3. If nothing affordable/worth buying and scrap is comfortably above the
//      cheapest shop unit's cost (i.e. not just saving up), spend 1 scrap on
//      a reroll to refresh the offers — but only a few times per hour cap to
//      avoid reroll-looping forever on a dead shop.
//   4. Once the board's relic slots (approximated: one relic per board unit
//      that doesn't have one yet) are worth filling and a relic in the shop
//      would help (unit relic on a boardable target, or a team relic not yet
//      owned), buy it if affordable and there's nothing better to buy.
//
// This is deliberately simple and myopic (no lookahead, no simulate() calls
// inside the policy itself — it never "tries" a purchase to see if depth
// improves, both for speed and because a real idle player doesn't A/B test
// their shop). It will not find optimal play; it's a stand-in for "someone
// who logs in occasionally and buys sensible things."
// ---------------------------------------------------------------------------

const ABILITY_BONUS = 2.5; // flat value bump for a combat ability, in "stat points"
const MAX_REROLLS_PER_HOUR = 2;

function unitValue(defId: string): number {
  const def = UNIT_DEFS[defId];
  const base = def.attack + def.health;
  const bonus = def.ability ? ABILITY_BONUS : 0;
  return (base + bonus) / def.cost;
}

/** Would buying this unit slot complete a 3-of-a-kind merge (board or bench)? */
function completesMerge(state: BuildState, defId: string): boolean {
  const owned = [...state.board, ...state.bench].filter((u) => u.defId === defId);
  if (owned.length < 2) return false;
  // Only counts as a "free tier-up" merge if all matching copies share a tier
  // (combineAll requires equal tier) — cheapest check: the two most common
  // tier among owned copies has >= 2 members.
  const byTier = new Map<number, number>();
  for (const u of owned) byTier.set(u.tier, (byTier.get(u.tier) ?? 0) + 1);
  return [...byTier.values()].some((n) => n >= 2);
}

/** One greedy pass: spend as much of the bank as sensible this hour. */
function spendGreedily(state: BuildState): BuildState {
  let s = state;
  let rerolls = 0;

  for (;;) {
    const unitSlots = s.shop.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x): x is { slot: Extract<typeof x.slot, { kind: 'unit' }>; i: number } => x.slot.kind === 'unit');

    // 1. Merge-completing buys first — cheapest guaranteed value in the game.
    const mergeBuy = unitSlots.find(
      ({ slot }) => UNIT_DEFS[slot.defId].cost <= s.scrap && completesMerge(s, slot.defId)
    );
    if (mergeBuy) {
      const res = buyUnit(s, mergeBuy.i);
      if (res.ok) {
        s = res.state;
        continue;
      }
    }

    // 2. Best value-per-scrap affordable unit, but only while there's board
    // or bench room (buyUnit itself enforces this; we just avoid pointless
    // reroll-looping once both are full and no merge is possible).
    const affordable = unitSlots.filter(({ slot }) => UNIT_DEFS[slot.defId].cost <= s.scrap);
    if (affordable.length > 0) {
      const boardFull = s.board.length >= boardCapForDay(s.day);
      const bfull = boardFull && s.bench.length >= 3; // BENCH_SIZE
      if (!bfull) {
        const best = affordable.reduce((a, b) =>
          unitValue(b.slot.defId) > unitValue(a.slot.defId) ||
          (unitValue(b.slot.defId) === unitValue(a.slot.defId) && UNIT_DEFS[b.slot.defId].cost < UNIT_DEFS[a.slot.defId].cost)
            ? b
            : a
        );
        // Only buy if it clears a reasonable value bar (avoid dumping scrap
        // on a 0-value unit just because it's affordable) — anything with a
        // combat ability or attack+health >= cost is "worth it."
        if (unitValue(best.slot.defId) >= 0.9) {
          const res = buyUnit(s, best.i);
          if (res.ok) {
            s = res.state;
            continue;
          }
        }
      }
    }

    // 3. Relics: buy an affordable one if it has somewhere useful to go.
    const relicSlots = s.shop.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x): x is { slot: Extract<typeof x.slot, { kind: 'relic' }>; i: number } => x.slot.kind === 'relic');
    const relicBuy = relicSlots.find(({ slot }) => {
      const relic = RELIC_DEFS[slot.relicId];
      if (relic.cost > s.scrap) return false;
      if (relic.scope === 'team') return !s.teamRelicIds.includes(relic.id);
      // Unit relic: is there a board unit without this relic yet? Prefer the
      // frontmost (index 0) since that's where combat value concentrates
      // (front-clash sim — see sim.ts), but any open target will do.
      return s.board.some((u) => !u.relicIds.includes(relic.id));
    });
    if (relicBuy) {
      const relic = RELIC_DEFS[relicBuy.slot.relicId];
      const targetIndex =
        relic.scope === 'unit' ? s.board.findIndex((u) => !u.relicIds.includes(relic.id)) : undefined;
      const res = buyRelic(s, relicBuy.i, targetIndex);
      if (res.ok) {
        s = res.state;
        continue;
      }
    }

    // 4. Nothing worth buying — reroll a bounded number of times if we can
    // afford it and still have meaningful scrap banked (don't reroll away
    // the last scrap of the hour).
    if (rerolls < MAX_REROLLS_PER_HOUR && s.scrap > 1) {
      const res = rerollShop(s);
      if (res.ok) {
        s = res.state;
        rerolls++;
        continue;
      }
    }

    break; // nothing left to sensibly do this hour
  }

  return s;
}

// ---------------------------------------------------------------------------
// Core hourly loop, mirroring App.svelte's idle heartbeat.
// ---------------------------------------------------------------------------

interface HourSample {
  hour: number; // 0..167
  day: number;
  depth: number;
  scrapEarned: number;
  bank: number;
}

interface RunResult {
  samples: HourSample[];
  totalIncome: number;
  totalInterest: number;
}

function addDay(date: string, n = 1): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Run one player through the full week.
 * `startingScrapBonus` models an early edge: extra scrap credited once, at
 * hour 0, before any spending (e.g. a lucky first offline-catch-up window).
 */
function runWeek(startDate: string, startingScrapBonus = 0): RunResult {
  let build = newBuild(startDate, 1);
  build = { ...build, scrap: build.scrap + startingScrapBonus };
  build = spendGreedily(build);

  const samples: HourSample[] = [];
  let totalIncome = 0;
  let totalInterest = 0;

  for (let h = 0; h < TOTAL_HOURS; h++) {
    const lineup = lineupFromBuild(build);
    const depth = lineup.units.length > 0 ? simulate(lineup, generateGauntlet(build.date, build.day, h)).result.wavesCleared : 0;
    const earned = depth * SCRAP_PER_DEPTH;
    totalIncome += earned;
    build = { ...build, scrap: build.scrap + earned };

    samples.push({ hour: h, day: build.day, depth, scrapEarned: earned, bank: build.scrap });

    build = spendGreedily(build);

    // Dawn boundary: every 24th hour (h=23,47,...) ends a day.
    if ((h + 1) % HOURS_PER_DAY === 0 && h + 1 < TOTAL_HOURS) {
      const dawnInterest = interestFor(build.scrap);
      totalInterest += dawnInterest;
      build = advanceAfterDawn(build, addDay(build.date, build.day));
      if (dawnInterest > 0) build = { ...build, scrap: build.scrap + dawnInterest };
      build = spendGreedily(build);
    }
  }

  return { samples, totalIncome, totalInterest };
}

/** A lucky early merge: the player's first few shop rolls happened to hand
 * them a completed 3-of-a-kind for free (no extra scrap spent versus
 * baseline) — modeled as ONE free tier-2 warren-warden already on the board
 * before any spending happens (a genuine power windfall, not a board-slot
 * cost). Pre-seeding two unmerged tier-1 copies instead (an earlier version
 * of this test) understates a merge windfall: on this shop's actual rolls
 * the 3rd copy never surfaces, so the two spare copies just occupy board
 * slots the greedy policy would otherwise fill with something better,
 * making the "edge" net negative — an artifact of the seeding choice, not
 * of the economy. Granting the completed merge directly isolates the thing
 * we actually want to test: a free power spike, held constant in scrap
 * spent, on day 1. */
function runWeekWithEarlyMerge(startDate: string): RunResult {
  let build = newBuild(startDate, 1);
  build = {
    ...build,
    board: [{ defId: 'warren-warden', tier: 2, relicIds: [] }],
  };
  build = spendGreedily(build);

  const samples: HourSample[] = [];
  let totalIncome = 0;
  let totalInterest = 0;

  for (let h = 0; h < TOTAL_HOURS; h++) {
    const lineup = lineupFromBuild(build);
    const depth = lineup.units.length > 0 ? simulate(lineup, generateGauntlet(build.date, build.day, h)).result.wavesCleared : 0;
    const earned = depth * SCRAP_PER_DEPTH;
    totalIncome += earned;
    build = { ...build, scrap: build.scrap + earned };
    samples.push({ hour: h, day: build.day, depth, scrapEarned: earned, bank: build.scrap });
    build = spendGreedily(build);
    if ((h + 1) % HOURS_PER_DAY === 0 && h + 1 < TOTAL_HOURS) {
      const dawnInterest = interestFor(build.scrap);
      totalInterest += dawnInterest;
      build = advanceAfterDawn(build, addDay(build.date, build.day));
      if (dawnInterest > 0) build = { ...build, scrap: build.scrap + dawnInterest };
      build = spendGreedily(build);
    }
  }
  return { samples, totalIncome, totalInterest };
}

// ---------------------------------------------------------------------------
// Seeded dates to average across (avoid one-date theme noise). Full week-long
// runs are cheap (a few ms each), so use a generous batch of real Mondays.
// ---------------------------------------------------------------------------
const SEED_DATES = [
  '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03',
  '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07',
  '2026-09-14', '2026-09-21',
];
// Each must be a Monday (day 1 of a synchronized week) for a clean 7-day run.

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function dayEndSample(samples: HourSample[], day: number): HourSample {
  // last hour sample belonging to that day (bank is ~monotonic, so the last
  // sample is a clean "end of day N" snapshot).
  const inDay = samples.filter((s) => s.day === day);
  return inDay[inDay.length - 1];
}

/** Average depth across day N's 24 hourly rides — the hourly-shuffle
 * variance (+-1-2 waves, see gauntlet.ts) makes any SINGLE hour's depth a
 * noisy read of "how deep is this player currently pushing," so headline
 * depth comparisons use this day-average instead of dayEndSample(...).depth. */
function dayAvgDepth(samples: HourSample[], day: number): number {
  const inDay = samples.filter((s) => s.day === day);
  return avg(inDay.map((s) => s.depth));
}

// ---------------------------------------------------------------------------
// 1) SNOWBALL TEST — the headline.
// ---------------------------------------------------------------------------
console.log('=== 1) SNOWBALL TEST ===');
console.log(`seeds: ${SEED_DATES.join(', ')}\n`);

interface Edge {
  label: string;
  run: (date: string) => RunResult;
}

const EDGES: Edge[] = [
  { label: '+6 starting scrap (a quarter-day head start)', run: (d) => runWeek(d, 6) },
  { label: '+24 starting scrap (a full extra day-1 stipend)', run: (d) => runWeek(d, 24) },
  { label: 'lucky early merge (free tier-2 warren-warden day 1, same scrap spent)', run: (d) => runWeekWithEarlyMerge(d) },
];

for (const edge of EDGES) {
  const baseRuns = SEED_DATES.map((d) => runWeek(d, 0));
  const edgeRuns = SEED_DATES.map((d) => edge.run(d));

  const day1DepthBase = avg(baseRuns.map((r) => dayAvgDepth(r.samples, 1)));
  const day1DepthEdge = avg(edgeRuns.map((r) => dayAvgDepth(r.samples, 1)));
  const day7DepthBase = avg(baseRuns.map((r) => dayAvgDepth(r.samples, 7)));
  const day7DepthEdge = avg(edgeRuns.map((r) => dayAvgDepth(r.samples, 7)));

  const day1BankBase = avg(baseRuns.map((r) => dayEndSample(r.samples, 1).bank));
  const day1BankEdge = avg(edgeRuns.map((r) => dayEndSample(r.samples, 1).bank));
  const day7BankBase = avg(baseRuns.map((r) => dayEndSample(r.samples, 7).bank));
  const day7BankEdge = avg(edgeRuns.map((r) => dayEndSample(r.samples, 7).bank));

  // Also track cumulative max depth (season-best proxy) over the week.
  const maxDepthBase = avg(baseRuns.map((r) => Math.max(...r.samples.map((s) => s.depth))));
  const maxDepthEdge = avg(edgeRuns.map((r) => Math.max(...r.samples.map((s) => s.depth))));

  const gapDay1 = day1DepthEdge - day1DepthBase;
  const gapDay7 = day7DepthEdge - day7DepthBase;
  const bankGapDay1 = day1BankEdge - day1BankBase;
  const bankGapDay7 = day7BankEdge - day7BankBase;

  console.log(`--- edge: ${edge.label} ---`);
  console.log(`  day-1 end depth: baseline ${day1DepthBase.toFixed(2)}  vs edge ${day1DepthEdge.toFixed(2)}  (gap ${gapDay1 >= 0 ? '+' : ''}${gapDay1.toFixed(2)})`);
  console.log(`  day-7 end depth: baseline ${day7DepthBase.toFixed(2)}  vs edge ${day7DepthEdge.toFixed(2)}  (gap ${gapDay7 >= 0 ? '+' : ''}${gapDay7.toFixed(2)})`);
  console.log(`  day-1 end bank:  baseline ${day1BankBase.toFixed(0)}   vs edge ${day1BankEdge.toFixed(0)}   (gap ${bankGapDay1 >= 0 ? '+' : ''}${bankGapDay1.toFixed(0)})`);
  console.log(`  day-7 end bank:  baseline ${day7BankBase.toFixed(0)}   vs edge ${day7BankEdge.toFixed(0)}   (gap ${bankGapDay7 >= 0 ? '+' : ''}${bankGapDay7.toFixed(0)})`);
  console.log(`  max depth over week (season-best proxy): baseline ${maxDepthBase.toFixed(2)} vs edge ${maxDepthEdge.toFixed(2)}`);
  const verdict =
    Math.abs(gapDay7) > Math.abs(gapDay1) * 1.15
      ? 'WIDENS (snowball)'
      : Math.abs(gapDay7) < Math.abs(gapDay1) * 0.85
        ? 'CONVERGES'
        : 'ROUGHLY FLAT';
  console.log(`  verdict: depth gap ${verdict} from day 1 (${gapDay1.toFixed(2)}) to day 7 (${gapDay7.toFixed(2)})\n`);
}

// ---------------------------------------------------------------------------
// 2) INCOME COUPLING — income/hr and bank vs depth across the week, plus
//    diminishing returns: marginal depth per 100 scrap invested, by day.
// ---------------------------------------------------------------------------
console.log('=== 2) INCOME COUPLING & DIMINISHING RETURNS ===\n');

const baselineRuns = SEED_DATES.map((d) => runWeek(d, 0));

console.log('day  avgDepth(day)  avgIncome/hr(day)  avgBank(dayEnd)');
for (let day = 1; day <= 7; day++) {
  const depths = baselineRuns.map((r) => dayAvgDepth(r.samples, day));
  const banks = baselineRuns.map((r) => dayEndSample(r.samples, day).bank);
  const incomesThisDay = baselineRuns.map((r) => {
    const inDay = r.samples.filter((s) => s.day === day);
    return avg(inDay.map((s) => s.scrapEarned));
  });
  console.log(
    `${day}    ${avg(depths).toFixed(2).padStart(6)}        ${avg(incomesThisDay).toFixed(2).padStart(6)}            ${avg(banks).toFixed(0).padStart(5)}`
  );
}

// Marginal depth-per-100-scrap: compare pairs of runs with different total
// scrap available (starting bonus 0 vs +100 vs +300) at the SAME day, using
// that day's AVERAGE depth (not a single noisy hour) as the yardstick. This
// isolates how much extra depth an extra chunk of scrap buys at different
// points in the economy (the key damping signal).
console.log('\nmarginal depth-per-100-scrap invested, by day (bonus runs: +0 / +100 / +300 starting scrap):');
const bonusLevels = [0, 100, 300];
const bonusRuns = bonusLevels.map((b) => SEED_DATES.map((d) => runWeek(d, b)));
console.log('day  depth@+0   depth@+100  depth@+300   marginal(0->100)  marginal(100->300, per 100)');
for (let day = 1; day <= 7; day++) {
  const d0 = avg(bonusRuns[0].map((r) => dayAvgDepth(r.samples, day)));
  const d100 = avg(bonusRuns[1].map((r) => dayAvgDepth(r.samples, day)));
  const d300 = avg(bonusRuns[2].map((r) => dayAvgDepth(r.samples, day)));
  const marg1 = d100 - d0; // per 100 scrap
  const marg2 = (d300 - d100) / 2; // per 100 scrap (200 scrap gap / 2)
  console.log(
    `${day}    ${d0.toFixed(2).padStart(7)}   ${d100.toFixed(2).padStart(8)}    ${d300.toFixed(2).padStart(7)}      ${marg1 >= 0 ? '+' : ''}${marg1.toFixed(2).padStart(5)}            ${marg2 >= 0 ? '+' : ''}${marg2.toFixed(2)}`
  );
}
const diminishing =
  avg(bonusRuns[2].map((r, i) => dayAvgDepth(r.samples, 7) - dayAvgDepth(bonusRuns[1][i].samples, 7))) / 2 <
  avg(bonusRuns[1].map((r, i) => dayAvgDepth(r.samples, 7) - dayAvgDepth(bonusRuns[0][i].samples, 7)));
console.log(`\ndiminishing returns confirmed at day 7 (marginal 100->300 < marginal 0->100): ${diminishing}`);

// ---------------------------------------------------------------------------
// 3) UNIT VALUE — rank units by depth-contribution-per-scrap.
// ---------------------------------------------------------------------------
console.log('\n=== 3) UNIT VALUE RANKING ===\n');

// Isolate one unit at a time: a 6-unit filler lineup of gutter-runts (cheap,
// neutral baseline) with ONE slot replaced by the unit under test, at a
// representative day-4 board cap and tier 2 (mid-expedition power level).
// Compares depth gained per scrap spent on that one swap, across many
// synthetic dates (single-hour simulate() calls are cheap, so this can run
// far more samples than the full week-long snowball runs). Tier-2 test
// isolates the swap's payoff after a merge (a realistic point most units are
// evaluated at, since a lone tier-1 copy of a 6-cost unit is rarely the whole
// story).
//
// Reported at BOTH the front and back slots: position is a real lever in the
// front-clash sim. Front units tank/act first; faint-synergy units only pay
// off from the back with a board dying ahead of them (Corpse-Glutton grows
// +1/+1 per ally faint; Bone-Priest revives fallen allies). Front-only
// ranking badly underrates them. (The old front-Bone-Priest self-revive
// exploit that used to dominate this slot was fixed in 0.6.2.)
const UNIT_TEST_DATES: string[] = [];
{
  const base = Date.parse('2026-07-06T12:00:00Z');
  for (let i = 0; i < 150; i++) UNIT_TEST_DATES.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}
const UNIT_TEST_DAY = 4;
function depthWithFiller(swapDefId: string | null, tier: number, pos: 'front' | 'back' = 'front'): number {
  const filler = 'gutter-runt';
  const cap = boardCapForDay(UNIT_TEST_DAY);
  const slot = pos === 'front' ? 0 : cap - 1;
  const units = Array.from({ length: cap }, (_, i) => ({
    defId: i === slot && swapDefId ? swapDefId : filler,
    tier: i === slot && swapDefId ? tier : 1,
    relicIds: [] as string[],
  }));
  const lineup = { units, teamRelicIds: [] as string[] };
  const ds = UNIT_TEST_DATES.map((d) => simulate(lineup, generateGauntlet(d, UNIT_TEST_DAY)).result.wavesCleared);
  return avg(ds);
}

const fillerBaseline = depthWithFiller(null, 1); // full gutter-runt board, no swap
interface UnitRow {
  id: string;
  cost: number;
  front: number; // tier-2 depth delta, unit in the FRONT slot
  back: number; // tier-2 depth delta, unit in the BACK slot
  bestPerScrap: number; // best of front/back over the 3-copy merge cost
}
const unitRows: UnitRow[] = Object.values(UNIT_DEFS)
  .filter((u) => u.id !== 'pup')
  .map((u) => {
    const front = depthWithFiller(u.id, 2, 'front') - fillerBaseline;
    const back = depthWithFiller(u.id, 2, 'back') - fillerBaseline;
    return { id: u.id, cost: u.cost, front, back, bestPerScrap: Math.max(front, back) / (u.cost * 3) };
  })
  .sort((a, b) => b.bestPerScrap - a.bestPerScrap);

console.log(
  `(tier-2 unit swapped into a full gutter-runt board, day ${UNIT_TEST_DAY} cap ${boardCapForDay(UNIT_TEST_DAY)}, baseline ${fillerBaseline.toFixed(2)}, ${UNIT_TEST_DATES.length} dates)\n`
);
console.log('unit             cost   Δ FRONT   Δ BACK   best Δ/scrap  wants');
for (const r of unitRows) {
  const swing = r.back - r.front;
  const wants = Math.abs(swing) >= 0.4 ? (swing > 0 ? 'back' : 'front') : '—';
  console.log(
    `${r.id.padEnd(15)} ${String(r.cost).padStart(3)}   ${(r.front >= 0 ? '+' : '') + r.front.toFixed(2).padStart(5)}   ${(r.back >= 0 ? '+' : '') + r.back.toFixed(2).padStart(5)}   ${r.bestPerScrap.toFixed(3).padStart(6)}   ${wants}`
  );
}

// (Historical: a front-slot tier-1 Bone-Priest used to solo-clear every wave
// by reviving *itself* — the fallen queue popped the unit that had just died,
// which was itself. Fixed in 0.6.2; `revive` now skips the caster, so
// Bone-Priest ranks normally above.)

// ---------------------------------------------------------------------------
// 4) RELIC VALUE — on a representative board: Warren-Warden (front),
//    gutter-runts between, Corpse-Glutton (back). Each unit relic is tested
//    pinned to the FRONT carrier (Warren-Warden) and the BACK carrier
//    (Corpse-Glutton), since a relic's payoff depends heavily on who holds it.
// ---------------------------------------------------------------------------
console.log('\n=== 4) RELIC VALUE RANKING ===\n');

// Single-hour simulate() calls are cheap — use a large synthetic date batch
// for signal, since relic deltas are small (whole-wave granularity, see
// depth-scaling.ts's ~0.01-0.07 wave Rusted Nail deltas needing 400 samples).
const RELIC_TEST_DATES: string[] = [];
{
  const base = Date.parse('2026-07-06T12:00:00Z');
  for (let i = 0; i < 400; i++) RELIC_TEST_DATES.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

const RELIC_DAY = 6; // late-expedition, where relics matter most (cap 7)
// Board: Warren-Warden(front, t2) · gutter-runts(t1) · Corpse-Glutton(back, t2).
function relicBoard() {
  const cap = boardCapForDay(RELIC_DAY);
  return Array.from({ length: cap }, (_, i) => {
    if (i === 0) return { defId: 'warren-warden', tier: 2, relicIds: [] as string[] };
    if (i === cap - 1) return { defId: 'corpse-glutton', tier: 2, relicIds: [] as string[] };
    return { defId: 'gutter-runt', tier: 1, relicIds: [] as string[] };
  });
}
function depthWithRelicAt(relicId: string | null, carrier: 'front' | 'back'): number {
  const cap = boardCapForDay(RELIC_DAY);
  const slot = carrier === 'front' ? 0 : cap - 1;
  const units = relicBoard().map((u, i) => (i === slot && relicId ? { ...u, relicIds: [relicId] } : u));
  const ds = RELIC_TEST_DATES.map((d) => simulate({ units, teamRelicIds: [] as string[] }, generateGauntlet(d, RELIC_DAY)).result.wavesCleared);
  return avg(ds);
}

const relicBase = depthWithRelicAt(null, 'front'); // same board, no relic
console.log(
  `board: Warren-Warden(front) · gutter-runts · Corpse-Glutton(back), day ${RELIC_DAY} cap ${boardCapForDay(RELIC_DAY)}, baseline ${relicBase.toFixed(2)}, ${RELIC_TEST_DATES.length} dates\n`
);
console.log('relic          cost   Δ on WW(front)   Δ on CG(back)   best Δ/cost  best on');
const relicRows = Object.values(RELIC_DEFS)
  .filter((r) => r.scope === 'unit')
  .map((r) => {
    const f = depthWithRelicAt(r.id, 'front') - relicBase;
    const b = depthWithRelicAt(r.id, 'back') - relicBase;
    return { id: r.id, name: r.name, cost: r.cost, f, b, best: Math.max(f, b), bestPerCost: Math.max(f, b) / r.cost };
  })
  .sort((a, b) => b.best - a.best);
for (const r of relicRows) {
  const on = r.f >= r.b ? 'WW' : 'CG';
  console.log(
    `${r.name.padEnd(13)} ${String(r.cost).padStart(3)}    ${(r.f >= 0 ? '+' : '') + r.f.toFixed(3).padStart(6)}          ${(r.b >= 0 ? '+' : '') + r.b.toFixed(3).padStart(6)}        ${r.bestPerCost.toFixed(4)}    ${on}`
  );
}

// Team relic (Filth Totem) — whole-horde, same board.
const teamWith = (() => {
  const units = relicBoard();
  const ds = RELIC_TEST_DATES.map((d) => simulate({ units, teamRelicIds: ['filth-totem'] }, generateGauntlet(d, RELIC_DAY)).result.wavesCleared);
  return avg(ds);
})();
console.log(
  `\nFilth Totem (team, cost ${RELIC_DEFS['filth-totem'].cost}): whole-horde Δ ${(teamWith - relicBase).toFixed(3)} (Δ/cost ${((teamWith - relicBase) / RELIC_DEFS['filth-totem'].cost).toFixed(4)})`
);

// Team relic (The Forgotten Backpack, issue #24) — whole-horde per-tick regen.
const teamWithBackpack = (() => {
  const units = relicBoard();
  const ds = RELIC_TEST_DATES.map(
    (d) => simulate({ units, teamRelicIds: ['forgotten-backpack'] }, generateGauntlet(d, RELIC_DAY)).result.wavesCleared
  );
  return avg(ds);
})();
console.log(
  `The Forgotten Backpack (team, cost ${RELIC_DEFS['forgotten-backpack'].cost}): whole-horde Δ ${(teamWithBackpack - relicBase).toFixed(3)} (Δ/cost ${((teamWithBackpack - relicBase) / RELIC_DEFS['forgotten-backpack'].cost).toFixed(4)})`
);
console.log(`\nranked by best-placement depth delta: ${relicRows.map((r) => r.id).join(' > ')}`);

// ---------------------------------------------------------------------------
// 5) INTEREST'S SHARE of total income over the week.
// ---------------------------------------------------------------------------
console.log('\n=== 5) INTEREST SHARE OF TOTAL INCOME ===\n');
const interestRuns = SEED_DATES.map((d) => runWeek(d, 0));
const totalIncomeAll = avg(interestRuns.map((r) => r.totalIncome));
const totalInterestAll = avg(interestRuns.map((r) => r.totalInterest));
console.log(`avg total ride income over the week: ${totalIncomeAll.toFixed(1)} scrap`);
console.log(`avg total interest over the week:    ${totalInterestAll.toFixed(1)} scrap`);
console.log(`interest share of total income:      ${((totalInterestAll / (totalIncomeAll + totalInterestAll)) * 100).toFixed(1)}%`);
// Per-day breakdown to show WHEN it matters (early, when the bank is small
// and depth-derived income hasn't ramped, is where a 5%-capped-at-5 stipend
// would matter most in relative terms, if at all).
console.log('\nper-day: bank at day-start, interest paid entering the day, that day\'s ride income, interest share of that day');
for (let day = 1; day <= 7; day++) {
  const bankAtDayStart: number[] = [];
  const interestPaid: number[] = [];
  const rideIncomeThatDay: number[] = [];
  for (const d of SEED_DATES) {
    let build = newBuild(d, 1);
    build = spendGreedily(build);
    let dayStartBank = build.scrap; // day 1's starting bank (post first spend)
    let dayIncome = 0;
    for (let h = 0; h < TOTAL_HOURS; h++) {
      const currentDay = build.day;
      const lineup = lineupFromBuild(build);
      const depth = lineup.units.length > 0 ? simulate(lineup, generateGauntlet(build.date, build.day, h)).result.wavesCleared : 0;
      const earned = depth * SCRAP_PER_DEPTH;
      build = { ...build, scrap: build.scrap + earned };
      if (currentDay === day) dayIncome += earned;
      build = spendGreedily(build);
      if ((h + 1) % HOURS_PER_DAY === 0 && h + 1 < TOTAL_HOURS) {
        const dawnInterest = interestFor(build.scrap);
        // dawnInterest is paid entering the NEXT day (build.day + 1 after
        // advanceAfterDawn), so attribute it there.
        if (build.day + 1 === day) interestPaid.push(dawnInterest);
        build = advanceAfterDawn(build, addDay(build.date, build.day));
        if (dawnInterest > 0) build = { ...build, scrap: build.scrap + dawnInterest };
        if (build.day === day) dayStartBank = build.scrap; // bank right as this day begins
        build = spendGreedily(build);
      }
    }
    bankAtDayStart.push(dayStartBank);
    rideIncomeThatDay.push(dayIncome);
  }
  const avgBank = avg(bankAtDayStart);
  const avgInterest = interestPaid.length > 0 ? avg(interestPaid) : 0;
  const avgRideIncome = avg(rideIncomeThatDay);
  const share = (avgInterest / (avgInterest + avgRideIncome)) * 100;
  console.log(
    `day ${day}: bank@start ${avgBank.toFixed(0).padStart(4)}  interest ${avgInterest.toFixed(2).padStart(4)}  rideIncome ${avgRideIncome.toFixed(1).padStart(6)}  share ${share.toFixed(1)}%`
  );
}

console.log('\n=== NOTES ===');
console.log('Greedy policy: merge-completing buy > best (attack+health+abilityBonus)/cost affordable unit');
console.log('  (bar: value >= 0.9) > relic with an open target > bounded reroll (max 2/hour) > pass.');
console.log('This is a proxy for a sensible-but-not-optimal player: no lookahead, no simulate() calls');
console.log('inside the policy, no explicit merge-fishing (holds/benches), no counter-teching against');
console.log('the daily theme. Real strong play (deliberate merge-fishing, relic timing, bench usage) may');
console.log('show a different snowball shape than this proxy — treat these numbers as a lower bound on');
console.log('how much a skilled player could separate an early edge into a late one.');
